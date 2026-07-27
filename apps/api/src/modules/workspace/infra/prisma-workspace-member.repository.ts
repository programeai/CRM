import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  WorkspaceMember,
  WorkspaceMemberRepository,
} from '../domain/workspace-member.repository';

/**
 * "Membro atribuível" = o owner (ownerId nulo) **ou** um colaborador dele que já
 * aceitou o convite e está ativo. Convite pendente (`acceptedAt` nulo) e
 * colaborador desativado ficam de fora: não podem receber atribuição nova.
 *
 * `User` não tem RLS — este `where` é a única barreira, não há policy por trás.
 */
const membersOf = (ownerId: string): Prisma.UserWhereInput => ({
  OR: [
    { id: ownerId, ownerId: null },
    { ownerId, active: true, acceptedAt: { not: null } },
  ],
});

@Injectable()
export class PrismaWorkspaceMemberRepository implements WorkspaceMemberRepository {
  constructor(private prisma: PrismaService) {}

  async findManyByOwner(ownerId: string): Promise<WorkspaceMember[]> {
    const rows = await this.prisma.db.user.findMany({
      where: membersOf(ownerId),
      orderBy: { name: 'asc' },
      select: { id: true, name: true, ownerId: true },
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      isOwner: u.ownerId === null,
    }));
  }

  async isMember(ownerId: string, userId: string): Promise<boolean> {
    const found = await this.prisma.db.user.findFirst({
      where: { AND: [{ id: userId }, membersOf(ownerId)] },
      select: { id: true },
    });
    return found !== null;
  }
}
