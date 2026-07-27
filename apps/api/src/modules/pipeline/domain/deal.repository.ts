import type { Prisma } from '@prisma/client';
import type { AssigneeScope } from '../../../shared/record-scope';

export const DEAL_REPOSITORY = Symbol('DEAL_REPOSITORY');

/** Deal + dados mínimos do cliente e do responsável para exibir no card. */
export type DealWithClient = Prisma.DealGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    assignee: { select: { id: true; name: true } };
  };
}>;

export interface DealListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  stageId?: string;
  search?: string; // casa em title
  /** Filtro explícito da query (`?assigneeId=`). */
  assigneeId?: string;
  /** Recorte por permissão — independente do filtro acima; os dois se somam. */
  scope: AssigneeScope;
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
  findById(
    id: string,
    scope?: AssigneeScope,
    includeArchived?: boolean,
  ): Promise<DealWithClient | null>;
  findManyAndCount(
    filter: DealListFilter,
  ): Promise<{ data: DealWithClient[]; total: number }>;
  /**
   * Todos os deals do owner, ordenados por (stageId, position) — alimenta o board.
   * `assigneeId` é o filtro explícito da interface; `scope`, o recorte por permissão.
   */
  findAllForBoard(
    ownerId: string,
    scope?: AssigneeScope,
    assigneeId?: string,
  ): Promise<DealWithClient[]>;
  // Unchecked: `assigneeId` é gravado pelo escalar (não pelo `assignee.connect`),
  // porque `null` precisa limpar o responsável.
  update(
    id: string,
    data: Prisma.DealUncheckedUpdateInput,
  ): Promise<DealWithClient>;
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
  /** Manda o deal para a lixeira. */
  archive(id: string): Promise<DealWithClient>;
  /** Devolve o deal à área de trabalho. */
  restore(id: string): Promise<DealWithClient>;
}
