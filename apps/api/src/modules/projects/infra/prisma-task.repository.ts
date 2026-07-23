import { Injectable } from '@nestjs/common';
import type { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  TaskListFilter,
  TaskMovePatch,
  TaskRepository,
} from '../domain/task.repository';

const withProject = {
  project: {
    select: {
      id: true,
      name: true,
      clientId: true,
      client: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class PrismaTaskRepository implements TaskRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.TaskUncheckedCreateInput) {
    return this.prisma.task.create({ data, include: withProject });
  }

  findById(id: string) {
    return this.prisma.task.findUnique({ where: { id }, include: withProject });
  }

  async findManyAndCount(filter: TaskListFilter) {
    const where: Prisma.TaskWhereInput = {
      project: {
        client: { ownerId: filter.ownerId },
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
      },
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.dueBefore ? { dueDate: { lte: filter.dueBefore } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: withProject,
        // prazo mais próximo primeiro; nulls por último (Prisma põe null no fim em asc)
        orderBy: [
          { dueDate: 'asc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { data, total };
  }

  findAllForBoard(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId },
      include: withProject,
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
  }

  update(id: string, data: Prisma.TaskUpdateInput) {
    return this.prisma.task.update({
      where: { id },
      data,
      include: withProject,
    });
  }

  async delete(id: string) {
    await this.prisma.task.delete({ where: { id } });
  }

  async maxPositionInStatus(projectId: string, status: TaskStatus) {
    const r = await this.prisma.task.aggregate({
      where: { projectId, status },
      _max: { position: true },
    });
    return r._max.position ?? -1;
  }

  async move(
    taskId: string,
    toStatus: TaskStatus,
    toPosition: number,
    patch: TaskMovePatch,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      const { projectId } = task;
      const fromStatus = task.status;

      const target = await tx.task.findMany({
        where: { projectId, status: toStatus, id: { not: taskId } },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      const clamped = Math.max(0, Math.min(toPosition, target.length));
      const orderedIds = [
        ...target.slice(0, clamped).map((t) => t.id),
        taskId,
        ...target.slice(clamped).map((t) => t.id),
      ];

      await tx.task.update({
        where: { id: taskId },
        data: { status: toStatus, ...patch },
      });
      await Promise.all(
        orderedIds.map((id, index) =>
          tx.task.update({ where: { id }, data: { position: index } }),
        ),
      );

      if (fromStatus !== toStatus) {
        const from = await tx.task.findMany({
          where: { projectId, status: fromStatus },
          orderBy: { position: 'asc' },
          select: { id: true },
        });
        await Promise.all(
          from.map((t, index) =>
            tx.task.update({ where: { id: t.id }, data: { position: index } }),
          ),
        );
      }

      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: withProject,
      });
    });
  }
}
