import { api } from '@/lib/api';
import type {
  CreateTaskBody, ListTasksParams, MoveTaskBody, Paginated, TagUsage, Task,
  TaskTagRef, UpdateTaskBody,
} from './types';

export const tasksApi = {
  list: (params: ListTasksParams) =>
    api.get<Paginated<Task>>('/tasks', { params }).then((r) => r.data),
  board: (projectId?: string) =>
    api
      .get<Task[]>('/tasks/board', { params: projectId ? { projectId } : {} })
      .then((r) => r.data),
  get: (id: string) => api.get<Task>(`/tasks/${id}`).then((r) => r.data),
  create: (body: CreateTaskBody) => api.post<Task>('/tasks', body).then((r) => r.data),
  update: (id: string, body: UpdateTaskBody) =>
    api.patch<Task>(`/tasks/${id}`, body).then((r) => r.data),
  move: (id: string, body: MoveTaskBody) =>
    api.patch<Task>(`/tasks/${id}/move`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/tasks/${id}`).then((r) => r.data),
  listTags: () => api.get<TagUsage[]>('/tasks/tags').then((r) => r.data),
  tagUsage: (tag: string) =>
    api.get<TaskTagRef[]>('/tasks/tags/usage', { params: { tag } }).then((r) => r.data),
  deleteTag: (tag: string) =>
    api.delete<{ removed: number }>('/tasks/tags', { params: { tag } }).then((r) => r.data),
};
