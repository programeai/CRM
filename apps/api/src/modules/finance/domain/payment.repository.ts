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

export interface PaymentListFilter {
  ownerId: string; // filtra por contract.client.ownerId
  search?: string; // busca por nome do cliente (contract.client.name)
  clientId?: string;
  contractId?: string;
  status?: PaymentStatus;
  billingType?: BillingType; // regime, via contract
  dueFrom?: Date;
  dueTo?: Date;
  skip: number;
  take: number;
}

export interface PaymentRepository {
  findById(id: string): Promise<PaymentWithContract | null>;
  findManyAndCount(
    filter: PaymentListFilter,
  ): Promise<{ data: PaymentWithContract[]; total: number }>;
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
