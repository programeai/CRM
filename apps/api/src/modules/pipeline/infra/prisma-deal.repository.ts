import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  DealListFilter,
  DealMovePatch,
  DealRepository,
} from '../domain/deal.repository';
import {
  ALL_RECORDS,
  assigneeScopeWhere,
  type AssigneeScope,
} from '../../../shared/record-scope';
import { ATIVO, ativoWhere } from '../../../shared/soft-delete';

const withClient = {
  client: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  // O rótulo do motivo é o dado (catálogo por owner) — sem o include, a UI
  // exibiria o uuid. Ver features/catalogos no web.
  lostReason: { select: { id: true, name: true, active: true } },
  serviceType: { select: { id: true, name: true, active: true } },
} as const;

@Injectable()
export class PrismaDealRepository implements DealRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.DealUncheckedCreateInput) {
    return this.prisma.db.deal.create({ data, include: withClient });
  }

  findById(
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
    includeArchived = false,
  ) {
    const scoped = assigneeScopeWhere(scope);
    // findFirst (não findUnique): o recorte e o soft delete fazem parte da busca.
    return this.prisma.db.deal.findFirst({
      where: {
        id,
        ...ativoWhere(includeArchived),
        ...(scoped ? { AND: [scoped] } : {}),
      },
      include: withClient,
    });
  }

  async findManyAndCount(filter: DealListFilter) {
    const scoped = assigneeScopeWhere(filter.scope);
    const where: Prisma.DealWhereInput = {
      client: { ownerId: filter.ownerId },
      ...ATIVO,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.stageId ? { stageId: filter.stageId } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.search
        ? { title: { contains: filter.search, mode: 'insensitive' } }
        : {}),
      ...(scoped ? { AND: [scoped] } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.deal.findMany({
        where,
        include: withClient,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.deal.count({ where }),
    ]);
    return { data, total };
  }

  findAllForBoard(
    ownerId: string,
    scope: AssigneeScope = ALL_RECORDS,
    assigneeId?: string,
  ) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.deal.findMany({
      where: {
        client: { ownerId },
        ...ATIVO,
        ...(assigneeId ? { assigneeId } : {}),
        ...(scoped ? { AND: [scoped] } : {}),
      },
      include: withClient,
      orderBy: [{ stageId: 'asc' }, { position: 'asc' }],
    });
  }

  update(id: string, data: Prisma.DealUncheckedUpdateInput) {
    return this.prisma.db.deal.update({
      where: { id },
      data,
      include: withClient,
    });
  }

  async delete(id: string) {
    await this.prisma.db.deal.delete({ where: { id } });
  }

  archive(id: string) {
    return this.prisma.db.deal.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: withClient,
    });
  }

  restore(id: string) {
    return this.prisma.db.deal.update({
      where: { id },
      data: { archivedAt: null },
      include: withClient,
    });
  }

  async maxPositionInStage(stageId: string) {
    const r = await this.prisma.db.deal.aggregate({
      // Um deal arquivado não deve reservar posição na coluna.
      where: { stageId, ...ATIVO },
      _max: { position: true },
    });
    return r._max.position ?? -1;
  }

  async move(
    dealId: string,
    toStageId: string,
    toPosition: number,
    patch: DealMovePatch,
  ) {
    // Roda dentro da transação do request (this.prisma.db) — atômico sem
    // abrir uma transação aninhada (Prisma não suporta).
    const db = this.prisma.db;
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    const fromStageId = deal.stageId;

    // Coluna destino sem o deal em movimento, na ordem atual.
    const target = await db.deal.findMany({
      where: { stageId: toStageId, id: { not: dealId }, ...ATIVO },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const clamped = Math.max(0, Math.min(toPosition, target.length));
    const orderedIds = [
      ...target.slice(0, clamped).map((d) => d.id),
      dealId,
      ...target.slice(clamped).map((d) => d.id),
    ];

    // Atualiza o deal em movimento (stage + patch) e reindexa a coluna destino.
    await db.deal.update({
      where: { id: dealId },
      data: { stageId: toStageId, ...patch },
    });
    await Promise.all(
      orderedIds.map((id, index) =>
        db.deal.update({ where: { id }, data: { position: index } }),
      ),
    );

    // Se mudou de coluna, reindexa a coluna de origem (fecha o buraco).
    if (fromStageId !== toStageId) {
      const from = await db.deal.findMany({
        where: { stageId: fromStageId, ...ATIVO },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await Promise.all(
        from.map((d, index) =>
          db.deal.update({ where: { id: d.id }, data: { position: index } }),
        ),
      );
    }

    return db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: withClient,
    });
  }
}
