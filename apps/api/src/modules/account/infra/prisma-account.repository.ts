import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AccountRepository,
  ContaDoTitular,
} from '../domain/account.repository';
import type { EncerramentoAgendado } from '../domain/account-deletion';

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(ownerId: string): Promise<ContaDoTitular | null> {
    return this.prisma.db.user.findUnique({
      where: { id: ownerId },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
      },
    });
  }

  async agendarEncerramento(
    ownerId: string,
    agendamento: EncerramentoAgendado,
  ): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: ownerId },
      data: {
        deletionRequestedAt: agendamento.requestedAt,
        deletionScheduledFor: agendamento.scheduledFor,
      },
    });
  }

  async cancelarEncerramento(ownerId: string): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: ownerId },
      data: { deletionRequestedAt: null, deletionScheduledFor: null },
    });
  }
}
