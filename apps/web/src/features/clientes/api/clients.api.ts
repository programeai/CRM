import { api } from '@/lib/api';
import type {
  Client,
  Contact,
  Activity,
  Paginated,
  ListClientsParams,
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
  // contacts
  listContacts: (clientId: string) =>
    api.get<Contact[]>(`/clients/${clientId}/contacts`).then((r) => r.data),
  createContact: (clientId: string, body: Partial<Contact>) =>
    api.post<Contact>(`/clients/${clientId}/contacts`, body).then((r) => r.data),
  updateContact: (id: string, body: Partial<Contact>) =>
    api.patch<Contact>(`/contacts/${id}`, body).then((r) => r.data),
  deleteContact: (id: string) =>
    api.delete(`/contacts/${id}`).then((r) => r.data),
  // activities
  listActivities: (clientId: string) =>
    api
      .get<Paginated<Activity>>('/activities', {
        params: { clientId, limit: 100 },
      })
      .then((r) => r.data),
  createActivity: (body: Partial<Activity>) =>
    api.post<Activity>('/activities', body).then((r) => r.data),
  completeActivity: (id: string) =>
    api.post<Activity>(`/activities/${id}/complete`).then((r) => r.data),
};
