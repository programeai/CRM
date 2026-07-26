import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { organizacaoApi } from './organizacao.api';
import type {
  CreateCollaboratorBody,
  RoleBody,
  UpdateCollaboratorBody,
} from './types';

// --- Colaboradores ---

export function useCollaborators() {
  return useQuery({
    queryKey: queryKeys.collaborators.all,
    queryFn: () => organizacaoApi.listCollaborators(),
  });
}

export function useCreateCollaborator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCollaboratorBody) =>
      organizacaoApi.createCollaborator(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.collaborators.all });
      // A contagem de colaboradores por papel muda junto.
      void qc.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}

export function useUpdateCollaborator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCollaboratorBody }) =>
      organizacaoApi.updateCollaborator(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.collaborators.all });
      void qc.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) => organizacaoApi.resendInvite(id),
  });
}

// --- Papéis ---

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles.all,
    queryFn: () => organizacaoApi.listRoles(),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RoleBody) => organizacaoApi.createRole(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

export function useUpdateRole(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RoleBody) => organizacaoApi.updateRole(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.roles.all });
      // Editar o próprio papel muda as permissões da sessão em curso.
      void qc.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

export function useRemoveRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      organizacaoApi.removeRolePermission(id, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.roles.all });
      void qc.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => organizacaoApi.deleteRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

// --- Catálogo de permissões ---

/** Catálogo estático no servidor: cache longo, sem refetch a cada foco. */
export function usePermissionCatalog() {
  return useQuery({
    queryKey: queryKeys.permissions.catalog,
    queryFn: () => organizacaoApi.permissionCatalog(),
    staleTime: 60 * 60 * 1000,
  });
}

// --- Convite (público) ---

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: queryKeys.invites.detail(token),
    queryFn: () => organizacaoApi.invitePreview(token),
    // Token inválido responde 410: repetir não muda o resultado.
    retry: false,
    enabled: token.length > 0,
  });
}
