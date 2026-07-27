import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  InboxFilter,
  NotificationRepository,
  PendingDelivery,
} from '../domain/notification.repository';

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  criar(data: Prisma.NotificationUncheckedCreateInput) {
    // Caminho do request: `prisma.db` (dentro da transação, sob RLS).
    return this.prisma.db.notification.create({ data });
  }

  // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
  criarPeloSistema(data: Prisma.NotificationUncheckedCreateInput) {
    return this.admin.notification.create({ data });
  }

  // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
  async dedupeKeysExistentes(
    userId: string,
    chaves: string[],
  ): Promise<Set<string>> {
    if (chaves.length === 0) return new Set();
    const existentes = await this.admin.notification.findMany({
      where: { userId, dedupeKey: { in: chaves } },
      select: { dedupeKey: true },
    });
    return new Set(
      existentes.map((n) => n.dedupeKey).filter((k): k is string => k !== null),
    );
  }

  async findInboxAndCount(filter: InboxFilter) {
    const where: Prisma.NotificationDeliveryWhereInput = {
      ownerId: filter.ownerId,
      userId: filter.userId,
      kind: 'IN_APP',
      ...(filter.unreadOnly ? { readAt: null } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: { notification: true },
      }),
      this.prisma.db.notificationDelivery.count({ where }),
    ]);
    return { data, total };
  }

  contarNaoLidas(ownerId: string, userId: string) {
    return this.prisma.db.notificationDelivery.count({
      where: { ownerId, userId, kind: 'IN_APP', readAt: null },
    });
  }

  async marcarLida(
    ownerId: string,
    userId: string,
    deliveryId: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.db.notificationDelivery.updateMany({
      where: { id: deliveryId, ownerId, userId, kind: 'IN_APP', readAt: null },
      data: { readAt: new Date() },
    });
    return count > 0;
  }

  async marcarTodasLidas(ownerId: string, userId: string): Promise<number> {
    const { count } = await this.prisma.db.notificationDelivery.updateMany({
      where: { ownerId, userId, kind: 'IN_APP', readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }

  // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
  findParaDigestPeloSistema(ownerId: string, userId: string, desde: Date) {
    return this.admin.notification.findMany({
      where: { ownerId, userId, createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- outbox (client admin, cross-owner) ---

  async findPendentes(now: Date, take: number): Promise<PendingDelivery[]> {
    return this.admin.notificationDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take,
      include: {
        notification: true,
        target: { select: { id: true, kind: true, config: true } },
      },
    });
  }

  async marcarEnviada(id: string, sentAt: Date): Promise<void> {
    await this.admin.notificationDelivery.update({
      where: { id },
      data: { status: 'SENT', sentAt },
    });
  }

  async marcarPulada(id: string, motivo: string): Promise<void> {
    await this.admin.notificationDelivery.update({
      where: { id },
      data: { status: 'SKIPPED', lastError: motivo },
    });
  }

  async marcarFalha(
    id: string,
    attempts: number,
    nextAttemptAt: Date | null,
    erro: string,
  ): Promise<void> {
    await this.admin.notificationDelivery.update({
      where: { id },
      data: {
        attempts,
        status: nextAttemptAt === null ? 'FAILED' : 'PENDING',
        nextAttemptAt: nextAttemptAt ?? undefined,
        lastError: erro,
      },
    });
  }
}
