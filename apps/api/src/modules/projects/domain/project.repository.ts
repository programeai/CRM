import type { Prisma } from '@prisma/client';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

/** Project + dados mínimos do cliente + contagem de tarefas para listagem/ficha. */
export type ProjectWithClient = Prisma.ProjectGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    _count: { select: { tasks: true } };
  };
}>;

export interface ProjectListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  status?: import('@prisma/client').ProjectStatus;
  search?: string; // casa em name
  skip: number;
  take: number;
}

export interface ProjectRepository {
  create(data: Prisma.ProjectUncheckedCreateInput): Promise<ProjectWithClient>;
  findById(id: string): Promise<ProjectWithClient | null>;
  findManyAndCount(
    filter: ProjectListFilter,
  ): Promise<{ data: ProjectWithClient[]; total: number }>;
  /** Todos os projetos de um cliente (para a aba do cliente). */
  findByClient(clientId: string): Promise<ProjectWithClient[]>;
  update(
    id: string,
    data: Prisma.ProjectUpdateInput,
  ): Promise<ProjectWithClient>;
  delete(id: string): Promise<void>;
  countTasks(projectId: string): Promise<number>;
  /** Primeiro projeto já vinculado a um deal (dedupe de criar-ao-ganhar). */
  findByDealId(dealId: string): Promise<ProjectWithClient | null>;
}
