import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

@Injectable()
export class PrismaPipelineStageRepository implements PipelineStageRepository {
  constructor(private prisma: PrismaService) {}

  findAllOrdered() {
    return this.prisma.pipelineStage.findMany({ orderBy: { order: 'asc' } });
  }
  findById(id: string) {
    return this.prisma.pipelineStage.findUnique({ where: { id } });
  }
  findByName(name: string) {
    return this.prisma.pipelineStage.findUnique({ where: { name } });
  }
  create(data: Prisma.PipelineStageUncheckedCreateInput) {
    return this.prisma.pipelineStage.create({ data });
  }
  update(id: string, data: Prisma.PipelineStageUpdateInput) {
    return this.prisma.pipelineStage.update({ where: { id }, data });
  }
  async delete(id: string) {
    await this.prisma.pipelineStage.delete({ where: { id } });
  }
  async maxOrder() {
    const r = await this.prisma.pipelineStage.aggregate({
      _max: { order: true },
    });
    return r._max.order ?? -1;
  }
  countDeals(stageId: string) {
    return this.prisma.deal.count({ where: { stageId } });
  }
  async reorder(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.pipelineStage.update({
          where: { id },
          data: { order: index },
        }),
      ),
    );
  }
}
