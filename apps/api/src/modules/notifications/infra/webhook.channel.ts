import { Injectable } from '@nestjs/common';
import type { NotificationChannelKind } from '@prisma/client';
import type {
  CanalDeNotificacao,
  ConteudoDeNotificacao,
  DestinoDeNotificacao,
} from '../domain/notification-channel';

/** Teto de espera de um POST. Depois disso, o outbox reagenda. */
export const TIMEOUT_MS = 10_000;

/**
 * Canal de webhook genérico: POSTa o **conteúdo neutro cru**, para quem consome
 * com n8n/Zapier montar o que quiser do outro lado.
 *
 * `X-CRM-Delivery` é o que deixa o receptor **deduplicar** — necessário, porque
 * o outbox tem retry e a mesma entrega pode chegar duas vezes.
 *
 * **Sem assinatura e sem segredo nesta fase (D4).** A URL É a credencial: quem a
 * tiver escreve no canal. HMAC vai para a Fase 19, junto da máquina de segredo
 * com rotação — ver o comentário de `webhook-url.ts` para o porquê.
 */
@Injectable()
export class WebhookChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'WEBHOOK';

  /** Não depende de config de ambiente: a URL vem do destino do usuário. */
  isEnabled(): boolean {
    return true;
  }

  async entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void> {
    const { url } = destino.config as { url?: string };
    if (!url) throw new Error('Destino de webhook sem URL configurada.');
    await postar(url, this.corpo(conteudo), conteudo.deliveryId);
  }

  /** O conteúdo neutro, cru. Nenhum formato de serviço específico aqui. */
  protected corpo(conteudo: ConteudoDeNotificacao): unknown {
    return {
      tipo: conteudo.tipo,
      titulo: conteudo.titulo,
      corpo: conteudo.corpo,
      link: conteudo.link,
      dados: conteudo.dados,
    };
  }
}

/**
 * POST com timeout e cabeçalhos do CRM. **Rejeita** fora da faixa 2xx, com o
 * status na mensagem — é o que alimenta o retry/backoff do outbox.
 *
 * A URL nunca entra na mensagem de erro: ela é a credencial, e `lastError` é
 * gravado no banco e pode acabar num log.
 */
export async function postar(
  url: string,
  corpo: unknown,
  deliveryId: string,
): Promise<void> {
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CRM-Delivery': deliveryId,
      'X-CRM-Timestamp': String(Math.floor(Date.now() / 1000)),
      'User-Agent': 'CRM-ProgrameAi/1.0',
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resposta.ok) {
    throw new Error(`O destino respondeu ${resposta.status}.`);
  }
}
