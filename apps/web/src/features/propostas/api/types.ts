import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ServiceType = 'SOFTWARE' | 'WEBSITE' | 'PAID_TRAFFIC';
export type ProposalStatus =
  | 'DRAFT' | 'SENT' | 'NEGOTIATING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

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
  serviceType: ServiceType;
  status: ProposalStatus;
  scope?: string | null;
  paymentTerms?: string | null;
  deliveryTime?: string | null;
  validUntil?: string | null;
  discount?: string | null;
  total: string;
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
  serviceType: ServiceType;
  items: ProposalItemInput[];
  dealId?: string;
  discount?: number;
  scope?: string;
  paymentTerms?: string;
  deliveryTime?: string;
  validUntil?: string;
}
export type UpdateProposalBody = Partial<Omit<CreateProposalBody, 'clientId' | 'dealId'>>;

export interface ListProposalsParams {
  page?: number;
  limit?: number;
  search?: string;
  clientId?: string;
  status?: ProposalStatus;
}
