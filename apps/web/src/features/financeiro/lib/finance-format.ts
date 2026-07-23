import type { ContractStatus, PaymentStatus } from '../api/types';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata um Decimal serializado (string) ou number como moeda pt-BR; '—' se nulo. */
export function formatMoney(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  return currency.format(Number(value));
}

export const CONTRACT_STATUS_BADGE: Record<
  ContractStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  PAUSED: 'outline',
  FINISHED: 'secondary',
  CANCELED: 'destructive',
};

export const PAYMENT_STATUS_BADGE: Record<
  PaymentStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  PENDING: 'secondary',
  PAID: 'default',
  OVERDUE: 'destructive',
  CANCELED: 'outline',
};
