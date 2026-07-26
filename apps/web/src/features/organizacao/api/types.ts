/** Situação derivada do colaborador (o backend calcula a partir do aceite). */
export type CollaboratorStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

export type Collaborator = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  status: CollaboratorStatus;
  role: { id: string; name: string; system: boolean } | null;
  createdAt: string;
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
  /** Papel criado com a conta ("Administrador"): imexível e sempre total. */
  system: boolean;
  permissions: string[];
  collaboratorsCount: number;
  createdAt: string;
};

/** Catálogo de permissões — os rótulos em pt-BR vêm todos do backend. */
export type PermissionMeta = {
  key: string;
  label: string;
  description: string;
  category: string;
};

export type PermissionGroup = {
  category: string;
  permissions: PermissionMeta[];
};

export type InviteResult = {
  inviteUrl: string;
  inviteExpiresInDays: number;
};

export type CreateCollaboratorBody = {
  name: string;
  email: string;
  roleId: string;
};

export type UpdateCollaboratorBody = {
  roleId?: string;
  active?: boolean;
};

export type RoleBody = {
  name: string;
  description?: string;
  permissions: string[];
};

/** Dados públicos do convite, exibidos na tela de aceite. */
export type InvitePreview = {
  name: string;
  email: string;
  ownerName: string;
  expiresInDays: number;
};
