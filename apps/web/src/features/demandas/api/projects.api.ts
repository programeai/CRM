import { api } from '@/lib/api';
import type {
  CreateProjectBody, ListProjectsParams, Paginated, Project, UpdateProjectBody,
} from './types';

export const projectsApi = {
  list: (params: ListProjectsParams) =>
    api.get<Paginated<Project>>('/projects', { params }).then((r) => r.data),
  listByClient: (clientId: string) =>
    api.get<Paginated<Project>>('/projects', { params: { clientId, limit: 100 } }).then((r) => r.data),
  get: (id: string) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (body: CreateProjectBody) => api.post<Project>('/projects', body).then((r) => r.data),
  update: (id: string, body: UpdateProjectBody) =>
    api.patch<Project>(`/projects/${id}`, body).then((r) => r.data),
  archive: (id: string) => api.post<Project>(`/projects/${id}/archive`).then((r) => r.data),
  restore: (id: string) => api.post<Project>(`/projects/${id}/restore`).then((r) => r.data),
  /** Expurgo — exige `lixeira:expurgar`, registro já arquivado e sem demandas vinculadas. */
  remove: (id: string) => api.delete(`/projects/${id}`).then((r) => r.data),
};
