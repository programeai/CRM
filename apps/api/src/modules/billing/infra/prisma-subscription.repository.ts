import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  SubscriptionRepository,
  SubscriptionSnapshot,
  SubscriptionSyncResult,
  SubscriptionUpsert,
} from '../domain/subscription.repository';

const SNAPSHOT_SELECT = {
  status: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
} as const;

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  // --- caminho HTTP (owner atual, sob RLS via prisma.db) ---

  async findByOwnerId(ownerId: string): Promise<SubscriptionSnapshot | null> {
    const sub = await this.prisma.db.subscription.findUnique({
      where: { ownerId },
      select: {
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });
    return sub;
  }

  async findByOwnerIdForGate(
    ownerId: string,
  ): Promise<SubscriptionSnapshot | null> {
    // Gate roda antes do contexto de RLS → admin, filtrando pelo owner do JWT.
    const sub = await this.admin.subscription.findUnique({
      where: { ownerId },
      select: {
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });
    return sub;
  }

  async getUserStripeCustomerId(ownerId: string): Promise<string | null> {
    // User está fora do RLS — visível mesmo no tx de owner.
    const user = await this.prisma.db.user.findUnique({
      where: { id: ownerId },
      select: { stripeCustomerId: true },
    });
    return user?.stripeCustomerId ?? null;
  }

  async setUserStripeCustomerId(
    ownerId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: ownerId },
      data: { stripeCustomerId },
    });
  }

  // --- caminho webhook (sem owner; admin bypassa RLS) ---

  async upsertByStripeCustomerId(
    stripeCustomerId: string,
    data: SubscriptionUpsert,
  ): Promise<SubscriptionSyncResult | null> {
    // Resolve o owner pelo id de cliente Stripe gravado no User.
    const user = await this.admin.user.findUnique({
      where: { stripeCustomerId },
      select: { id: true },
    });
    if (!user) return null; // evento sem owner mapeável → ignora (idempotente)

    // Estado anterior para a trilha: é o que permite ao chamador registrar só
    // quando o evento mudou alguma coisa (o Stripe reenvia).
    const antes = await this.admin.subscription.findUnique({
      where: { ownerId: user.id },
      select: SNAPSHOT_SELECT,
    });

    const depois = await this.admin.subscription.upsert({
      where: { ownerId: user.id },
      create: {
        ownerId: user.id,
        status: data.status ?? 'INCOMPLETE',
        stripeSubscriptionId: data.stripeSubscriptionId ?? null,
        trialEndsAt: data.trialEndsAt ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      },
      update: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.stripeSubscriptionId !== undefined
          ? { stripeSubscriptionId: data.stripeSubscriptionId }
          : {}),
        ...(data.trialEndsAt !== undefined
          ? { trialEndsAt: data.trialEndsAt }
          : {}),
        ...(data.currentPeriodEnd !== undefined
          ? { currentPeriodEnd: data.currentPeriodEnd }
          : {}),
        ...(data.cancelAtPeriodEnd !== undefined
          ? { cancelAtPeriodEnd: data.cancelAtPeriodEnd }
          : {}),
      },
      select: SNAPSHOT_SELECT,
    });

    return { ownerId: user.id, antes, depois };
  }
}
