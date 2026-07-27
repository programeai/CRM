import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  DashboardRepository,
  FunnelStageRow,
  ProposalStatusCount,
  UpcomingActionRow,
  UpcomingPaymentRow,
  UpcomingTaskRow,
} from '../domain/dashboard.repository';
import {
  ALL_RECORDS,
  assigneeScopeWhere,
  type AssigneeScope,
} from '../../../shared/record-scope';
import { ATIVO } from '../../../shared/soft-delete';

const toNumber = (value: { toString(): string } | null | undefined): number =>
  value == null ? 0 : Number(value);

@Injectable()
export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private prisma: PrismaService) {}

  async funnel(
    ownerId: string,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<FunnelStageRow[]> {
    const scoped = assigneeScopeWhere(scope);
    // Estágios e agregados, ambos do owner (RLS + filtro explícito). O recorte
    // por responsável vale só para os deals — estágio é do owner, não de alguém.
    const [stages, grouped] = await Promise.all([
      this.prisma.db.pipelineStage.findMany({
        where: { ownerId },
        orderBy: { order: 'asc' },
      }),
      this.prisma.db.deal.groupBy({
        by: ['stageId'],
        where: {
          client: { ownerId },
          ...ATIVO,
          ...(scoped ? { AND: [scoped] } : {}),
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const byStage = new Map(grouped.map((g) => [g.stageId, g]));
    return stages.map((s) => {
      const g = byStage.get(s.id);
      return {
        stageId: s.id,
        name: s.name,
        isWon: s.isWon,
        isLost: s.isLost,
        count: g?._count._all ?? 0,
        amount: toNumber(g?._sum.amount),
      };
    });
  }

  async proposalsOpen(ownerId: string) {
    const r = await this.prisma.db.proposal.aggregate({
      where: {
        client: { ownerId },
        status: { in: ['DRAFT', 'SENT', 'NEGOTIATING'] },
      },
      _count: { _all: true },
      _sum: { total: true },
    });
    return { count: r._count._all, amount: toNumber(r._sum.total) };
  }

  proposalsAcceptedCount(ownerId: string, from: Date, to: Date) {
    return this.prisma.db.proposal.count({
      where: {
        client: { ownerId },
        status: 'ACCEPTED',
        decidedAt: { gte: from, lt: to },
      },
    });
  }

  async proposalsDecidedSince(
    ownerId: string,
    since: Date,
  ): Promise<ProposalStatusCount[]> {
    const rows = await this.prisma.db.proposal.groupBy({
      by: ['status'],
      where: { client: { ownerId }, decidedAt: { gte: since } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  tasksInProgressCount(ownerId: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.task.count({
      where: {
        project: { client: { ownerId } },
        status: 'IN_PROGRESS',
        ...ATIVO,
        ...(scoped ? { AND: [scoped] } : {}),
      },
    });
  }

  tasksOverdueCount(
    ownerId: string,
    now: Date,
    scope: AssigneeScope = ALL_RECORDS,
  ) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.task.count({
      where: {
        project: { client: { ownerId } },
        status: { not: 'DONE' },
        dueDate: { lt: now },
        ...ATIVO,
        ...(scoped ? { AND: [scoped] } : {}),
      },
    });
  }

  async upcomingTasks(
    ownerId: string,
    now: Date,
    until: Date,
    take: number,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<UpcomingTaskRow[]> {
    const scoped = assigneeScopeWhere(scope);
    const rows = await this.prisma.db.task.findMany({
      where: {
        project: { client: { ownerId } },
        status: { not: 'DONE' },
        dueDate: { gte: now, lte: until },
        ...ATIVO,
        ...(scoped ? { AND: [scoped] } : {}),
      },
      orderBy: { dueDate: 'asc' },
      take,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      projectId: t.project.id,
      projectName: t.project.name,
      clientId: t.project.client.id,
      clientName: t.project.client.name,
    }));
  }

  async upcomingActions(
    ownerId: string,
    take: number,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<UpcomingActionRow[]> {
    const scoped = assigneeScopeWhere(scope);
    const rows = await this.prisma.db.activity.findMany({
      where: {
        client: { ownerId },
        type: 'FOLLOW_UP',
        completedAt: null,
        scheduledFor: { not: null },
        ...(scoped ? { AND: [scoped] } : {}),
      },
      orderBy: { scheduledFor: 'asc' },
      take,
      select: {
        id: true,
        type: true,
        content: true,
        scheduledFor: true,
        client: { select: { id: true, name: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      type: a.type,
      content: a.content,
      scheduledFor: a.scheduledFor,
      clientId: a.client.id,
      clientName: a.client.name,
    }));
  }

  async monthlyRecurringRevenue(ownerId: string) {
    const r = await this.prisma.db.contract.aggregate({
      where: {
        client: { ownerId },
        status: 'ACTIVE',
        billingType: 'RECURRING',
      },
      _sum: { monthlyAmount: true },
    });
    return toNumber(r._sum.monthlyAmount);
  }

  async monthSchedule(ownerId: string, monthStart: Date, monthEnd: Date) {
    const dueInMonth = { gte: monthStart, lt: monthEnd };
    // Previsto: tudo que vence no mês e não foi cancelado.
    // Recebido: das cobranças pagas, o valor efetivamente recebido —
    // `paidAmount` quando informado (parcial/diferente), senão `amount`.
    const [expected, paidWithAmount, paidWithoutAmount] = await Promise.all([
      this.prisma.db.payment.aggregate({
        where: {
          contract: { client: { ownerId } },
          status: { not: 'CANCELED' },
          dueDate: dueInMonth,
        },
        _sum: { amount: true },
      }),
      this.prisma.db.payment.aggregate({
        where: {
          contract: { client: { ownerId } },
          status: 'PAID',
          dueDate: dueInMonth,
          paidAmount: { not: null },
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.db.payment.aggregate({
        where: {
          contract: { client: { ownerId } },
          status: 'PAID',
          dueDate: dueInMonth,
          paidAmount: null,
        },
        _sum: { amount: true },
      }),
    ]);
    return {
      expected: toNumber(expected._sum.amount),
      received:
        toNumber(paidWithAmount._sum.paidAmount) +
        toNumber(paidWithoutAmount._sum.amount),
    };
  }

  async overdueTotal(ownerId: string, now: Date) {
    const r = await this.prisma.db.payment.aggregate({
      where: {
        contract: { client: { ownerId } },
        OR: [
          { status: 'OVERDUE' },
          { status: 'PENDING', dueDate: { lt: now } },
        ],
      },
      _sum: { amount: true },
    });
    return toNumber(r._sum.amount);
  }

  async upcomingPayments(
    ownerId: string,
    now: Date,
    until: Date,
    take: number,
  ): Promise<UpcomingPaymentRow[]> {
    const rows = await this.prisma.db.payment.findMany({
      where: {
        contract: { client: { ownerId } },
        status: 'PENDING',
        dueDate: { gte: now, lte: until },
      },
      orderBy: { dueDate: 'asc' },
      take,
      select: {
        id: true,
        description: true,
        dueDate: true,
        amount: true,
        contract: {
          select: { id: true, client: { select: { id: true, name: true } } },
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      description: p.description,
      dueDate: p.dueDate,
      amount: toNumber(p.amount),
      contractId: p.contract.id,
      clientId: p.contract.client.id,
      clientName: p.contract.client.name,
    }));
  }
}
