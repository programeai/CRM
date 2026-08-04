import { assinarCorpo, CABECALHO_ASSINATURA } from './webhook-signature';

/** Teto de espera de um POST. Depois disso, a outbox reagenda. */
export const TIMEOUT_MS = 10_000;

/**
 * O POST de webhook do CRM, com timeout, cabeçalhos e assinatura opcional.
 *
 * Vive em `shared/` porque tem **dois** consumidores em módulos diferentes: os
 * canais de notificação do usuário (`modules/notifications/infra/*.channel.ts`)
 * e o webhook de saída do owner (`modules/webhooks`). Um módulo não acessa o
 * interior de outro (`apps/api/CLAUDE.md`), e duplicar o transporte faria as
 * duas outboxes divergirem em timeout, cabeçalho e forma da assinatura — que é
 * exatamente o que um receptor não pode adivinhar.
 *
 * **Rejeita** fora da faixa 2xx, com o status na mensagem — é o que alimenta o
 * retry/backoff de quem chama. A URL nunca entra na mensagem de erro: ela é
 * credencial, e `lastError` é gravado no banco e pode acabar num log.
 */
export async function postar(
  url: string,
  corpo: unknown,
  deliveryId: string,
  segredo?: string | null,
): Promise<void> {
  await enviar(url, corpo, deliveryId, segredo);
}

/**
 * Igual ao `postar`, mas **devolve o corpo da resposta já parseado**.
 *
 * Existe por causa do Telegram, que sinaliza falha no corpo (`{ ok: false }`) e
 * não só no status: sem ler o corpo, um token errado ou um chat inexistente
 * seria gravado como entrega bem-sucedida — falha silenciosa e sem retry. Quem
 * chama decide o que é sucesso; aqui só o status HTTP é julgado.
 *
 * Corpo que não seja JSON faz o `json()` rejeitar, o que vira falha e retry —
 * correto, e a mensagem do erro de parse não carrega a URL.
 */
export async function postarLendoResposta(
  url: string,
  corpo: unknown,
  deliveryId: string,
  segredo?: string | null,
): Promise<unknown> {
  const resposta = await enviar(url, corpo, deliveryId, segredo);
  return (await resposta.json()) as unknown;
}

/** O POST em si. Rejeita fora de 2xx; não olha o corpo. */
async function enviar(
  url: string,
  corpo: unknown,
  deliveryId: string,
  segredo?: string | null,
): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  /*
    Serializa UMA vez, numa variável: é ESTA string que é assinada e é ESTA que é
    postada. Reserializar entre assinar e enviar é o bug clássico que invalida a
    verificação do outro lado — `JSON.stringify` não garante ordem estável entre
    duas chamadas com objetos construídos por caminhos diferentes.
  */
  const body = JSON.stringify(corpo);
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CRM-Delivery': deliveryId,
      'X-CRM-Timestamp': timestamp,
      'User-Agent': 'CRM-ProgrameAi/1.0',
      // Aditivo: destino sem segredo (Slack, Discord, Telegram, e todo webhook
      // de notificação cadastrado antes da 19-B) continua entregando sem o
      // cabeçalho. O webhook de saída do owner SEMPRE tem segredo.
      ...(segredo
        ? { [CABECALHO_ASSINATURA]: assinarCorpo(segredo, timestamp, body) }
        : {}),
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resposta.ok) {
    throw new Error(`O destino respondeu ${resposta.status}.`);
  }
  return resposta;
}
