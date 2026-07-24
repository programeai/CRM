import type { ContractStatus, PaymentStatus } from '../api/types';

// Formatador de moeda canônico vive em `@/lib/format` (reúso transversal);
// reexportado aqui para não quebrar os imports existentes da feature.
export { formatMoney } from '@/lib/format';

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
