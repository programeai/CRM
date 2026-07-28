import { api } from '@/lib/api';
import type {
  Client,
  ClientTagRef,
  Contact,
  Paginated,
  ListClientsParams,
  TagUsage,
} from './types';

export const clientsApi = {
  list: (params: ListClientsParams) =>
    api.get<Paginated<Client>>('/clients', { params }).then((r) => r.data),
  get: (id: string) => api.get<Client>(`/clients/${id}`).then((r) => r.data),
  create: (body: Partial<Client>) =>
    api.post<Client>('/clients', body).then((r) => r.data),
  update: (id: string, body: Partial<Client>) =>
    api.patch<Client>(`/clients/${id}`, body).then((r) => r.data),
  archive: (id: string) =>
    api.post<Client>(`/clients/${id}/archive`).then((r) => r.data),
  restore: (id: string) =>
    api.post<Client>(`/clients/${id}/restore`).then((r) => r.data),
  /** Expurgo — exige `lixeira:expurgar`, registro já arquivado e sem vínculos. */
  remove: (id: string) => api.delete(`/clients/${id}`).then((r) => r.data),
  // tags (agregadas dos clientes do dono)
  listTags: () => api.get<TagUsage[]>('/clients/tags').then((r) => r.data),
  tagUsage: (tag: string) =>
    api
      .get<ClientTagRef[]>('/clients/tags/usage', { params: { tag } })
      .then((r) => r.data),
  deleteTag: (tag: string) =>
    api
      .delete<{ removed: number }>('/clients/tags', { params: { tag } })
      .then((r) => r.data),
  // contacts
  listContacts: (clientId: string) =>
    api.get<Contact[]>(`/clients/${clientId}/contacts`).then((r) => r.data),
  createContact: (clientId: string, body: Partial<Contact>) =>
    api.post<Contact>(`/clients/${clientId}/contacts`, body).then((r) => r.data),
  updateContact: (id: string, body: Partial<Contact>) =>
    api.patch<Contact>(`/contacts/${id}`, body).then((r) => r.data),
  archiveContact: (id: string) =>
    api.post<Contact>(`/contacts/${id}/archive`).then((r) => r.data),
  restoreContact: (id: string) =>
    api.post<Contact>(`/contacts/${id}/restore`).then((r) => r.data),
  /** Expurgo — exige `lixeira:expurgar` e registro já arquivado. */
  purgeContact: (id: string) => api.delete(`/contacts/${id}`).then((r) => r.data),
  // As rotas de `/activities` ficam em `features/atividades/api` — a timeline é
  // compartilhada com o funil, não é um detalhe do cliente.
};
