import { createHmac, randomBytes } from 'node:crypto';

/**
 * Assinatura de webhook do CRM. O desenho foi prescrito na decisão D4 da Fase 9
 * e é o esquema do Stripe: `HMAC-SHA256` sobre `<timestamp>.<body>`, hex, em
 * `X-CRM-Signature: sha256=<hex>`.
 *
 * **`corpo` é a string já serializada, e quem chama tem de POSTAR ESSA MESMA
 * STRING.** Reserializar entre assinar e enviar é o bug clássico que invalida a
 * verificação do outro lado — `JSON.stringify` não garante ordem estável entre
 * duas chamadas com objetos construídos por caminhos diferentes.
 *
 * O timestamp é o insumo anti-replay: o receptor recusa o que estiver fora da
 * janela dele (o Stripe usa 5 minutos por default), e é ele que impede que um
 * corpo capturado hoje seja reenviado amanhã. Sem timestamp o esquema não tem
 * defesa de replay nenhuma — é a diferença entre este desenho e o do GitHub.
 *
 * A assinatura **não** substitui a trava anti-SSRF de `shared/webhook-url.ts`: o
 * risco da feature é exfiltração para fora, não corpo forjado. As duas coisas
 * defendem lados opostos, e a assinatura protege o RECEPTOR.
 */
export const CABECALHO_ASSINATURA = 'X-CRM-Signature';

export function assinarCorpo(
  segredo: string,
  timestamp: string,
  corpo: string,
): string {
  const mac = createHmac('sha256', segredo)
    .update(`${timestamp}.${corpo}`)
    .digest('hex');
  return `sha256=${mac}`;
}

/** 32 bytes: mesma entropia da chave de integração e do token de convite. */
export function gerarSegredoDeWebhook(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}
