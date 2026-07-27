import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  CollaboratorRepository,
  CollaboratorView,
} from '../domain/collaborator.repository';

/** Projeção que nunca traz `passwordHash`. */
const SELECT = {
  id: true,
  name: true,
  email: true,
  active: true,
  acceptedAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, system: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class PrismaCollaboratorRepository implements CollaboratorRepository {
  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
  ) {}

  findManyByOwner(ownerId: string): Promise<CollaboratorView[]> {
    return this.prisma.db.user.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
      select: SELECT,
    });
  }

  findByIdAndOwner(
    id: string,
    ownerId: string,
  ): Promise<CollaboratorView | null> {
    return this.prisma.db.user.findFirst({
      where: { id, ownerId },
      select: SELECT,
    });
  }

  async findOwnerName(ownerId: string): Promise<string> {
    const owner = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { name: true },
    });
    return owner.name;
  }

  /**
   * `User.email` é único no banco inteiro, então a checagem tem de atravessar
   * owners — e `prisma.db` não veria a conta de outro owner por causa do filtro
   * de aplicação. Só devolve o booleano: nunca vaza de quem é o e-mail.
   */
  async existsByEmail(email: string): Promise<boolean> {
    const found = await this.admin.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return found !== null;
  }

  create(data: {
    ownerId: string;
    name: string;
    email: string;
    roleId: string;
  }): Promise<CollaboratorView> {
    // `passwordHash` nulo e `acceptedAt` nulo = convite pendente: o colaborador
    // define a senha pelo link (ver InvitesService) e só então consegue entrar.
    return this.prisma.db.user.create({
      data: { ...data, active: true },
      select: SELECT,
    });
  }

  update(
    id: string,
    ownerId: string,
    data: { roleId?: string; active?: boolean },
  ): Promise<CollaboratorView> {
    // updateMany garante o filtro por ownerId; devolve o registro atualizado.
    return this.prisma.db.user
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.db.user.findFirstOrThrow({
          where: { id, ownerId },
          select: SELECT,
        }),
      );
  }

  /**
   * Desativar sem revogar deixaria vivos os refresh tokens dos navegadores dele.
   * O filtro por `ownerId` é redundante com o `findOrFail` do service, mas
   * `Session`/`User` não têm RLS — a defesa é explícita por princípio.
   */
  async revokeSessions(id: string, ownerId: string): Promise<number> {
    const target = await this.prisma.db.user.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!target) return 0;
    const { count } = await this.prisma.db.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
