import { api } from '@/lib/api';
import type {
  Collaborator,
  CreateCollaboratorBody,
  InvitePreview,
  InviteResult,
  PermissionGroup,
  Role,
  RoleBody,
  UpdateCollaboratorBody,
} from './types';

export const organizacaoApi = {
  // --- Colaboradores ---
  listCollaborators: () =>
    api.get<Collaborator[]>('/collaborators').then((r) => r.data),
  createCollaborator: (body: CreateCollaboratorBody) =>
    api
      .post<{ collaborator: Collaborator } & InviteResult>(
        '/collaborators',
        body,
      )
      .then((r) => r.data),
  updateCollaborator: (id: string, body: UpdateCollaboratorBody) =>
    api.patch<Collaborator>(`/collaborators/${id}`, body).then((r) => r.data),
  resendInvite: (id: string) =>
    api
      .post<InviteResult>(`/collaborators/${id}/invite`)
      .then((r) => r.data),

  // --- Papéis ---
  listRoles: () => api.get<Role[]>('/roles').then((r) => r.data),
  createRole: (body: RoleBody) =>
    api.post<Role>('/roles', body).then((r) => r.data),
  updateRole: (id: string, body: RoleBody) =>
    api.patch<Role>(`/roles/${id}`, body).then((r) => r.data),
  removeRolePermission: (id: string, key: string) =>
    api
      .delete<Role>(`/roles/${id}/permissions/${encodeURIComponent(key)}`)
      .then((r) => r.data),
  deleteRole: (id: string) => api.delete(`/roles/${id}`).then((r) => r.data),

  // --- Catálogo de permissões (fonte dos rótulos em pt-BR) ---
  permissionCatalog: () =>
    api.get<PermissionGroup[]>('/permissions').then((r) => r.data),

  // --- Convite (rotas públicas: sem sessão) ---
  invitePreview: (token: string) =>
    api
      .get<InvitePreview>(`/collaborators/invite/${token}`)
      .then((r) => r.data),
  acceptInvite: (token: string, password: string) =>
    api
      .post<{ accessToken: string }>(
        `/collaborators/invite/${token}/accept`,
        { password },
      )
      .then((r) => r.data),
};
