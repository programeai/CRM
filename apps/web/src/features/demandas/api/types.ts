import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ServiceType = 'SOFTWARE' | 'WEBSITE' | 'PAID_TRAFFIC';
export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'CANCELED';
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

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
  serviceType: ServiceType;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectBody {
  name: string;
  clientId: string;
  serviceType: ServiceType;
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
}
export type UpdateTaskBody = Partial<Omit<CreateTaskBody, 'projectId' | 'status'>>;
export interface MoveTaskBody {
  status: TaskStatus;
  position: number;
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
}
