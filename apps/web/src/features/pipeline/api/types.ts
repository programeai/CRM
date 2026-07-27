import type { Paginated } from '@/features/clientes/api/types';
import type { CatalogItem } from '@/features/catalogos/api/types';

export type { Paginated };

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}

/** Responsável, quando houver. Shape mínimo devolvido junto do registro. */
export interface Assignee {
  id: string;
  name: string;
}

export interface Deal {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  stageId: string;
  title: string;
  serviceTypeId: string;
  serviceType: CatalogItem;
  amount?: string | null; // Decimal serializa como string no JSON
  probability?: number | null;
  expectedClose?: string | null;
  lostReasonId?: string | null;
  lostReason?: CatalogItem | null;
  position: number;
  stageMovedAt: string;
  assigneeId?: string | null;
  assignee?: Assignee | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealBody {
  title: string;
  clientId: string;
  serviceTypeId: string;
  amount?: number;
  probability?: number;
  expectedClose?: string;
  assigneeId?: string | null;
}
export type UpdateDealBody = Partial<Omit<CreateDealBody, 'clientId'>>;
export interface MoveDealBody {
  stageId: string;
  position: number;
  lostReasonId?: string;
}

export interface CreateStageBody {
  name: string;
  isWon?: boolean;
  isLost?: boolean;
}
export type UpdateStageBody = Partial<CreateStageBody>;
