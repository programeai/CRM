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
  /*
    Atribuição de anúncio: de qual clique o lead veio. SOMENTE LEITURA — a única
    porta de escrita é `POST /leads/intake`, e a API recusa estes campos em
    `POST`/`PATCH /clients` com 400. Este mesmo tipo alimenta `Partial<Client>`
    nas mutações, então não os inclua em nenhum formulário: o 400 viria do
    servidor, mas o erro nasceria aqui.
  */
  fbclid?: string | null;
  /** ISO 8601. Instante em que o CRM primeiro observou o `fbclid`. */
  fbclidAt?: string | null;
  fbp?: string | null;
  gclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingUrl?: string | null;
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
