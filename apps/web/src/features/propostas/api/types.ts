import type { CatalogItem } from '@/features/catalogos/api/types';
import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ProposalStatus =
  | 'DRAFT' | 'SENT' | 'NEGOTIATING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

/**
 * Declarado aqui, não importado de `features/financeiro`: uma feature não
 * importa o interior de outra (`apps/web/CLAUDE.md`). Os RÓTULOS não são
 * duplicados — vêm de `BILLING_TYPE_LABELS` em `@/lib/labels`.
 */
export type BillingType = 'RECURRING' | 'INSTALLMENTS' | 'ONE_TIME';

export interface ProposalItem {
  id: string;
  description: string;
  quantity: string; // Decimal → string
  unitPrice: string;
  order: number;
}

export interface Proposal {
  id: string;
  number: string;
  version: number;
  parentId?: string | null;
  clientId: string;
  client: { id: string; name: string };
  dealId?: string | null;
  serviceTypeId: string;
  serviceType: CatalogItem;
  status: ProposalStatus;
  scope?: string | null;
  paymentTerms?: string | null;
  deliveryTime?: string | null;
  validUntil?: string | null;
  discount?: string | null;
  total: string; // em plano RECURRING é o valor MENSAL
  // --- plano de cobrança ---
  billingType?: BillingType | null;
  startOffsetDays?: number | null;
  billingDay?: number | null;
  durationMonths?: number | null;
  downPaymentPercent?: string | null; // Decimal → string
  downPaymentAmount?: string | null;
  downPaymentOffsetDays?: number | null;
  installments?: number | null;
  items: ProposalItem[];
  sentAt?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}
export interface CreateProposalBody {
  clientId: string;
  serviceTypeId: string;
  items: ProposalItemInput[];
  dealId?: string;
  discount?: number;
  scope?: string;
  paymentTerms?: string;
  deliveryTime?: string;
  validUntil?: string;
  billingType: BillingType;
  startOffsetDays: number;
  billingDay?: number;
  durationMonths?: number;
  downPaymentPercent?: number;
  downPaymentAmount?: number;
  downPaymentOffsetDays?: number;
  installments?: number;
}
export type UpdateProposalBody = Partial<Omit<CreateProposalBody, 'clientId' | 'dealId'>>;

export interface ListProposalsParams {
  page?: number;
  limit?: number;
  search?: string;
  clientId?: string;
  status?: ProposalStatus;
}
