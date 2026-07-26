import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ALL_PERMISSION_KEYS,
  sanitizePermissionKeys,
  visiblePermissionKeys,
} from '../../../shared/permissions';
import {
  ROLE_REPOSITORY,
  type RoleRepository,
  type RoleWithUsage,
} from '../domain/role.repository';

/** Papel como o front consome: permissões já resolvidas e sem as ocultas. */
export interface RoleResponse {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: string[];
  collaboratorsCount: number;
  createdAt: Date;
}

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
  ) {}

  async list(ownerId: string): Promise<RoleResponse[]> {
    const roles = await this.roles.findManyByOwner(ownerId);
    return roles.map((role) => this.toResponse(role));
  }

  async create(
    ownerId: string,
    data: { name: string; description?: string; permissions: string[] },
  ): Promise<RoleResponse> {
    const name = data.name.trim();
    await this.assertNameFree(ownerId, name);

    const role = await this.roles.create({
      ownerId,
      name,
      description: data.description?.trim() || null,
      permissions: sanitizePermissionKeys(data.permissions),
    });
    this.logger.log({
      evento: 'papel.criado',
      msg: 'Papel criado.',
      papelId: role.id,
      permissoes: role.permissions.length,
    });
    return this.toResponse({ ...role, collaboratorsCount: 0 });
  }

  async update(
    ownerId: string,
    id: string,
    data: { name: string; description?: string; permissions: string[] },
  ): Promise<RoleResponse> {
    const current = await this.findOrFail(ownerId, id);
    this.assertNotSystem(current);

    const name = data.name.trim();
    await this.assertNameFree(ownerId, name, id);

    const role = await this.roles.update(id, ownerId, {
      name,
      description: data.description?.trim() || null,
      permissions: sanitizePermissionKeys(data.permissions),
    });
    this.logger.log({
      evento: 'papel.atualizado',
      msg: 'Papel atualizado.',
      papelId: id,
      permissoes: role.permissions.length,
    });
    return this.toResponse({
      ...role,
      collaboratorsCount: current.collaboratorsCount,
    });
  }

  /** Remoção pontual de uma permissão, direto do detalhe do papel. */
  async removePermission(
    ownerId: string,
    id: string,
    key: string,
  ): Promise<RoleResponse> {
    const current = await this.findOrFail(ownerId, id);
    this.assertNotSystem(current);

    const role = await this.roles.updatePermissions(
      id,
      ownerId,
      current.permissions.filter((p) => p !== key),
    );
    this.logger.log({
      evento: 'papel.atualizado',
      msg: 'Permissão removida do papel.',
      papelId: id,
      permissoes: role.permissions.length,
    });
    return this.toResponse({
      ...role,
      collaboratorsCount: current.collaboratorsCount,
    });
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const role = await this.findOrFail(ownerId, id);
    this.assertNotSystem(role);
    if (role.collaboratorsCount > 0) {
      throw new ConflictException(
        'Este papel está em uso por colaboradores. Troque o papel deles antes de excluir.',
      );
    }
    await this.roles.delete(id, ownerId);
    this.logger.log({
      evento: 'papel.excluido',
      msg: 'Papel excluído.',
      papelId: id,
    });
  }

  /** Garante que o papel existe **no owner** — usado ao convidar/trocar papel. */
  async findOrFail(ownerId: string, id: string): Promise<RoleWithUsage> {
    const role = await this.roles.findById(id, ownerId);
    if (!role) throw new NotFoundException('Papel não encontrado.');
    return role;
  }

  private assertNotSystem(role: RoleWithUsage) {
    if (role.system) {
      throw new ForbiddenException(
        'O papel do sistema não pode ser editado nem excluído.',
      );
    }
  }

  private async assertNameFree(
    ownerId: string,
    name: string,
    exceptId?: string,
  ) {
    const conflict = await this.roles.findByName(ownerId, name);
    if (conflict && conflict.id !== exceptId) {
      throw new ConflictException('Já existe um papel com este nome.');
    }
  }

  /**
   * Papel do sistema vale o catálogo inteiro (mesma regra do `AccessService`),
   * então é isso que a interface mostra. Chaves ocultas não são exibidas.
   */
  private toResponse(role: RoleWithUsage): RoleResponse {
    const permissions = role.system
      ? ALL_PERMISSION_KEYS
      : sanitizePermissionKeys(role.permissions);
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      system: role.system,
      permissions: visiblePermissionKeys(permissions),
      collaboratorsCount: role.collaboratorsCount,
      createdAt: role.createdAt,
    };
  }
}
