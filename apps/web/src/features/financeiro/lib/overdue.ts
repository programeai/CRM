import type { Payment } from '../api/types';

/**
 * Vencida (derivado no client): não paga/cancelada e com vencimento passado.
 * Preferir `p.status === 'OVERDUE'` (autoritativo, vindo do cron) para o badge;
 * esta função cobre o intervalo entre o vencimento e a próxima execução do cron.
 */
export function isOverdue(p: Pick<Payment, 'dueDate' | 'status'>): boolean {
  if (p.status === 'PAID' || p.status === 'CANCELED') return false;
  const due = new Date(p.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}
