const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata o `amount` (string do Decimal) como moeda pt-BR, ou '—' se nulo. */
export function formatDealAmount(amount?: string | null): string {
  if (amount == null || amount === '') return '—';
  return currency.format(Number(amount));
}

/**
 * Dias parados no estágio até o card contar como esfriando. **Espelha
 * `DIAS_ESFRIANDO`** de `apps/api/src/modules/notifications/application/notifications-reminders.job.ts`,
 * que é o limite do aviso `DEAL_STALE`: selo e notificação têm de concordar.
 */
const COOLING_DAYS = 7;

/** Dias parados no estágio atual (desde `stageMovedAt`). */
export function daysInStage(stageMovedAt: string): number {
  const ms = Date.now() - new Date(stageMovedAt).getTime();
  return Math.floor(ms / 86_400_000);
}

/** "Esfriando": parado > 7 dias (indicador só aplicado a estágios não terminais). */
export function isCooling(stageMovedAt: string): boolean {
  return daysInStage(stageMovedAt) > COOLING_DAYS;
}
