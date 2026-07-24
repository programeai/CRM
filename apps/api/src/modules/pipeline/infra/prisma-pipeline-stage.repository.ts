import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

@Injectable()
export class PrismaPipelineStageRepository implements PipelineStageRepository {
  constructor(private prisma: PrismaService) {}

  // PipelineStage é global (sem RLS); usa `db` por uniformidade e para
  // participar da transação do request.
  findAllOrdered() {
    return this.prisma.db.pipelineStage.findMany({ orderBy: { order: 'asc' } });
  }
  findById(id: string) {
    return this.prisma.db.pipelineStage.findUnique({ where: { id } });
  }
  findByName(name: string) {
    return this.prisma.db.pipelineStage.findUnique({ where: { name } });
  }
  create(data: Prisma.PipelineStageUncheckedCreateInput) {
    return this.prisma.db.pipelineStage.create({ data });
  }
  update(id: string, data: Prisma.PipelineStageUpdateInput) {
    return this.prisma.db.pipelineStage.update({ where: { id }, data });
  }
  async delete(id: string) {
    await this.prisma.db.pipelineStage.delete({ where: { id } });
  }
  async maxOrder() {
    const r = await this.prisma.db.pipelineStage.aggregate({
      _max: { order: true },
    });
    return r._max.order ?? -1;
  }
  countDeals(stageId: string) {
    return this.prisma.db.deal.count({ where: { stageId } });
  }
  async reorder(ids: string[]) {
    // Atômico via transação do request; sem $transaction aninhado.
    const db = this.prisma.db;
    await Promise.all(
      ids.map((id, index) =>
        db.pipelineStage.update({ where: { id }, data: { order: index } }),
      ),
    );
  }
}
