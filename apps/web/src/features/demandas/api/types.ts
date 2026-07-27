import type { CatalogItem } from '@/features/catalogos/api/types';
import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'CANCELED';
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

/** Responsável, quando houver. Shape mínimo devolvido junto do registro. */
export interface Assignee {
  id: string;
  name: string;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Project {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  proposalId?: string | null;
  name: string;
  serviceTypeId: string;
  serviceType: CatalogItem;
  status: ProjectStatus;
  startDate?: string | null;
  dueDate?: string | null;
  _count: { tasks: number };
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  project: { id: string; name: string; clientId: string; client: { id: string; name: string } };
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  position: number;
  tags: string[];
  checklist?: ChecklistItem[] | null;
  completedAt?: string | null;
  assigneeId?: string | null;
  assignee?: Assignee | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectBody {
  name: string;
  clientId: string;
  serviceTypeId: string;
  proposalId?: string;
  startDate?: string;
  dueDate?: string;
}
export type UpdateProjectBody = Partial<
  Omit<CreateProjectBody, 'clientId' | 'proposalId'>
> & { status?: ProjectStatus };

export interface CreateTaskBody {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string;
  tags?: string[];
  checklist?: ChecklistItem[];
  assigneeId?: string | null;
}
export type UpdateTaskBody = Partial<
  Omit<
    CreateTaskBody,
    'projectId' | 'status' | 'description' | 'dueDate' | 'assigneeId'
  >
> & {
  /** `null` limpa o campo no backend; `undefined`/ausente preserva. */
  description?: string | null;
  dueDate?: string | null;
  assigneeId?: string | null;
};
export interface MoveTaskBody {
  status: TaskStatus;
  position: number;
}

/** Uma tag existente do dono e em quantas demandas ela é usada. */
export interface TagUsage {
  tag: string;
  count: number;
}
/** Demanda que usa uma tag — exibida no modal de exclusão global. */
export interface TaskTagRef {
  id: string;
  title: string;
  project: { id: string; name: string };
}

export interface ListProjectsParams {
  page?: number;
  limit?: number;
  clientId?: string;
  status?: ProjectStatus;
  search?: string;
}
export interface ListTasksParams {
  page?: number;
  limit?: number;
  projectId?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueBefore?: string;
  assigneeId?: string;
}
