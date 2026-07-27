export type TrashType = 'CLIENT' | 'CONTACT' | 'DEAL' | 'PROJECT' | 'TASK';

/** Linha da lixeira, uniformizada entre os cinco tipos. */
export interface TrashItem {
  type: TrashType;
  id: string;
  /** Rótulo humano do registro (nome do cliente, título do deal…). */
  label: string;
  /** Contexto: o cliente ou o projeto a que pertence. `null` quando não há. */
  context: string | null;
  archivedAt: string;
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

export interface ListTrashParams {
  page?: number;
  limit?: number;
  type?: TrashType;
}
