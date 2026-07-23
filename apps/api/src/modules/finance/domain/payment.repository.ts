import type { Prisma, PaymentStatus, BillingType } from '@prisma/client';

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

/** Cobrança + contrato/cliente mínimos (para lista e posse). */
export type PaymentWithContract = Prisma.PaymentGetPayload<{
  include: {
    contract: {
      select: {
        id: true;
        description: true;
        billingType: true;
        clientId: true;
        client: { select: { id: true; name: true } };
      };
    };
  };
}>;

/** Filtros comuns a listagem e resumo (posse + recorte por cliente/contrato/regime/período). */
export interface PaymentBaseFilter {
  ownerId: string; // filtra por contract.client.ownerId
  search?: string; // busca por nome do cliente (contract.client.name)
  clientId?: string;
  contractId?: string;
  billingType?: BillingType; // regime, via contract
  dueFrom?: Date;
  dueTo?: Date;
}

/** Colunas pelas quais a listagem pode ser ordenada. */
export const PAYMENT_SORT_FIELDS = [
  'status',
  'client',
  'contract',
  'dueDate',
  'amount',
] as const;
export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

export interface PaymentListFilter extends PaymentBaseFilter {
  status?: PaymentStatus[]; // um ou mais status
  /** Coluna de ordenação; ausente = padrão (status por prioridade → cliente → contrato). */
  sortBy?: PaymentSortField;
  sortDir?: SortDirection; // padrão 'asc'
  skip: number;
  take: number;
}

/** Soma de valores agrupada por status (para os cards de recebimentos). */
export interface PaymentStatusSum {
  status: PaymentStatus;
  amount: number; // Σ amount
  paidAmount: number; // Σ paidAmount (0 quando ausente)
}

export interface PaymentRepository {
  findById(id: string): Promise<PaymentWithContract | null>;
  findManyAndCount(
    filter: PaymentListFilter,
  ): Promise<{ data: PaymentWithContract[]; total: number }>;
  /** Soma dos valores por status, respeitando os filtros (exceto status). */
  sumByStatus(filter: PaymentBaseFilter): Promise<PaymentStatusSum[]>;
  update(
    id: string,
    data: Prisma.PaymentUpdateInput,
  ): Promise<PaymentWithContract>;
  /** Existe cobrança para o contrato com este vencimento exato? (dedupe do cron) */
  existsForDueDate(contractId: string, dueDate: Date): Promise<boolean>;
  /** Cria a cobrança da mensalidade (usado pelo cron). */
  create(
    data: Prisma.PaymentUncheckedCreateInput,
  ): Promise<PaymentWithContract>;
  /** Marca OVERDUE toda PENDING com dueDate < now. Retorna quantas. (cron) */
  markOverdue(now: Date): Promise<number>;
}
