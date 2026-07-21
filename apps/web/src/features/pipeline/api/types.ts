import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ServiceType = 'SOFTWARE' | 'WEBSITE' | 'PAID_TRAFFIC';

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}

export interface Deal {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  stageId: string;
  title: string;
  serviceType: ServiceType;
  amount?: string | null; // Decimal serializa como string no JSON
  probability?: number | null;
  expectedClose?: string | null;
  lostReason?: string | null;
  position: number;
  stageMovedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealBody {
  title: string;
  clientId: string;
  serviceType: ServiceType;
  amount?: number;
  probability?: number;
  expectedClose?: string;
}
export type UpdateDealBody = Partial<Omit<CreateDealBody, 'clientId'>>;
export interface MoveDealBody {
  stageId: string;
  position: number;
  lostReason?: string;
}

export interface CreateStageBody {
  name: string;
  isWon?: boolean;
  isLost?: boolean;
}
export type UpdateStageBody = Partial<CreateStageBody>;
