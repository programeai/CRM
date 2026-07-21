import { api } from '@/lib/api';
import type {
  CreateDealBody,
  Deal,
  MoveDealBody,
  Paginated,
  UpdateDealBody,
} from './types';

export const dealsApi = {
  board: () => api.get<Deal[]>('/deals/board').then((r) => r.data),
  listByClient: (clientId: string) =>
    api
      .get<Paginated<Deal>>('/deals', { params: { clientId, limit: 100 } })
      .then((r) => r.data),
  create: (body: CreateDealBody) => api.post<Deal>('/deals', body).then((r) => r.data),
  update: (id: string, body: UpdateDealBody) =>
    api.patch<Deal>(`/deals/${id}`, body).then((r) => r.data),
  move: (id: string, body: MoveDealBody) =>
    api.patch<Deal>(`/deals/${id}/move`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/deals/${id}`).then((r) => r.data),
};
