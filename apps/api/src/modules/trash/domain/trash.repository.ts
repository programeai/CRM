export const TRASH_REPOSITORY = Symbol('TRASH_REPOSITORY');

/** Tipo de registro na lixeira — o mesmo vocabulário do enum `AuditEntity`. */
export type TrashType = 'CLIENT' | 'CONTACT' | 'DEAL' | 'PROJECT' | 'TASK';

/** Linha da lixeira, uniformizada entre os cinco tipos. */
export interface TrashItem {
  type: TrashType;
  id: string;
  /** Rótulo humano do registro (nome do cliente, título do deal…). */
  label: string;
  /** Contexto: o cliente ou o projeto a que ele pertence. Vazio quando não há. */
  context: string | null;
  archivedAt: Date;
}

export interface TrashListFilter {
  ownerId: string;
  /** Restringe a leitura a um único tipo — só a consulta daquele tipo roda. */
  type?: TrashType;
  skip: number;
  take: number;
}

export interface TrashRepository {
  findManyAndCount(
    filter: TrashListFilter,
  ): Promise<{ data: TrashItem[]; total: number }>;
}
