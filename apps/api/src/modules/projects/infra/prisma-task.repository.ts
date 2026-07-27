import { Injectable } from '@nestjs/common';
import type { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  TaskListFilter,
  TaskMovePatch,
  TaskRepository,
  TaskTagRef,
} from '../domain/task.repository';
import { countTags, type TagUsage } from '../../../shared/tags';
import {
  ALL_RECORDS,
  assigneeScopeWhere,
  type AssigneeScope,
} from '../../../shared/record-scope';

const withProject = {
  project: {
    select: {
      id: true,
      name: true,
      clientId: true,
      client: { select: { id: true, name: true } },
    },
  },
  assignee: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PrismaTaskRepository implements TaskRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.TaskUncheckedCreateInput) {
    return this.prisma.db.task.create({ data, include: withProject });
  }

  findById(id: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    // findFirst (não findUnique): o recorte faz parte da busca.
    return this.prisma.db.task.findFirst({
      where: { id, ...(scoped ? { AND: [scoped] } : {}) },
      include: withProject,
    });
  }

  async findManyAndCount(filter: TaskListFilter) {
    const scoped = assigneeScopeWhere(filter.scope);
    const where: Prisma.TaskWhereInput = {
      project: {
        client: { ownerId: filter.ownerId },
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
      },
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.dueBefore ? { dueDate: { lte: filter.dueBefore } } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(scoped ? { AND: [scoped] } : {}),
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

  findAllForBoard(
    projectId: string,
    scope: AssigneeScope = ALL_RECORDS,
    assigneeId?: string,
  ) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.task.findMany({
      where: {
        projectId,
        ...(assigneeId ? { assigneeId } : {}),
        ...(scoped ? { AND: [scoped] } : {}),
      },
      include: withProject,
      orderBy: [{ status: 'asc' }, { position: 'asc' }],
    });
  }

  findAllForBoardByOwner(
    ownerId: string,
    scope: AssigneeScope = ALL_RECORDS,
    assigneeId?: string,
  ) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.task.findMany({
      where: {
        project: { client: { ownerId } },
        ...(assigneeId ? { assigneeId } : {}),
        ...(scoped ? { AND: [scoped] } : {}),
      },
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

  update(id: string, data: Prisma.TaskUncheckedUpdateInput) {
    return this.prisma.db.task.update({
      where: { id },
      data,
      include: withProject,
    });
  }

  async delete(id: string) {
    await this.prisma.db.task.delete({ where: { id } });
  }

  async listOwnerTags(ownerId: string): Promise<TagUsage[]> {
    // Tags são um String[] por tarefa (sem catálogo próprio); a fonte de verdade
    // das "tags existentes" é a agregação distinta sobre todas as tarefas do dono.
    const rows = await this.prisma.db.task.findMany({
      where: { project: { client: { ownerId } } },
      select: { tags: true },
    });
    return countTags(rows);
  }

  findByTag(ownerId: string, tag: string): Promise<TaskTagRef[]> {
    return this.prisma.db.task.findMany({
      where: { project: { client: { ownerId } }, tags: { has: tag } },
      select: {
        id: true,
        title: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: { title: 'asc' },
    });
  }

  async removeTagFromAll(ownerId: string, tag: string): Promise<number> {
    // Postgres não remove elemento de array em updateMany; carrega as afetadas e
    // reescreve cada array sem a tag. Roda na transação do request (this.prisma.db).
    const affected = await this.prisma.db.task.findMany({
      where: { project: { client: { ownerId } }, tags: { has: tag } },
      select: { id: true, tags: true },
    });
    await Promise.all(
      affected.map((t) =>
        this.prisma.db.task.update({
          where: { id: t.id },
          data: { tags: t.tags.filter((x) => x !== tag) },
        }),
      ),
    );
    return affected.length;
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
