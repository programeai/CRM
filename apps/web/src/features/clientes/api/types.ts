import type { CatalogItem } from '@/features/catalogos/api/types';

export type PersonType = 'INDIVIDUAL' | 'COMPANY';
export type ClientStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'LOST';

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
  sourceId?: string | null;
  source?: CatalogItem | null;
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
// `Activity` mora em `features/atividades/api/types` — a timeline é
// compartilhada entre cliente e oportunidade.
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
  sourceId?: string;
  assigneeId?: string;
}
