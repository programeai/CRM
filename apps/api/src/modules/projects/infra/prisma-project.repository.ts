import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ProjectListFilter,
  ProjectRepository,
} from '../domain/project.repository';

const withClient = {
  client: { select: { id: true, name: true } },
  _count: { select: { tasks: true } },
} as const;

@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ProjectUncheckedCreateInput) {
    return this.prisma.db.project.create({ data, include: withClient });
  }

  findById(id: string) {
    return this.prisma.db.project.findUnique({
      where: { id },
      include: withClient,
    });
  }

  async findManyAndCount(filter: ProjectListFilter) {
    const where: Prisma.ProjectWhereInput = {
      client: { ownerId: filter.ownerId },
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? { name: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.project.findMany({
        where,
        include: withClient,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.project.count({ where }),
    ]);
    return { data, total };
  }

  findByClient(clientId: string) {
    return this.prisma.db.project.findMany({
      where: { clientId },
      include: withClient,
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.ProjectUpdateInput) {
    return this.prisma.db.project.update({
      where: { id },
      data,
      include: withClient,
    });
  }

  async delete(id: string) {
    await this.prisma.db.project.delete({ where: { id } });
  }

  async countTasks(projectId: string) {
    return this.prisma.db.task.count({ where: { projectId } });
  }

  findByDealId(dealId: string) {
    return this.prisma.db.project.findFirst({
      where: { dealId },
      include: withClient,
    });
  }
}
