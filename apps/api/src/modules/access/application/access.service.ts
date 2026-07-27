import { Injectable } from '@nestjs/common';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import {
  ALL_PERMISSION_KEYS,
  sanitizePermissionKeys,
  type PermissionKey,
} from '../../../shared/permissions';
import type { AccessContext } from '../domain/access-context';

/**
 * Resolve o contexto de acesso de um usuário autenticado.
 *
 * Usa o `PrismaAdminService` de propósito: esta leitura acontece **antes** de
 * existir contexto de RLS na requisição (é ela que descobre qual `ownerId`
 * usar), e `Role` tem RLS — pelo client da aplicação a consulta voltaria vazia.
 *
 * Custo: uma consulta indexada por requisição autenticada. É deliberado — troca
 * de papel e desativação de colaborador valem na requisição seguinte, sem
 * esperar o access token expirar.
 */
@Injectable()
export class AccessService {
  constructor(private readonly admin: PrismaAdminService) {}

  /** `null` quando o usuário não existe ou está desativado (nega o acesso). */
  async resolve(userId: string): Promise<AccessContext | null> {
    const user = await this.admin.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        active: true,
        role: {
          select: { id: true, name: true, system: true, permissions: true },
        },
      },
    });
    if (!user || !user.active) return null;

    // Owner: acesso total por definição, sem papel atribuído.
    if (user.ownerId === null) {
      return {
        userId: user.id,
        userName: user.name,
        ownerId: user.id,
        isOwner: true,
        roleId: null,
        roleName: null,
        permissions: ALL_PERMISSION_KEYS,
      };
    }

    return {
      userId: user.id,
      userName: user.name,
      ownerId: user.ownerId,
      isOwner: false,
      roleId: user.role?.id ?? null,
      roleName: user.role?.name ?? null,
      permissions: this.permissionsOf(user.role),
    };
  }

  /**
   * Permissões efetivas de um papel. Papel do sistema ("Administrador") vale o
   * catálogo **inteiro**, resolvido aqui — assim uma permissão nova não deixa o
   * papel desatualizado. Colaborador sem papel não pode nada.
   */
  private permissionsOf(
    role: { system: boolean; permissions: string[] } | null,
  ): PermissionKey[] {
    if (!role) return [];
    if (role.system) return ALL_PERMISSION_KEYS;
    return sanitizePermissionKeys(role.permissions);
  }
}
