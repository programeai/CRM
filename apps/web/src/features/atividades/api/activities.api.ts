import { api } from '@/lib/api';
import type {
  Activity,
  ActivityScope,
  CreateActivityBody,
  Paginated,
} from './types';

export const activitiesApi = {
  list: (scope: ActivityScope) =>
    api
      .get<Paginated<Activity>>('/activities', {
        // `dealId` só entra quando existe: a query do servidor trata o campo
        // ausente como "todas as do cliente".
        params: { ...scope, limit: 100 },
      })
      .then((r) => r.data),
  create: (body: CreateActivityBody) =>
    api.post<Activity>('/activities', body).then((r) => r.data),
  complete: (id: string) =>
    api.post<Activity>(`/activities/${id}/complete`).then((r) => r.data),
};
