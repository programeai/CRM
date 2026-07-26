import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  TASK_REPOSITORY,
  type TaskRepository,
  type TaskTagRef,
  type TaskWithProject,
} from '../domain/task.repository';
import { ProjectsService } from './projects.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import { normalizeTag, type TagUsage } from '../../../shared/tags';
import type { CreateTaskDto } from '../api/dto/create-task.dto';
import type { UpdateTaskDto } from '../api/dto/update-task.dto';
import type { ListTasksQueryDto } from '../api/dto/list-tasks-query.dto';
import type { MoveTaskDto } from '../api/dto/move-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: TaskRepository,
    private readonly projects: ProjectsService,
  ) {}

  async list(ownerId: string, query: ListTasksQueryDto) {
    if (query.projectId) await this.projects.findOne(ownerId, query.projectId);
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      projectId: query.projectId,
      clientId: query.clientId,
      status: query.status,
      priority: query.priority,
      dueBefore: query.dueBefore ? new Date(query.dueBefore) : undefined,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async board(ownerId: string, projectId?: string): Promise<TaskWithProject[]> {
    if (projectId) {
      await this.projects.findOne(ownerId, projectId); // posse
      return this.repo.findAllForBoard(projectId);
    }
    // Sem projectId → board cross-projeto de "Minhas demandas" (todas as tarefas do dono).
    return this.repo.findAllForBoardByOwner(ownerId);
  }

  async findOne(ownerId: string, id: string): Promise<TaskWithProject> {
    return this.loadOwned(ownerId, id);
  }

  async create(ownerId: string, dto: CreateTaskDto): Promise<TaskWithProject> {
    await this.projects.findOne(ownerId, dto.projectId); // valida posse do projeto
    const status = dto.status ?? 'BACKLOG';
    const position =
      (await this.repo.maxPositionInStatus(dto.projectId, status)) + 1;
    return this.repo.create({
      ownerId,
      projectId: dto.projectId,
      title: dto.title,
      description: dto.description ?? null,
      status,
      priority: dto.priority ?? 'MEDIUM',
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      position,
      tags: dto.tags ?? [],
      checklist: dto.checklist
        ? (dto.checklist as unknown as Prisma.InputJsonValue)
        : undefined,
      completedAt: status === 'DONE' ? new Date() : null,
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<TaskWithProject> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.dueDate !== undefined
        ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
        : {}),
      ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
      ...(dto.checklist !== undefined
        ? { checklist: dto.checklist as unknown as Prisma.InputJsonValue }
        : {}),
    });
  }

  async move(
    ownerId: string,
    id: string,
    dto: MoveTaskDto,
  ): Promise<TaskWithProject> {
    const task = await this.loadOwned(ownerId, id);
    const patch: { completedAt?: Date | null } = {};
    if (dto.status === 'DONE' && task.status !== 'DONE') {
      patch.completedAt = new Date();
    } else if (dto.status !== 'DONE' && task.status === 'DONE') {
      patch.completedAt = null;
    }
    return this.repo.move(id, dto.status, dto.position, patch);
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.loadOwned(ownerId, id);
    await this.repo.delete(id);
  }

  /** Tags existentes do dono (agregadas das tarefas) com contagem de uso. */
  listTags(ownerId: string): Promise<TagUsage[]> {
    return this.repo.listOwnerTags(ownerId);
  }

  /** Tarefas do dono que usam a tag — para exibir o uso antes de excluir. */
  tagUsage(ownerId: string, tag: string): Promise<TaskTagRef[]> {
    return this.repo.findByTag(ownerId, normalizeTag(tag));
  }

  /** Exclui a tag de todas as tarefas do dono. Retorna quantas foram afetadas. */
  async deleteTag(ownerId: string, tag: string): Promise<{ removed: number }> {
    const removed = await this.repo.removeTagFromAll(
      ownerId,
      normalizeTag(tag),
    );
    return { removed };
  }

  /** Carrega a task garantindo posse via o projeto→cliente do dono (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<TaskWithProject> {
    const task = await this.repo.findById(id);
    if (!task) throw new NotFoundException('Tarefa não encontrada.');
    await this.projects.findOne(ownerId, task.projectId); // posse via projeto→cliente (404 se não for do dono)
    return task;
  }
}
