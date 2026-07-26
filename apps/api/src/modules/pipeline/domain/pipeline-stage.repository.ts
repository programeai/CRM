import type { PipelineStage, Prisma } from '@prisma/client';

export const PIPELINE_STAGE_REPOSITORY = Symbol('PIPELINE_STAGE_REPOSITORY');

/**
 * Estágios são dado do owner (RLS por ownerId). O filtro explícito aqui é
 * defesa em profundidade: a policy já fecha, mas o repositório não depende de
 * o contexto da transação ter sido setado.
 */
export interface PipelineStageRepository {
  findAllOrdered(ownerId: string): Promise<PipelineStage[]>;
  /** Ids de todos os estágios do owner — valida o payload de `reorder`. */
  findAllIds(ownerId: string): Promise<string[]>;
  findById(id: string, ownerId: string): Promise<PipelineStage | null>;
  findByName(ownerId: string, name: string): Promise<PipelineStage | null>;
  /** `data` já carrega `ownerId` (UncheckedCreateInput). */
  create(
    data: Prisma.PipelineStageUncheckedCreateInput,
  ): Promise<PipelineStage>;
  update(
    id: string,
    ownerId: string,
    data: Prisma.PipelineStageUncheckedUpdateManyInput,
  ): Promise<PipelineStage>;
  delete(id: string, ownerId: string): Promise<void>;
  /** Maior `order` atual do owner (ou -1 se não houver estágios). */
  maxOrder(ownerId: string): Promise<number>;
  /** Quantos deals do owner apontam para este estágio (guard de exclusão). */
  countDeals(stageId: string, ownerId: string): Promise<number>;
  /** Reatribui `order` sequencial na ordem dos ids, na transação do request. */
  reorder(ownerId: string, ids: string[]): Promise<void>;
}
