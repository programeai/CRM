import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateRoleData,
  RoleRepository,
  RoleWithUsage,
  UpdateRoleData,
} from '../domain/role.repository';

/** Registro do Prisma com a contagem de colaboradores vinculados. */
type RoleRow = Role & { _count: { users: number } };

function toRoleWithUsage({ _count, ...role }: RoleRow): RoleWithUsage {
  return { ...role, collaboratorsCount: _count.users };
}

@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  constructor(private prisma: PrismaService) {}

  /** `Role` tem RLS: `prisma.db` já roda sob o `app.owner_id` da requisição. */
  async findManyByOwner(ownerId: string): Promise<RoleWithUsage[]> {
    const rows = await this.prisma.db.role.findMany({
      where: { ownerId },
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
    return rows.map(toRoleWithUsage);
  }

  async findById(id: string, ownerId: string): Promise<RoleWithUsage | null> {
    const row = await this.prisma.db.role.findFirst({
      where: { id, ownerId },
      include: { _count: { select: { users: true } } },
    });
    return row ? toRoleWithUsage(row) : null;
  }

  findByName(ownerId: string, name: string) {
    return this.prisma.db.role.findFirst({ where: { ownerId, name } });
  }

  create(data: CreateRoleData) {
    return this.prisma.db.role.create({ data });
  }

  update(id: string, ownerId: string, data: UpdateRoleData) {
    // updateMany garante o filtro por ownerId; devolve o registro atualizado.
    return this.prisma.db.role
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.db.role.findFirstOrThrow({ where: { id, ownerId } }),
      );
  }

  updatePermissions(id: string, ownerId: string, permissions: string[]) {
    return this.prisma.db.role
      .updateMany({ where: { id, ownerId }, data: { permissions } })
      .then(() =>
        this.prisma.db.role.findFirstOrThrow({ where: { id, ownerId } }),
      );
  }

  async delete(id: string, ownerId: string): Promise<void> {
    await this.prisma.db.role.deleteMany({ where: { id, ownerId } });
  }
}
