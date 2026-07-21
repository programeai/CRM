import type { Prisma } from '@prisma/client';

export const DEAL_REPOSITORY = Symbol('DEAL_REPOSITORY');

/** Deal + dados mínimos do cliente para exibir no card do board/lista. */
export type DealWithClient = Prisma.DealGetPayload<{
  include: { client: { select: { id: true; name: true } } };
}>;

export interface DealListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  stageId?: string;
  search?: string; // casa em title
  skip: number;
  take: number;
}

/** Campos ajustados no destino durante um move (calculados no service). */
export interface DealMovePatch {
  stageMovedAt?: Date;
  lostReason?: string | null;
}

export interface DealRepository {
  create(data: Prisma.DealUncheckedCreateInput): Promise<DealWithClient>;
  findById(id: string): Promise<DealWithClient | null>;
  findManyAndCount(
    filter: DealListFilter,
  ): Promise<{ data: DealWithClient[]; total: number }>;
  /** Todos os deals do owner, ordenados por (stageId, position) — alimenta o board. */
  findAllForBoard(ownerId: string): Promise<DealWithClient[]>;
  update(id: string, data: Prisma.DealUpdateInput): Promise<DealWithClient>;
  delete(id: string): Promise<void>;
  /** Maior `position` na coluna (ou -1 se vazia). */
  maxPositionInStage(stageId: string): Promise<number>;
  /** Move o deal p/ (stageId, position) reindexando as colunas afetadas em transação. */
  move(
    dealId: string,
    toStageId: string,
    toPosition: number,
    patch: DealMovePatch,
  ): Promise<DealWithClient>;
}
