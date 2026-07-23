import { api } from '@/lib/api';
import type {
  Contract,
  CreateContractBody,
  ListContractsParams,
  Paginated,
  UpdateContractBody,
} from './types';

export const contractsApi = {
  list: (params: ListContractsParams) =>
    api.get<Paginated<Contract>>('/contracts', { params }).then((r) => r.data),
  listByClient: (clientId: string) =>
    api
      .get<Paginated<Contract>>('/contracts', { params: { clientId, limit: 100 } })
      .then((r) => r.data),
  get: (id: string) => api.get<Contract>(`/contracts/${id}`).then((r) => r.data),
  create: (body: CreateContractBody) =>
    api.post<Contract>('/contracts', body).then((r) => r.data),
  update: (id: string, body: UpdateContractBody) =>
    api.patch<Contract>(`/contracts/${id}`, body).then((r) => r.data),
  pause: (id: string) => api.post<Contract>(`/contracts/${id}/pause`).then((r) => r.data),
  resume: (id: string) => api.post<Contract>(`/contracts/${id}/resume`).then((r) => r.data),
  cancel: (id: string) => api.post<Contract>(`/contracts/${id}/cancel`).then((r) => r.data),
};
