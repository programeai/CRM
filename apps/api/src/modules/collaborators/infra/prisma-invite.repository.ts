import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  InviteRepository,
  InviteWithUser,
} from '../domain/invite.repository';

@Injectable()
export class PrismaInviteRepository implements InviteRepository {
  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
  ) {}

  /** Emissão roda no contexto do owner → client sujeito a RLS. */
  async replaceForUser(data: {
    ownerId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const { ownerId, userId, tokenHash, expiresAt } = data;
    // Apagar antes de criar é o que faz "só o último link enviado valer".
    await this.prisma.db.collaboratorInvite.deleteMany({
      where: { userId, ownerId },
    });
    await this.prisma.db.collaboratorInvite.create({
      data: { ownerId, userId, tokenHash, expiresAt },
    });
  }

  /**
   * Consulta pública (o convidado ainda não tem sessão), portanto sem contexto
   * de owner: `CollaboratorInvite` tem RLS e só o client admin enxerga a linha.
   */
  async findByTokenHash(tokenHash: string): Promise<InviteWithUser | null> {
    const invite = await this.admin.collaboratorInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        ownerId: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            active: true,
            acceptedAt: true,
            // O nome do owner vem por aqui: `CollaboratorInvite.ownerId` é
            // coluna denormalizada para o RLS (como em Contact/Deal, sem FK),
            // enquanto `User.owner` é a relação de verdade.
            owner: { select: { name: true } },
          },
        },
      },
    });
    if (!invite) return null;
    const { owner, ...user } = invite.user;
    return { ...invite, user, owner: { name: owner?.name ?? '' } };
  }

  /**
   * Também pública → client admin. O `updateMany` condicionado a `usedAt: null`
   * é a trava de uso único: dois envios simultâneos do mesmo link, só um passa.
   */
  async consumeAndActivate(data: {
    inviteId: string;
    userId: string;
    passwordHash: string;
  }): Promise<boolean> {
    const { inviteId, userId, passwordHash } = data;
    return this.admin.$transaction(async (tx) => {
      const { count } = await tx.collaboratorInvite.updateMany({
        where: { id: inviteId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) return false;
      await tx.user.update({
        where: { id: userId },
        // `passwordSetAt` junto com o hash: a senha veio do formulário de
        // aceite, então o colaborador a conhece.
        data: {
          passwordHash,
          acceptedAt: new Date(),
          passwordSetAt: new Date(),
        },
      });
      return true;
    });
  }
}
