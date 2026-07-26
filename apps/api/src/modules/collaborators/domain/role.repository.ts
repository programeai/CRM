import type { Role } from '@prisma/client';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

/** Papel com a contagem de colaboradores que o usam (exibida na listagem). */
export type RoleWithUsage = Role & { collaboratorsCount: number };

export interface CreateRoleData {
  ownerId: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface UpdateRoleData {
  name: string;
  description: string | null;
  permissions: string[];
}

export interface RoleRepository {
  /** Papéis do owner, com o papel do sistema primeiro e o resto por nome. */
  findManyByOwner(ownerId: string): Promise<RoleWithUsage[]>;
  findById(id: string, ownerId: string): Promise<RoleWithUsage | null>;
  findByName(ownerId: string, name: string): Promise<Role | null>;
  create(data: CreateRoleData): Promise<Role>;
  update(id: string, ownerId: string, data: UpdateRoleData): Promise<Role>;
  updatePermissions(
    id: string,
    ownerId: string,
    permissions: string[],
  ): Promise<Role>;
  delete(id: string, ownerId: string): Promise<void>;
}
