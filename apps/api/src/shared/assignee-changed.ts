/**
 * O `assigneeId` mudou neste PATCH?
 *
 * `undefined` no DTO significa "não mexi neste campo" — reenviar o MESMO
 * responsável também não é atribuição nova, e sem esta segunda comparação um
 * `PATCH` que só troca o título dispararia notificação. `null` é atribuição
 * removida: mudou, mas não há quem notificar (quem chama já trata).
 *
 * Vale para os quatro modelos com responsável; em `Client` o valor chega por
 * spread do DTO, não por linha própria, mas a comparação é a mesma.
 */
export function assigneeMudou(
  novo: string | null | undefined,
  anterior: string | null,
): novo is string {
  return novo !== undefined && novo !== anterior && novo !== null;
}
