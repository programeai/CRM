import type { PipelineStage, Prisma } from '@prisma/client';

export const PIPELINE_STAGE_REPOSITORY = Symbol('PIPELINE_STAGE_REPOSITORY');

export interface PipelineStageRepository {
  findAllOrdered(): Promise<PipelineStage[]>;
  findById(id: string): Promise<PipelineStage | null>;
  findByName(name: string): Promise<PipelineStage | null>;
  create(
    data: Prisma.PipelineStageUncheckedCreateInput,
  ): Promise<PipelineStage>;
  update(
    id: string,
    data: Prisma.PipelineStageUpdateInput,
  ): Promise<PipelineStage>;
  delete(id: string): Promise<void>;
  /** Maior `order` atual (ou -1 se não houver estágios). */
  maxOrder(): Promise<number>;
  /** Quantos deals apontam para este estágio (guard de exclusão). */
  countDeals(stageId: string): Promise<number>;
  /** Reatribui `order` sequencial na ordem dos ids, em transação. */
  reorder(ids: string[]): Promise<void>;
}
