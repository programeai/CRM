import type { Prisma, ContractStatus, BillingType } from '@prisma/client';

export const CONTRACT_REPOSITORY = Symbol('CONTRACT_REPOSITORY');

/** Contrato + cobranças (ordenadas por vencimento) + cliente mínimo. */
export type ContractWithPayments = Prisma.ContractGetPayload<{
  include: {
    payments: true; // ordenado por dueDate asc no include do infra
    client: { select: { id: true; name: true } };
  };
}>;

export interface ContractListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  status?: ContractStatus;
  billingType?: BillingType;
  skip: number;
  take: number;
}

export interface ContractRepository {
  create(
    data: Prisma.ContractUncheckedCreateInput,
  ): Promise<ContractWithPayments>;
  findById(id: string): Promise<ContractWithPayments | null>;
  findManyAndCount(
    filter: ContractListFilter,
  ): Promise<{ data: ContractWithPayments[]; total: number }>;
  findByClient(clientId: string): Promise<ContractWithPayments[]>;
  update(
    id: string,
    data: Prisma.ContractUpdateInput,
  ): Promise<ContractWithPayments>;
  /** Contratos ACTIVE RECURRING (para o cron gerar mensalidades). */
  findActiveRecurring(): Promise<ContractWithPayments[]>;
}
