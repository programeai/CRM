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
    return this.prisma.db.task.create({ data, include: withProject });
  }

  findById(id: string) {
    return this.prisma.db.task.findUnique({
      where: { id },
      include: withProject,
    });
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
    const [data, total] = await Promise.all([
      this.prisma.db.task.findMany({
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
      this.prisma.db.task.count({ where }),
    ]);
    return { data, total };
  }

  findAllForBoard(projectId: string) {
    return this.prisma.db.task.findMany({
      where: { projectId },
      include: withProject,
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
  }

  findAllForBoardByOwner(ownerId: string) {
    return this.prisma.db.task.findMany({
      where: { project: { client: { ownerId } } },
      include: withProject,
      // prazo mais próximo primeiro; nulls por último (Prisma põe null no fim em asc)
      orderBy: [
        { status: 'asc' },
        { dueDate: 'asc' },
        { priority: 'desc' },
        { position: 'asc' },
      ],
    });
  }

  update(id: string, data: Prisma.TaskUpdateInput) {
    return this.prisma.db.task.update({
      where: { id },
      data,
      include: withProject,
    });
  }

  async delete(id: string) {
    await this.prisma.db.task.delete({ where: { id } });
  }

  async maxPositionInStatus(projectId: string, status: TaskStatus) {
    const r = await this.prisma.db.task.aggregate({
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
    // Roda dentro da transação do request (this.prisma.db) — atômico sem
    // abrir uma transação aninhada (Prisma não suporta).
    const db = this.prisma.db;
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const { projectId } = task;
    const fromStatus = task.status;

    const target = await db.task.findMany({
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

    await db.task.update({
      where: { id: taskId },
      data: { status: toStatus, ...patch },
    });
    await Promise.all(
      orderedIds.map((id, index) =>
        db.task.update({ where: { id }, data: { position: index } }),
      ),
    );

    if (fromStatus !== toStatus) {
      const from = await db.task.findMany({
        where: { projectId, status: fromStatus },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await Promise.all(
        from.map((t, index) =>
          db.task.update({ where: { id: t.id }, data: { position: index } }),
        ),
      );
    }

    return db.task.findUniqueOrThrow({
      where: { id: taskId },
      include: withProject,
    });
  }
}
