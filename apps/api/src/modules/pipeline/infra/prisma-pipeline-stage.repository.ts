import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

@Injectable()
export class PrismaPipelineStageRepository implements PipelineStageRepository {
  constructor(private prisma: PrismaService) {}

  findAllOrdered(ownerId: string) {
    return this.prisma.db.pipelineStage.findMany({
      where: { ownerId },
      orderBy: { order: 'asc' },
    });
  }

  async findAllIds(ownerId: string) {
    const rows = await this.prisma.db.pipelineStage.findMany({
      where: { ownerId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  findById(id: string, ownerId: string) {
    // findFirst (não findUnique): o filtro por ownerId faz parte da busca.
    return this.prisma.db.pipelineStage.findFirst({ where: { id, ownerId } });
  }

  findByName(ownerId: string, name: string) {
    return this.prisma.db.pipelineStage.findUnique({
      where: { ownerId_name: { ownerId, name } },
    });
  }

  create(data: Prisma.PipelineStageUncheckedCreateInput) {
    return this.prisma.db.pipelineStage.create({ data });
  }

  update(
    id: string,
    ownerId: string,
    data: Prisma.PipelineStageUncheckedUpdateManyInput,
  ) {
    // updateMany garante o filtro por ownerId; devolve o registro atualizado.
    return this.prisma.db.pipelineStage
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.db.pipelineStage.findFirstOrThrow({
          where: { id, ownerId },
        }),
      );
  }

  async delete(id: string, ownerId: string) {
    await this.prisma.db.pipelineStage.deleteMany({ where: { id, ownerId } });
  }

  async maxOrder(ownerId: string) {
    const r = await this.prisma.db.pipelineStage.aggregate({
      where: { ownerId },
      _max: { order: true },
    });
    return r._max.order ?? -1;
  }

  countDeals(stageId: string, ownerId: string) {
    return this.prisma.db.deal.count({ where: { stageId, ownerId } });
  }

  async reorder(ownerId: string, ids: string[]) {
    // Atômico via transação do request; sem $transaction aninhado.
    const db = this.prisma.db;
    await Promise.all(
      ids.map((id, index) =>
        db.pipelineStage.updateMany({
          where: { id, ownerId },
          data: { order: index },
        }),
      ),
    );
  }
}
