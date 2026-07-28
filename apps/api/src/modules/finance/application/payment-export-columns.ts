import type { ExportColumn } from '../../../shared/export';
import type { PaymentWithContract } from '../domain/payment.repository';

// Duplica os rótulos de `apps/web/src/lib/labels.ts` de propósito — o backend
// não importa do frontend (mesma decisão registrada em `client-export-columns.ts`).
const STATUS: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Paga',
  OVERDUE: 'Vencida',
  CANCELED: 'Cancelada',
};

export const COLUNAS_DE_COBRANCA: ExportColumn<PaymentWithContract>[] = [
  { header: 'Cliente', value: (p) => p.contract.client.name, width: 28 },
  { header: 'Contrato', value: (p) => p.contract.description, width: 28 },
  { header: 'Descrição', value: (p) => p.description, width: 28 },
  { header: 'Status', value: (p) => STATUS[p.status] ?? p.status, width: 12 },
  { header: 'Vencimento', value: (p) => p.dueDate, width: 14 },
  { header: 'Valor', value: (p) => Number(p.amount) },
  {
    header: 'Valor pago',
    value: (p) => (p.paidAmount != null ? Number(p.paidAmount) : null),
  },
  { header: 'Pago em', value: (p) => p.paidAt, width: 14 },
];
