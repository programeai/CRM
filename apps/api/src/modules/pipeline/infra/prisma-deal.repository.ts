import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  DealListFilter,
  DealMovePatch,
  DealRepository,
} from '../domain/deal.repository';

const withClient = { client: { select: { id: true, name: true } } } as const;

@Injectable()
export class PrismaDealRepository implements DealRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.DealUncheckedCreateInput) {
    return this.prisma.deal.create({ data, include: withClient });
  }

  findById(id: string) {
    return this.prisma.deal.findUnique({ where: { id }, include: withClient });
  }

  async findManyAndCount(filter: DealListFilter) {
    const where: Prisma.DealWhereInput = {
      client: { ownerId: filter.ownerId },
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.stageId ? { stageId: filter.stageId } : {}),
      ...(filter.search
        ? { title: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.deal.findMany({
        where,
        include: withClient,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.deal.count({ where }),
    ]);
    return { data, total };
  }

  findAllForBoard(ownerId: string) {
    return this.prisma.deal.findMany({
      where: { client: { ownerId } },
      include: withClient,
      orderBy: [{ stageId: 'asc' }, { position: 'asc' }],
    });
  }

  update(id: string, data: Prisma.DealUpdateInput) {
    return this.prisma.deal.update({
      where: { id },
      data,
      include: withClient,
    });
  }

  async delete(id: string) {
    await this.prisma.deal.delete({ where: { id } });
  }

  async maxPositionInStage(stageId: string) {
    const r = await this.prisma.deal.aggregate({
      where: { stageId },
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
    return this.prisma.$transaction(async (tx) => {
      const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId } });
      const fromStageId = deal.stageId;

      // Coluna destino sem o deal em movimento, na ordem atual.
      const target = await tx.deal.findMany({
        where: { stageId: toStageId, id: { not: dealId } },
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
      await tx.deal.update({
        where: { id: dealId },
        data: { stageId: toStageId, ...patch },
      });
      await Promise.all(
        orderedIds.map((id, index) =>
          tx.deal.update({ where: { id }, data: { position: index } }),
        ),
      );

      // Se mudou de coluna, reindexa a coluna de origem (fecha o buraco).
      if (fromStageId !== toStageId) {
        const from = await tx.deal.findMany({
          where: { stageId: fromStageId },
          orderBy: { position: 'asc' },
          select: { id: true },
        });
        await Promise.all(
          from.map((d, index) =>
            tx.deal.update({ where: { id: d.id }, data: { position: index } }),
          ),
        );
      }

      return tx.deal.findUniqueOrThrow({
        where: { id: dealId },
        include: withClient,
      });
    });
  }
}
