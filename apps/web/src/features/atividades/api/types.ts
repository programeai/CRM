import type { CatalogItem } from '@/features/catalogos/api/types';
import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };

/** Responsável, quando houver. Shape mínimo devolvido junto do registro. */
export interface Assignee {
  id: string;
  name: string;
}

export interface Activity {
  id: string;
  clientId: string;
  /** Oportunidade a que a atividade pertence, quando registrada por lá. */
  dealId?: string | null;
  typeId: string;
  type: CatalogItem;
  content: string;
  scheduledFor?: string | null;
  completedAt?: string | null;
  assigneeId?: string | null;
  assignee?: Assignee | null;
  createdAt: string;
}

/**
 * Recorte de uma timeline. `clientId` é sempre obrigatório — toda atividade
 * pertence a um cliente, mesmo quando registrada dentro de uma oportunidade.
 *
 * Com `dealId`, a timeline mostra **só** o que é daquela oportunidade e as
 * atividades novas nascem vinculadas a ela; sem `dealId`, mostra tudo do cliente
 * (inclusive o que foi registrado nas oportunidades dele).
 */
export interface ActivityScope {
  clientId: string;
  dealId?: string;
}

export interface CreateActivityBody {
  clientId: string;
  dealId?: string;
  typeId: string;
  content: string;
  scheduledFor?: string;
  assigneeId?: string | null;
}
