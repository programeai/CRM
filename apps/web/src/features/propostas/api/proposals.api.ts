import { api } from '@/lib/api';
import type {
  CreateProposalBody, ListProposalsParams, Paginated, Proposal, UpdateProposalBody,
} from './types';

export const proposalsApi = {
  list: (params: ListProposalsParams) =>
    api.get<Paginated<Proposal>>('/proposals', { params }).then((r) => r.data),
  listByClient: (clientId: string) =>
    api.get<Paginated<Proposal>>('/proposals', { params: { clientId, limit: 100 } }).then((r) => r.data),
  listByDeal: (dealId: string) =>
    api.get<Paginated<Proposal>>('/proposals', { params: { dealId, limit: 100 } }).then((r) => r.data),
  get: (id: string) => api.get<Proposal>(`/proposals/${id}`).then((r) => r.data),
  versions: (id: string) => api.get<Proposal[]>(`/proposals/${id}/versions`).then((r) => r.data),
  create: (body: CreateProposalBody) => api.post<Proposal>('/proposals', body).then((r) => r.data),
  update: (id: string, body: UpdateProposalBody) =>
    api.patch<Proposal>(`/proposals/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/proposals/${id}`).then((r) => r.data),
  send: (id: string) => api.post<Proposal>(`/proposals/${id}/send`).then((r) => r.data),
  accept: (id: string) => api.post<Proposal>(`/proposals/${id}/accept`).then((r) => r.data),
  reject: (id: string) => api.post<Proposal>(`/proposals/${id}/reject`).then((r) => r.data),
  newVersion: (id: string) => api.post<Proposal>(`/proposals/${id}/new-version`).then((r) => r.data),
};
