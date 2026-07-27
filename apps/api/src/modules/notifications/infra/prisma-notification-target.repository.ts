import { Injectable } from '@nestjs/common';
import type {
  NotificationChannelKind,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import {
  TIPOS_PADRAO,
  type DestinoDeDigest,
  type NotificationTargetRepository,
} from '../domain/notification-target.repository';

@Injectable()
export class PrismaNotificationTargetRepository implements NotificationTargetRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  findElegiveis(ownerId: string, userId: string, tipo: NotificationType) {
    return this.prisma.db.userNotificationTarget.findMany({
      where: {
        ownerId,
        userId,
        active: true,
        verified: true,
        types: { has: tipo },
      },
      select: { id: true, kind: true },
    });
  }

  // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
  findElegiveisPeloSistema(
    ownerId: string,
    userId: string,
    tipo: NotificationType,
  ) {
    return this.admin.userNotificationTarget.findMany({
      where: {
        ownerId,
        userId,
        active: true,
        verified: true,
        types: { has: tipo },
      },
      select: { id: true, kind: true },
    });
  }

  findManyByUser(ownerId: string, userId: string) {
    return this.prisma.db.userNotificationTarget.findMany({
      where: { ownerId, userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  criar(data: Prisma.UserNotificationTargetUncheckedCreateInput) {
    return this.prisma.db.userNotificationTarget.create({ data });
  }

  async atualizar(
    ownerId: string,
    userId: string,
    id: string,
    data: Prisma.UserNotificationTargetUpdateInput,
  ) {
    const existente = await this.prisma.db.userNotificationTarget.findFirst({
      where: { id, ownerId, userId },
    });
    if (!existente) return null;
    return this.prisma.db.userNotificationTarget.update({
      where: { id },
      data,
    });
  }

  async excluir(ownerId: string, userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.db.userNotificationTarget.deleteMany({
      where: { id, ownerId, userId },
    });
    return count > 0;
  }

  // Provisionamento na criação da conta / aceite de convite — client admin
  // (RLS ativo e nenhum dos dois caminhos tem contexto de owner).
  async provisionarPadraoPeloSistema(params: {
    ownerId: string;
    userId: string;
    email: string;
    kinds: NotificationChannelKind[];
  }): Promise<void> {
    const configPorKind: Record<string, Prisma.InputJsonValue> = {
      IN_APP: {},
      EMAIL: { email: params.email },
    };
    await this.admin.userNotificationTarget.createMany({
      data: params.kinds.map((kind) => ({
        ownerId: params.ownerId,
        userId: params.userId,
        kind,
        label:
          kind === 'IN_APP' ? 'Central de notificações' : 'E-mail da conta',
        config: configPorKind[kind] ?? {},
        types: TIPOS_PADRAO,
        verified: true,
        active: true,
      })),
    });
  }

  async findDestinosDeDigestPeloSistema(): Promise<DestinoDeDigest[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    const destinos = await this.admin.userNotificationTarget.findMany({
      where: { kind: 'EMAIL', active: true, verified: true },
      select: { ownerId: true, userId: true, config: true },
    });
    return (
      destinos
        .map((d) => ({
          ownerId: d.ownerId,
          userId: d.userId,
          email: (d.config as { email?: string })?.email ?? '',
        }))
        // Destino sem endereço é dado corrompido, não motivo de erro no cron.
        .filter((d) => d.email.length > 0)
    );
  }
}
