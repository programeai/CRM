import type { Prisma, TaskStatus } from '@prisma/client';

export const TASK_REPOSITORY = Symbol('TASK_REPOSITORY');

/** Task + projeto/cliente mínimos para o board e para "Minhas demandas". */
export type TaskWithProject = Prisma.TaskGetPayload<{
  include: {
    project: {
      select: {
        id: true;
        name: true;
        clientId: true;
        client: { select: { id: true; name: true } };
      };
    };
  };
}>;

export interface TaskListFilter {
  ownerId: string; // filtra por project.client.ownerId
  projectId?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: import('@prisma/client').TaskPriority;
  dueBefore?: Date; // dueDate <= dueBefore (para "atrasadas"/prazo)
  skip: number;
  take: number;
}

/** Campos ajustados no destino durante um move (calculados no service). */
export interface TaskMovePatch {
  completedAt?: Date | null;
}

export interface TaskRepository {
  create(data: Prisma.TaskUncheckedCreateInput): Promise<TaskWithProject>;
  findById(id: string): Promise<TaskWithProject | null>;
  findManyAndCount(
    filter: TaskListFilter,
  ): Promise<{ data: TaskWithProject[]; total: number }>;
  /** Todas as tarefas de um projeto, ordenadas por (status, position) — alimenta o board. */
  findAllForBoard(projectId: string): Promise<TaskWithProject[]>;
  /** Todas as tarefas do dono (cross-projeto) — alimenta o board de "Minhas demandas". */
  findAllForBoardByOwner(ownerId: string): Promise<TaskWithProject[]>;
  update(id: string, data: Prisma.TaskUpdateInput): Promise<TaskWithProject>;
  delete(id: string): Promise<void>;
  /** Maior `position` na coluna status do projeto (ou -1 se vazia). */
  maxPositionInStatus(projectId: string, status: TaskStatus): Promise<number>;
  /** Move a task p/ (status, position) reindexando as colunas afetadas em transação. */
  move(
    taskId: string,
    toStatus: TaskStatus,
    toPosition: number,
    patch: TaskMovePatch,
  ): Promise<TaskWithProject>;
}
