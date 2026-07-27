import type { Activity, Prisma } from '@prisma/client';
import type { AssigneeScope } from '../../../shared/record-scope';

export const ACTIVITY_REPOSITORY = Symbol('ACTIVITY_REPOSITORY');

/** Responsável embutido na leitura — a timeline exibe o nome. */
export interface ActivityAssigneeRef {
  id: string;
  name: string;
}

export type ActivityWithAssignee = Activity & {
  assignee: ActivityAssigneeRef | null;
};

export interface ActivityListFilter {
  /** Defesa em profundidade: o RLS já fecha, mas o repositório não depende disso. */
  ownerId: string;
  clientId?: string;
  dealId?: string;
  /** Filtro explícito da query (`?assigneeId=`). */
  assigneeId?: string;
  /** Recorte por permissão — independente do filtro acima; os dois se somam. */
  scope: AssigneeScope;
  skip: number;
  take: number;
}

export interface ActivityRepository {
  findManyAndCount(
    filter: ActivityListFilter,
  ): Promise<{ data: ActivityWithAssignee[]; total: number }>;
  findById(
    id: string,
    scope?: AssigneeScope,
  ): Promise<ActivityWithAssignee | null>;
  create(
    data: Prisma.ActivityUncheckedCreateInput,
  ): Promise<ActivityWithAssignee>;
  // Unchecked: `assigneeId` é gravado pelo escalar (não pelo `assignee.connect`),
  // porque `null` precisa limpar o responsável.
  update(
    id: string,
    data: Prisma.ActivityUncheckedUpdateInput,
  ): Promise<ActivityWithAssignee>;
}
