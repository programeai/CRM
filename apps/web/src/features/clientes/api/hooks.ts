import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { clientsApi } from './clients.api';
import type { Activity, Client, Contact, ListClientsParams } from './types';

export function useClients(params: ListClientsParams) {
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: () => clientsApi.list(params),
  });
}
export function useClient(id: string) {
  return useQuery({
    queryKey: queryKeys.clients.detail(id),
    queryFn: () => clientsApi.get(id),
  });
}
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Client>) => clientsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}
export function useUpdateClient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Client>) => clientsApi.update(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients.all });
      void qc.invalidateQueries({ queryKey: queryKeys.clients.detail(id) });
    },
  });
}
export function useArchiveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientsApi.archive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}

// --- Tags (agregadas dos clientes do dono) ---

/** Tags existentes com contagem de uso, para o autocomplete do seletor. */
export function useClientTags() {
  return useQuery({
    queryKey: queryKeys.clients.tags,
    queryFn: () => clientsApi.listTags(),
  });
}
/** Clientes que usam uma tag — carregado sob demanda no modal de exclusão. */
export function useClientTagUsage(tag: string | null) {
  return useQuery({
    queryKey: queryKeys.clients.tagUsage(tag ?? ''),
    queryFn: () => clientsApi.tagUsage(tag as string),
    enabled: !!tag,
  });
}
/** Exclui uma tag globalmente (remove de todos os clientes do dono). */
export function useDeleteClientTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => clientsApi.deleteTag(tag),
    // invalida ['clients'] → cobre listagem, detalhes e a lista de tags
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}

// --- Contatos ---

export function useContacts(clientId: string) {
  return useQuery({
    queryKey: queryKeys.clients.contacts(clientId),
    queryFn: () => clientsApi.listContacts(clientId),
  });
}
export function useCreateContact(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Contact>) =>
      clientsApi.createContact(clientId, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(clientId) }),
  });
}
export function useUpdateContact(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Contact> }) =>
      clientsApi.updateContact(id, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(clientId) }),
  });
}
export function useDeleteContact(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientsApi.deleteContact(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(clientId) }),
  });
}

// --- Atividades ---

export function useActivities(clientId: string) {
  return useQuery({
    queryKey: queryKeys.activities.byClient(clientId),
    queryFn: () => clientsApi.listActivities(clientId),
  });
}
export function useCreateActivity(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Activity>) => clientsApi.createActivity(body),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.activities.byClient(clientId),
      }),
  });
}
export function useCompleteActivity(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientsApi.completeActivity(id),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.activities.byClient(clientId),
      }),
  });
}
