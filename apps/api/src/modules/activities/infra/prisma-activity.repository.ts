import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ActivityListFilter,
  ActivityRepository,
} from '../domain/activity.repository';
import {
  ALL_RECORDS,
  assigneeScopeWhere,
  type AssigneeScope,
} from '../../../shared/record-scope';

/** Responsável embutido na leitura — a timeline exibe o nome. */
const withAssignee = {
  assignee: { select: { id: true, name: true } },
  // O rótulo do tipo é o dado (catálogo por owner), e `isFollowUp` é a REGRA
  // de que a timeline depende para o predicado de follow-up pendente.
  type: { select: { id: true, name: true, active: true, isFollowUp: true } },
} satisfies Prisma.ActivityInclude;

@Injectable()
export class PrismaActivityRepository implements ActivityRepository {
  constructor(private prisma: PrismaService) {}

  async findManyAndCount(filter: ActivityListFilter) {
    const scoped = assigneeScopeWhere(filter.scope);
    const where: Prisma.ActivityWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.dealId ? { dealId: filter.dealId } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(scoped ? { AND: [scoped] } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.activity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: withAssignee,
      }),
      this.prisma.db.activity.count({ where }),
    ]);
    return { data, total };
  }

  async nextScheduledByDeal(
    ownerId: string,
    dealIds: string[],
    scope: AssigneeScope = ALL_RECORDS,
  ) {
    if (dealIds.length === 0) return []; // quadro vazio: nem consulta
    const scoped = assigneeScopeWhere(scope);
    const rows = await this.prisma.db.activity.groupBy({
      by: ['dealId'],
      where: {
        ownerId,
        dealId: { in: dealIds },
        // Mesmo predicado do cron de lembretes e do dashboard: a REGRA vem do
        // catálogo (`isFollowUp`), não do nome do tipo.
        type: { isFollowUp: true },
        completedAt: null,
        scheduledFor: { not: null },
        ...(scoped ? { AND: [scoped] } : {}),
      },
      _min: { scheduledFor: true },
    });
    // `dealId` é anulável no schema, então o groupBy o tipa como `string | null`
    // — o `in` acima já exclui o nulo; o guarda existe para o TypeScript.
    return rows.flatMap((r) =>
      r.dealId && r._min.scheduledFor
        ? [{ dealId: r.dealId, scheduledFor: r._min.scheduledFor }]
        : [],
    );
  }

  findById(id: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    // findFirst (não findUnique): o recorte faz parte da busca.
    return this.prisma.db.activity.findFirst({
      where: { id, ...(scoped ? { AND: [scoped] } : {}) },
      include: withAssignee,
    });
  }

  create(data: Prisma.ActivityUncheckedCreateInput) {
    return this.prisma.db.activity.create({ data, include: withAssignee });
  }

  update(id: string, data: Prisma.ActivityUncheckedUpdateInput) {
    return this.prisma.db.activity.update({
      where: { id },
      data,
      include: withAssignee,
    });
  }
}
