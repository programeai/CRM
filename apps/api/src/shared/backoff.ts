/**
 * Espera entre tentativas de entrega, em minutos. O tamanho do array é o MÁXIMO
 * de tentativas: 6 tentativas, esgotando em ~10,6h.
 *
 * Compartilhado pelas duas outboxes (notificação do usuário e webhook do owner)
 * porque o número é o mesmo julgamento — quanto tempo vale insistir num destino
 * fora do ar antes de desistir — e divergir os dois criaria duas respostas para
 * a mesma pergunta.
 */
export const BACKOFF_MIN = [1, 5, 30, 120, 480];

/** `null` = esgotou; quem chama grava `nextAttemptAt: null` e status definitivo. */
export function proximaTentativa(attempts: number, agora: Date): Date | null {
  const espera = BACKOFF_MIN[attempts - 1];
  return espera == null ? null : new Date(agora.getTime() + espera * 60_000);
}
