import type { Request } from 'express';
import type { PermissionKey } from '../../../shared/permissions';

/**
 * Quem está pedindo e o que pode — resolvido uma vez por requisição pelo
 * `AccessGuard` e publicado em `req.access`.
 *
 * A distinção que sustenta o isolamento: `userId` é a identidade (perfil,
 * logout, senha) e `ownerId` é a **workspace** (dono dos dados e da assinatura).
 * No owner os dois são iguais; no colaborador, `ownerId` é o id de quem o
 * convidou — e é esse valor que vira `app.owner_id` no RLS.
 */
export interface AccessContext {
  userId: string;
  ownerId: string;
  /** `true` quando o usuário é o dono da workspace (acesso total, imexível). */
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: PermissionKey[];
}

/** Requisição autenticada: `user` vem do `JwtAuthGuard`, `access` do `AccessGuard`. */
export type AuthenticatedRequest = Request & {
  user?: { sub?: string };
  access?: AccessContext;
};
