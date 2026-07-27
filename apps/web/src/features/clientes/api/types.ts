export type PersonType = 'INDIVIDUAL' | 'COMPANY';
export type LeadSource = 'REFERRAL' | 'PAID_TRAFFIC' | 'ORGANIC' | 'OUTBOUND' | 'OTHER';
export type ClientStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'LOST';
export type ActivityType = 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'WHATSAPP' | 'FOLLOW_UP';

/** Responsável, quando houver. Shape mínimo devolvido junto do registro. */
export interface Assignee {
  id: string;
  name: string;
}

export interface Client {
  id: string;
  name: string;
  tradeName?: string | null;
  personType: PersonType;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  source?: LeadSource | null;
  status: ClientStatus;
  tags: string[];
  notes?: string | null;
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  archivedAt?: string | null;
  assigneeId?: string | null;
  assignee?: Assignee | null;
  createdAt: string;
  updatedAt: string;
}
export interface Contact {
  id: string;
  clientId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
}
export interface Activity {
  id: string;
  clientId: string;
  dealId?: string | null;
  type: ActivityType;
  content: string;
  scheduledFor?: string | null;
  completedAt?: string | null;
  assigneeId?: string | null;
  assignee?: Assignee | null;
  createdAt: string;
}
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
}
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

/** Uma tag existente do dono e em quantos clientes ela é usada. */
export interface TagUsage {
  tag: string;
  count: number;
}
/** Cliente que usa determinada tag (lista do modal de exclusão). */
export interface ClientTagRef {
  id: string;
  name: string;
}

export interface ListClientsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ClientStatus;
  source?: LeadSource;
  assigneeId?: string;
}
