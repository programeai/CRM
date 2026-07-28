import type { ExportColumn } from '../../../shared/export';
import type { ContractWithPayments } from '../domain/contract.repository';

// Duplica os rótulos de `apps/web/src/lib/labels.ts` de propósito — o backend
// não importa do frontend (mesma decisão registrada em `client-export-columns.ts`).
const BILLING_TYPE: Record<string, string> = {
  RECURRING: 'Recorrente',
  INSTALLMENTS: 'Parcelado',
  ONE_TIME: 'Pagamento único',
};

const STATUS: Record<string, string> = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  FINISHED: 'Encerrado',
  CANCELED: 'Cancelado',
};

/**
 * O contrato guarda o valor num campo diferente por regime (`monthlyAmount` /
 * `installmentAmount`); `ONE_TIME` não guarda valor nenhum no contrato — só na
 * cobrança única que ele gera. `payments` já vem ordenado por `dueDate asc`.
 */
function valorDoContrato(c: ContractWithPayments): number | null {
  if (c.monthlyAmount != null) return Number(c.monthlyAmount);
  if (c.installmentAmount != null) return Number(c.installmentAmount);
  return c.payments[0] ? Number(c.payments[0].amount) : null;
}

/** Início da cobrança: `startDate` (RECURRING) ou o vencimento da primeira parcela gerada. */
function inicioDoContrato(c: ContractWithPayments): Date | null {
  return c.startDate ?? c.payments[0]?.dueDate ?? null;
}

export const COLUNAS_DE_CONTRATO: ExportColumn<ContractWithPayments>[] = [
  { header: 'Cliente', value: (c) => c.client.name, width: 28 },
  { header: 'Descrição', value: (c) => c.description, width: 32 },
  {
    header: 'Regime',
    value: (c) => BILLING_TYPE[c.billingType] ?? c.billingType,
    width: 14,
  },
  { header: 'Status', value: (c) => STATUS[c.status] ?? c.status, width: 12 },
  { header: 'Valor', value: valorDoContrato },
  { header: 'Dia do vencimento', value: (c) => c.billingDay, width: 12 },
  { header: 'Início', value: inicioDoContrato, width: 14 },
  { header: 'Fim', value: (c) => c.endDate, width: 14 },
  { header: 'Parcelas', value: (c) => c.installments, width: 10 },
  { header: 'Criado em', value: (c) => c.createdAt, width: 14 },
];
