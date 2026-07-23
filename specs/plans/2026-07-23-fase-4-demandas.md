---
date: 2026-07-23T17:53:52-03:00
author: claude
source_prd: specs/research/2026-07-23-fase-4-demandas.md
git_commit: 1122a04035c09163bafdee5256f5baa895c8d643
branch: main
status: implemented
tags: [spec, projects, tasks, kanban, dnd-kit, project-on-won]
---

# Spec: Fase 4 — Demandas (Projetos e Tarefas)

## Overview

Implementar o módulo **Demandas** — a organização do trabalho após a venda. No backend, um módulo NestJS `projects` cobre dois agregados em fatias verticais: **Projetos** (CRUD) e **Tarefas** (CRUD + board + drag & drop por status). No frontend, a feature `demandas` entrega a lista de projetos, a ficha do projeto com **Kanban dnd-kit** (update otimista + rollback), a visão **"Minhas demandas"** cruzando projetos, e o gancho **"criar Projeto ao ganhar"**.

A estratégia é clonar padrões já maduros e verificados: o backend espelha `pipeline/` (move + reindex em `$transaction`, posse derivada via `loadOwned`, DI por token, `@Cron` não é necessário) e `proposals/` (CRUD paginado, specs de service). O frontend espelha `pipeline/` (Kanban dnd-kit, mutation otimista, `reindexBoard`) e `propostas/` (listagem/ficha/form dialog, `extractApiMessage`, tradutores de enum).

Os modelos `Project`/`Task` e os três enums já existem no schema; os tradutores `translateProjectStatus/TaskStatus/TaskPriority` já existem em `@/lib/labels`. A **única migration** da fase adiciona `Project.dealId` (Fase 4), necessária para deduplicar a criação automática de projeto ao ganhar.

## Current State

- **Backend**: não existe módulo `projects`/`tasks` em `apps/api/src/modules/`. `Project`/`Task`/enums já em [schema.prisma:142-176](apps/api/prisma/schema.prisma#L142-L176) e [:275-295](apps/api/prisma/schema.prisma#L275-L295). `Project` tem `proposalId?` mas **não** tem `dealId` nem `position`. `Task` tem `position Int` + `@@index([projectId, status, position])`.
- **Frontend**: `/demandas`, `/projetos/:id` e a aba `projetos` do cliente são `PlaceholderPage`/`PlaceholderTab` ([router.tsx:37,44,45](apps/web/src/routes/router.tsx#L37-L45)). Nav só tem "Demandas" ([nav.ts:35](apps/web/src/app/nav.ts#L35)).
- **"Criar Projeto ao ganhar"**: não implementado. `DealsService.move` só trata `isLost` ([deals.service.ts:104](apps/api/src/modules/pipeline/application/deals.service.ts#L104)). `ProposalsService.accept` chama `moveDealToWon` ([proposals.service.ts:243-254](apps/api/src/modules/proposals/application/proposals.service.ts#L243-L254)), que apenas move o deal.

Ver o PRD para o mapa completo de padrões.

## Desired End State

- Módulo `projects` completo (Projetos + Tarefas) com rotas documentadas em `ENDPOINTS.md`, seguindo repository pattern (`PrismaService` só em `infra/`) e posse derivada Task→Project→Client.
- Frontend: `/projetos` (lista em tabela), `/projetos/:id` (ficha + Kanban dnd-kit de tarefas por status + checklist), `/demandas` ("Minhas demandas" cruzando projetos com filtros e realce de atrasadas), aba `projetos` da ficha do cliente, item "Projetos" no nav.
- Ao mover um deal para um estágio `isWon` (arrastando no Kanban **ou** via aceite de proposta), um `Project` é criado automaticamente a partir do deal, **sem duplicar** em re-ganhos (dedupe por `Project.dealId`).
- Toda mensagem visível em pt-BR; enums sempre traduzidos.

## What We're NOT Doing

- **Contratos/Financeiro** (Fase 5) — `Project.contracts` e `Contract` ficam intocados.
- **Cron de atraso** — "atrasada" é derivado no client (`dueDate < hoje && status !== 'DONE'`), sem estado persistido nem job agendado.
- **Máquina de estados de Task** — transição livre entre colunas; único efeito é `completedAt` (set em DONE, limpa ao sair). Sem 422 de transição.
- **`Project.position`** — lista de projetos é tabela; só `Task` tem board.
- **`position` de Task via lista** — o board é a única fonte de reordenação; a lista "Minhas demandas" é read-only ordenada por prazo/prioridade.
- **Seed de demonstração** — deferido para a Fase 6.
- **Página/rota de detalhe de Task** — a task é criada/editada por dialog; o toggle de checklist acontece inline na ficha do projeto.
- **RBAC/permissões** — `ownerId` continua derivado; sem multi-tenant.

---

## Phase 1: Backend — módulo `projects` (Projetos + Tarefas)

### Goal
Entregar o CRUD de Projetos e Tarefas, o board de tarefas e o `move` (drag & drop reindexado), com posse derivada, specs e documentação — sem migration.

### Changes

Estrutura nova em `apps/api/src/modules/projects/`:
```
projects/
  projects.module.ts
  domain/
    project.repository.ts
    task.repository.ts
  application/
    projects.service.ts (+ .spec.ts)
    tasks.service.ts   (+ .spec.ts)
  infra/
    prisma-project.repository.ts
    prisma-task.repository.ts
  api/
    projects.controller.ts
    tasks.controller.ts
    dto/
      create-project.dto.ts
      update-project.dto.ts
      list-projects-query.dto.ts
      create-task.dto.ts
      update-task.dto.ts
      list-tasks-query.dto.ts
      move-task.dto.ts
      checklist-item.dto.ts
```

#### Domain

**Create**: `apps/api/src/modules/projects/domain/project.repository.ts`
Token DI + interface + tipo de domínio (espelha [deal.repository.ts](apps/api/src/modules/pipeline/domain/deal.repository.ts)).
```ts
import type { Prisma } from '@prisma/client';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

/** Project + dados mínimos do cliente + contagem de tarefas para listagem/ficha. */
export type ProjectWithClient = Prisma.ProjectGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    _count: { select: { tasks: true } };
  };
}>;

export interface ProjectListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  status?: import('@prisma/client').ProjectStatus;
  search?: string; // casa em name
  skip: number;
  take: number;
}

export interface ProjectRepository {
  create(data: Prisma.ProjectUncheckedCreateInput): Promise<ProjectWithClient>;
  findById(id: string): Promise<ProjectWithClient | null>;
  findManyAndCount(
    filter: ProjectListFilter,
  ): Promise<{ data: ProjectWithClient[]; total: number }>;
  /** Todos os projetos de um cliente (para a aba do cliente). */
  findByClient(clientId: string): Promise<ProjectWithClient[]>;
  update(id: string, data: Prisma.ProjectUpdateInput): Promise<ProjectWithClient>;
  delete(id: string): Promise<void>;
  countTasks(projectId: string): Promise<number>;
}
```
> **Escopo Fase 1**: a interface acima **não** inclui `findByDealId` (depende de `Project.dealId`, que só existe após a migration da Fase 4). O método é adicionado à interface e à impl na Fase 4.

**Create**: `apps/api/src/modules/projects/domain/task.repository.ts`
```ts
import type { Prisma, TaskStatus } from '@prisma/client';

export const TASK_REPOSITORY = Symbol('TASK_REPOSITORY');

/** Task + projeto/cliente mínimos para o board e para "Minhas demandas". */
export type TaskWithProject = Prisma.TaskGetPayload<{
  include: {
    project: {
      select: {
        id: true;
        name: true;
        clientId: true;
        client: { select: { id: true; name: true } };
      };
    };
  };
}>;

export interface TaskListFilter {
  ownerId: string; // filtra por project.client.ownerId
  projectId?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: import('@prisma/client').TaskPriority;
  dueBefore?: Date; // dueDate <= dueBefore (para "atrasadas"/prazo)
  skip: number;
  take: number;
}

/** Campos ajustados no destino durante um move (calculados no service). */
export interface TaskMovePatch {
  completedAt?: Date | null;
}

export interface TaskRepository {
  create(data: Prisma.TaskUncheckedCreateInput): Promise<TaskWithProject>;
  findById(id: string): Promise<TaskWithProject | null>;
  findManyAndCount(
    filter: TaskListFilter,
  ): Promise<{ data: TaskWithProject[]; total: number }>;
  /** Todas as tarefas de um projeto, ordenadas por (status, position) — alimenta o board. */
  findAllForBoard(projectId: string): Promise<TaskWithProject[]>;
  update(id: string, data: Prisma.TaskUpdateInput): Promise<TaskWithProject>;
  delete(id: string): Promise<void>;
  /** Maior `position` na coluna status do projeto (ou -1 se vazia). */
  maxPositionInStatus(projectId: string, status: TaskStatus): Promise<number>;
  /** Move a task p/ (status, position) reindexando as colunas afetadas em transação. */
  move(
    taskId: string,
    toStatus: TaskStatus,
    toPosition: number,
    patch: TaskMovePatch,
  ): Promise<TaskWithProject>;
}
```

#### Infra

**Create**: `apps/api/src/modules/projects/infra/prisma-project.repository.ts`
```ts
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
    return this.prisma.project.create({ data, include: withClient });
  }

  findById(id: string) {
    return this.prisma.project.findUnique({ where: { id }, include: withClient });
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
    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: withClient,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { data, total };
  }

  findByClient(clientId: string) {
    return this.prisma.project.findMany({
      where: { clientId },
      include: withClient,
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.ProjectUpdateInput) {
    return this.prisma.project.update({ where: { id }, data, include: withClient });
  }

  async delete(id: string) {
    await this.prisma.project.delete({ where: { id } });
  }

  async countTasks(projectId: string) {
    return this.prisma.task.count({ where: { projectId } });
  }
}
```

**Create**: `apps/api/src/modules/projects/infra/prisma-task.repository.ts`
`move` clona o algoritmo de [prisma-deal.repository.ts:74-127](apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts#L74-L127) trocando `stageId`→`status` e escopo por `projectId`.
```ts
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
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
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
    return this.prisma.task.update({ where: { id }, data, include: withProject });
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
```

#### DTOs (api/dto)

**Create**: `create-project.dto.ts`
```ts
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ServiceType } from '@prisma/client';

export class CreateProjectDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsEnum(ServiceType, { message: 'Tipo de serviço inválido.' })
  serviceType: ServiceType;

  @IsOptional()
  @IsUUID('4', { message: 'Proposta inválida.' })
  proposalId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de início inválida.' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Prazo inválido.' })
  dueDate?: string;
}
```

**Create**: `update-project.dto.ts`
`status` é editável via update; `clientId`/`proposalId` são imutáveis.
```ts
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['clientId', 'proposalId'] as const),
) {
  @IsOptional()
  @IsEnum(ProjectStatus, { message: 'Status inválido.' })
  status?: ProjectStatus;
}
```

**Create**: `list-projects-query.dto.ts`
```ts
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListProjectsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID('4', { message: 'Cliente inválido.' }) clientId?: string;
  @IsOptional()
  @IsEnum(ProjectStatus, { message: 'Status inválido.' })
  status?: ProjectStatus;
  @IsOptional() @IsString() search?: string;
}
```

**Create**: `checklist-item.dto.ts`
```ts
import { IsBoolean, IsString, MinLength } from 'class-validator';

export class ChecklistItemDto {
  @IsString({ message: 'O texto do item é obrigatório.' })
  @MinLength(1, { message: 'O texto do item é obrigatório.' })
  text: string;

  @IsBoolean({ message: 'Valor inválido.' })
  done: boolean;
}
```

**Create**: `create-task.dto.ts`
```ts
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { ChecklistItemDto } from './checklist-item.dto';

export class CreateTaskDto {
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId: string;

  @IsString({ message: 'O título é obrigatório.' })
  @MinLength(2, { message: 'O título deve ter no mínimo 2 caracteres.' })
  title: string;

  @IsOptional() @IsString() description?: string;

  @IsOptional()
  @IsEnum(TaskStatus, { message: 'Status inválido.' })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority, { message: 'Prioridade inválida.' })
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString({}, { message: 'Prazo inválido.' })
  dueDate?: string;

  @IsOptional()
  @IsArray({ message: 'Tags inválidas.' })
  @IsString({ each: true, message: 'Tag inválida.' })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}
```

**Create**: `update-task.dto.ts`
`projectId` é imutável (mover de projeto não é suportado nesta fase). `status` só muda via `/move`.
```ts
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTaskDto } from './create-task.dto';

export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['projectId', 'status'] as const),
) {}
```

**Create**: `move-task.dto.ts`
```ts
import { IsEnum, IsInt, Min } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class MoveTaskDto {
  @IsEnum(TaskStatus, { message: 'Status inválido.' })
  status: TaskStatus;

  @IsInt({ message: 'Posição inválida.' })
  @Min(0, { message: 'Posição inválida.' })
  position: number;
}
```

**Create**: `list-tasks-query.dto.ts`
```ts
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListTasksQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID('4', { message: 'Projeto inválido.' }) projectId?: string;
  @IsOptional() @IsUUID('4', { message: 'Cliente inválido.' }) clientId?: string;
  @IsOptional() @IsEnum(TaskStatus, { message: 'Status inválido.' }) status?: TaskStatus;
  @IsOptional()
  @IsEnum(TaskPriority, { message: 'Prioridade inválida.' })
  priority?: TaskPriority;
  @IsOptional() @IsDateString({}, { message: 'Data inválida.' }) dueBefore?: string;
}
```

#### Application

**Create**: `apps/api/src/modules/projects/application/projects.service.ts`
Espelha `DealsService` (posse, paginação). `ClientsService.findOne(ownerId, clientId)` valida posse.
```ts
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
  type ProjectWithClient,
} from '../domain/project.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateProjectDto } from '../api/dto/create-project.dto';
import type { UpdateProjectDto } from '../api/dto/update-project.dto';
import type { ListProjectsQueryDto } from '../api/dto/list-projects-query.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository,
    private readonly clients: ClientsService,
  ) {}

  async list(ownerId: string, query: ListProjectsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId);
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      status: query.status,
      search: query.search,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async listByClient(
    ownerId: string,
    clientId: string,
  ): Promise<ProjectWithClient[]> {
    await this.clients.findOne(ownerId, clientId); // posse
    return this.repo.findByClient(clientId);
  }

  async findOne(ownerId: string, id: string): Promise<ProjectWithClient> {
    return this.loadOwned(ownerId, id);
  }

  async create(
    ownerId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectWithClient> {
    await this.clients.findOne(ownerId, dto.clientId); // valida posse do cliente
    return this.repo.create({
      clientId: dto.clientId,
      name: dto.name,
      serviceType: dto.serviceType,
      proposalId: dto.proposalId ?? null,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectWithClient> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.serviceType !== undefined ? { serviceType: dto.serviceType } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.startDate !== undefined
        ? { startDate: dto.startDate ? new Date(dto.startDate) : null }
        : {}),
      ...(dto.dueDate !== undefined
        ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
        : {}),
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.loadOwned(ownerId, id);
    if ((await this.repo.countTasks(id)) > 0) {
      throw new ConflictException(
        'Não é possível excluir um projeto que possui tarefas.',
      );
    }
    await this.repo.delete(id);
  }

  /** Carrega o projeto garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<ProjectWithClient> {
    const project = await this.repo.findById(id);
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    await this.clients.findOne(ownerId, project.clientId); // 404 se não for do dono
    return project;
  }
}
```

**Create**: `apps/api/src/modules/projects/application/tasks.service.ts`
Posse deriva Task→Project→Client via `ProjectsService.findOne`. `completedAt` setado/limpo no `move` e no `update`/`create` conforme `status === 'DONE'`.
```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  TASK_REPOSITORY,
  type TaskRepository,
  type TaskWithProject,
} from '../domain/task.repository';
import { ProjectsService } from './projects.service';
import { normalizePage, paginated } from '../../../shared/pagination';
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

  async board(ownerId: string, projectId: string): Promise<TaskWithProject[]> {
    await this.projects.findOne(ownerId, projectId); // posse
    return this.repo.findAllForBoard(projectId);
  }

  async findOne(ownerId: string, id: string): Promise<TaskWithProject> {
    return this.loadOwned(ownerId, id);
  }

  async create(ownerId: string, dto: CreateTaskDto): Promise<TaskWithProject> {
    await this.projects.findOne(ownerId, dto.projectId); // valida posse do projeto
    const status = dto.status ?? 'BACKLOG';
    const position = (await this.repo.maxPositionInStatus(dto.projectId, status)) + 1;
    return this.repo.create({
      projectId: dto.projectId,
      title: dto.title,
      description: dto.description ?? null,
      status,
      priority: dto.priority ?? 'MEDIUM',
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      position,
      tags: dto.tags ?? [],
      checklist: dto.checklist ? (dto.checklist as unknown as Prisma.InputJsonValue) : undefined,
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
```

#### Controllers

**Create**: `apps/api/src/modules/projects/api/projects.controller.ts`
```ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ProjectsService } from '../application/projects.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projects.list(ownerId, query);
  }

  @Post() create(
    @CurrentUserId() ownerId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.projects.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.projects.delete(ownerId, id);
  }
}
```

**Create**: `apps/api/src/modules/projects/api/tasks.controller.ts`
`GET /tasks/board` precisa de `projectId` (query). Como `board` exige o parâmetro, use `@Query('projectId')`.
```ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { TasksService } from '../application/tasks.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { MoveTaskDto } from './dto/move-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasks.list(ownerId, query);
  }

  @Get('board') board(
    @CurrentUserId() ownerId: string,
    @Query('projectId') projectId: string,
  ) {
    return this.tasks.board(ownerId, projectId);
  }

  @Post() create(@CurrentUserId() ownerId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.tasks.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(ownerId, id, dto);
  }

  @Patch(':id/move') move(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: MoveTaskDto,
  ) {
    return this.tasks.move(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.tasks.delete(ownerId, id);
  }
}
```

#### Module + registro

**Create**: `apps/api/src/modules/projects/projects.module.ts`
```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsController } from './api/projects.controller';
import { TasksController } from './api/tasks.controller';
import { ProjectsService } from './application/projects.service';
import { TasksService } from './application/tasks.service';
import { PROJECT_REPOSITORY } from './domain/project.repository';
import { TASK_REPOSITORY } from './domain/task.repository';
import { PrismaProjectRepository } from './infra/prisma-project.repository';
import { PrismaTaskRepository } from './infra/prisma-task.repository';

@Module({
  imports: [ClientsModule],
  controllers: [ProjectsController, TasksController],
  providers: [
    ProjectsService,
    TasksService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    { provide: TASK_REPOSITORY, useClass: PrismaTaskRepository },
  ],
  exports: [ProjectsService], // consumido pelo PipelineModule na Fase 4 (criar-ao-ganhar)
})
export class ProjectsModule {}
```

**Modify**: `apps/api/src/app.module.ts`
Registrar `ProjectsModule` nos imports (após `ProposalsModule`).
```ts
import { ProjectsModule } from './modules/projects/projects.module';
// ...
imports: [
  // ...
  PipelineModule,
  ProposalsModule,
  ProjectsModule,
],
```

#### Specs

**Create**: `apps/api/src/modules/projects/application/projects.service.spec.ts`
Padrão de [proposals.service.spec.ts:11-39](apps/api/src/modules/proposals/application/proposals.service.spec.ts#L11-L39): construtor direto, repo `jest.Mocked`, `clients` mock estrutural.
Casos mínimos:
- `create` valida posse (`clients.findOne` chamado com `ownerId, clientId`) e repassa datas convertidas.
- `delete` lança `ConflictException` quando `countTasks > 0`.
- `loadOwned` lança `NotFoundException` ('Projeto não encontrado.') quando repo retorna null.

**Create**: `apps/api/src/modules/projects/application/tasks.service.spec.ts`
Casos mínimos:
- `create` calcula `position = maxPositionInStatus + 1` e seta `completedAt` só quando `status === 'DONE'`.
- `move` para `DONE` seta `completedAt`; sair de `DONE` limpa (`completedAt: null`); mesmo status sem DONE não mexe em `completedAt`.
- `loadOwned` lança `NotFoundException` ('Tarefa não encontrada.') quando repo retorna null.

#### ENDPOINTS.md

**Modify**: `apps/api/ENDPOINTS.md` — adicionar seções `## Projects` e `## Tasks` ao final (após a linha 346), no formato fixo (`### MÉTODO /caminho` + Propósito/Auth/Body/Resposta/Erros/Handler), pt-BR. Documentar: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `GET /tasks`, `GET /tasks/board`, `POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `PATCH /tasks/:id/move`. Erros relevantes: `404 Projeto não encontrado.` / `Tarefa não encontrada.`, `409 Não é possível excluir um projeto que possui tarefas.`, `400` (validação), `401`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila sem erros de tipo (client Prisma já contém `Project`/`Task`).
- [x] `pnpm --filter api lint` — sem erros de lint.
- [x] `pnpm --filter api test` — specs de `ProjectsService`/`TasksService` passam.

#### Manual Verification
- [ ] `POST /projects` cria projeto; `GET /projects` lista paginado; filtro `?clientId=`/`?status=`/`?search=` funciona.
- [ ] `DELETE /projects/:id` com tarefas retorna 409 pt-BR; sem tarefas, 200.
- [ ] `POST /tasks` cria em `BACKLOG` com `position` sequencial; `GET /tasks/board?projectId=` retorna ordenado por (status, position).
- [ ] `PATCH /tasks/:id/move` reindexa corretamente origem e destino; mover para `DONE` seta `completedAt`, sair limpa.
- [ ] Acessar recurso de outro `ownerId` retorna 404.
- [ ] Toda rota nova documentada em `ENDPOINTS.md`.

**⏸ PAUSE**: Após a verificação automática passar, parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Phase 2: Frontend — Projetos, ficha com Kanban e aba do cliente

### Goal
Entregar a lista de projetos, a ficha do projeto com Kanban dnd-kit (update otimista) e checklist, os dialogs de projeto/tarefa, a aba `projetos` do cliente e o item "Projetos" no nav.

### Changes

Estrutura nova em `apps/web/src/features/demandas/`:
```
demandas/
  api/
    projects.api.ts
    tasks.api.ts
    hooks.ts
    types.ts
    clients-lookup.api.ts
  lib/
    api-error.ts
    project-format.ts       (badges/format helpers)
    reindex-board.ts        (clone de pipeline, status)
    overdue.ts              (isOverdue — usado na Fase 3 também)
  components/
    KanbanColumn.tsx
    SortableTaskCard.tsx
    TaskCard.tsx
    ChecklistEditor.tsx
  ProjetosListPage.tsx
  ProjetoDetalhePage.tsx
  ProjectFormDialog.tsx
  TaskFormDialog.tsx
```

#### Tipos e API

**Create**: `apps/web/src/features/demandas/api/types.ts`
```ts
import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ServiceType = 'SOFTWARE' | 'WEBSITE' | 'PAID_TRAFFIC';
export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'DONE' | 'CANCELED';
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Project {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  proposalId?: string | null;
  name: string;
  serviceType: ServiceType;
  status: ProjectStatus;
  startDate?: string | null;
  dueDate?: string | null;
  _count: { tasks: number };
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  project: { id: string; name: string; clientId: string; client: { id: string; name: string } };
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  position: number;
  tags: string[];
  checklist?: ChecklistItem[] | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectBody {
  name: string;
  clientId: string;
  serviceType: ServiceType;
  proposalId?: string;
  startDate?: string;
  dueDate?: string;
}
export type UpdateProjectBody = Partial<
  Omit<CreateProjectBody, 'clientId' | 'proposalId'>
> & { status?: ProjectStatus };

export interface CreateTaskBody {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string;
  tags?: string[];
  checklist?: ChecklistItem[];
}
export type UpdateTaskBody = Partial<Omit<CreateTaskBody, 'projectId' | 'status'>>;
export interface MoveTaskBody {
  status: TaskStatus;
  position: number;
}

export interface ListProjectsParams {
  page?: number;
  limit?: number;
  clientId?: string;
  status?: ProjectStatus;
  search?: string;
}
export interface ListTasksParams {
  page?: number;
  limit?: number;
  projectId?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueBefore?: string;
}
```

**Create**: `apps/web/src/features/demandas/api/projects.api.ts`
```ts
import { api } from '@/lib/api';
import type {
  CreateProjectBody, ListProjectsParams, Paginated, Project, UpdateProjectBody,
} from './types';

export const projectsApi = {
  list: (params: ListProjectsParams) =>
    api.get<Paginated<Project>>('/projects', { params }).then((r) => r.data),
  listByClient: (clientId: string) =>
    api.get<Paginated<Project>>('/projects', { params: { clientId, limit: 100 } }).then((r) => r.data),
  get: (id: string) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (body: CreateProjectBody) => api.post<Project>('/projects', body).then((r) => r.data),
  update: (id: string, body: UpdateProjectBody) =>
    api.patch<Project>(`/projects/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`).then((r) => r.data),
};
```
> **Nota**: `GET /projects?clientId=` retorna `Paginated`; a aba do cliente usa `limit: 100` (mesma abordagem de `proposalsApi.listByClient`).

**Create**: `apps/web/src/features/demandas/api/tasks.api.ts`
```ts
import { api } from '@/lib/api';
import type {
  CreateTaskBody, ListTasksParams, MoveTaskBody, Paginated, Task, UpdateTaskBody,
} from './types';

export const tasksApi = {
  list: (params: ListTasksParams) =>
    api.get<Paginated<Task>>('/tasks', { params }).then((r) => r.data),
  board: (projectId: string) =>
    api.get<Task[]>('/tasks/board', { params: { projectId } }).then((r) => r.data),
  get: (id: string) => api.get<Task>(`/tasks/${id}`).then((r) => r.data),
  create: (body: CreateTaskBody) => api.post<Task>('/tasks', body).then((r) => r.data),
  update: (id: string, body: UpdateTaskBody) =>
    api.patch<Task>(`/tasks/${id}`, body).then((r) => r.data),
  move: (id: string, body: MoveTaskBody) =>
    api.patch<Task>(`/tasks/${id}/move`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/tasks/${id}`).then((r) => r.data),
};
```

**Create**: `apps/web/src/features/demandas/api/clients-lookup.api.ts` — cópia local do lookup (idêntico a [propostas/api/clients-lookup.api.ts](apps/web/src/features/propostas/api/clients-lookup.api.ts)); usar como referência o arquivo existente de `propostas/`.

**Create**: `apps/web/src/features/demandas/lib/api-error.ts` — cópia idêntica de [propostas/lib/api-error.ts](apps/web/src/features/propostas/lib/api-error.ts).

**Create**: `apps/web/src/features/demandas/lib/reindex-board.ts` — clone de [pipeline/lib/reindex-board.ts](apps/web/src/features/pipeline/lib/reindex-board.ts) trocando `stageId`→`status` e o tipo `Deal`→`Task`.
```ts
import type { Task, TaskStatus } from '../api/types';

export function reindexBoard(
  tasks: Task[],
  taskId: string,
  toStatus: TaskStatus,
  toPosition: number,
): Task[] {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving) return tasks;
  const fromStatus = moving.status;

  const target = tasks
    .filter((t) => t.status === toStatus && t.id !== taskId)
    .sort((a, b) => a.position - b.position);
  const clamped = Math.max(0, Math.min(toPosition, target.length));
  const orderedTarget = [
    ...target.slice(0, clamped),
    { ...moving, status: toStatus },
    ...target.slice(clamped),
  ];

  const positions = new Map<string, { status: TaskStatus; position: number }>();
  orderedTarget.forEach((t, i) => positions.set(t.id, { status: toStatus, position: i }));

  if (fromStatus !== toStatus) {
    tasks
      .filter((t) => t.status === fromStatus && t.id !== taskId)
      .sort((a, b) => a.position - b.position)
      .forEach((t, i) => positions.set(t.id, { status: fromStatus, position: i }));
  }

  return tasks.map((t) => {
    const p = positions.get(t.id);
    return p ? { ...t, status: p.status, position: p.position } : t;
  });
}
```

**Create**: `apps/web/src/features/demandas/lib/overdue.ts`
```ts
import type { Task } from '../api/types';

/** Atrasada: tem prazo passado e não está concluída. Derivado no client (sem estado no backend). */
export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>): boolean {
  if (!task.dueDate || task.status === 'DONE') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}
```

**Create**: `apps/web/src/features/demandas/lib/project-format.ts`
Mapas locais de badge (variantes de cor) para status de projeto/tarefa e prioridade. Nada em `labels.ts` (tradutores já existem).
```ts
import type { ProjectStatus, TaskPriority, TaskStatus } from '../api/types';

export const PROJECT_STATUS_BADGE: Record<
  ProjectStatus, 'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  PAUSED: 'outline',
  DONE: 'secondary',
  CANCELED: 'destructive',
};

export const TASK_PRIORITY_BADGE: Record<
  TaskPriority, 'default' | 'secondary' | 'outline' | 'destructive'
> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'default',
  URGENT: 'destructive',
};

// Ordem das colunas do Kanban (segue a ordem do enum no schema).
export const TASK_STATUS_ORDER: TaskStatus[] = [
  'BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE',
];
```

**Create**: `apps/web/src/features/demandas/api/hooks.ts`
Queries + mutations. `useMoveTask` com update otimista + rollback (modelo [pipeline/api/hooks.ts:65-88](apps/web/src/features/pipeline/api/hooks.ts#L65-L88)), sobre a query `tasks.board(projectId)`.
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';
import { projectsApi } from './projects.api';
import { tasksApi } from './tasks.api';
import { clientsLookupApi } from './clients-lookup.api';
import { reindexBoard } from '../lib/reindex-board';
import type {
  CreateProjectBody, CreateTaskBody, ListProjectsParams, ListTasksParams,
  MoveTaskBody, Task, UpdateProjectBody, UpdateTaskBody,
} from './types';

// --- Projects ---
export function useProjects(params: ListProjectsParams) {
  return useQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: () => projectsApi.list(params),
  });
}
export function useProjectsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.projects.byClient(clientId),
    queryFn: () => projectsApi.listByClient(clientId),
  });
}
export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => projectsApi.get(id),
    enabled: !!id,
  });
}
export function useClientOptions(search: string) {
  return useQuery({
    queryKey: queryKeys.clientOptions(search),
    queryFn: () => clientsLookupApi.search(search),
  });
}

function invalidateProjects(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all });
}
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectBody) => projectsApi.create(body),
    onSuccess: () => invalidateProjects(qc),
  });
}
export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectBody) => projectsApi.update(id, body),
    onSuccess: () => invalidateProjects(qc),
  });
}
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => invalidateProjects(qc),
  });
}

// --- Tasks ---
export function useBoard(projectId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.board(projectId),
    queryFn: () => tasksApi.board(projectId),
    enabled: !!projectId,
  });
}
export function useTasks(params: ListTasksParams) {
  return useQuery({
    queryKey: queryKeys.tasks.list(params),
    queryFn: () => tasksApi.list(params),
  });
}
function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all }); // _count.tasks muda
}
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => tasksApi.create(body),
    onSuccess: () => invalidateTasks(qc),
  });
}
export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTaskBody) => tasksApi.update(id, body),
    onSuccess: () => invalidateTasks(qc),
  });
}
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => invalidateTasks(qc),
  });
}

/** Move com optimistic update no board do projeto; reverte em erro e reconcilia no settle. */
export function useMoveTask(projectId: string) {
  const qc = useQueryClient();
  const key = queryKeys.tasks.board(projectId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveTaskBody }) => tasksApi.move(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Task[]>(key);
      if (prev) {
        qc.setQueryData<Task[]>(key, reindexBoard(prev, id, body.status, body.position));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error('Falha ao mover a tarefa.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}
```

#### query-keys

**Modify**: `apps/web/src/lib/query-keys.ts` — adicionar blocos `projects` e `tasks` (antes de `clientOptions`).
```ts
  projects: {
    all: ['projects'] as const,
    list: (params: object) => ['projects', 'list', params] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    byClient: (clientId: string) => ['projects', 'client', clientId] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    board: (projectId: string) => ['tasks', 'board', projectId] as const,
    list: (params: object) => ['tasks', 'list', params] as const,
  },
```

#### Componentes do Kanban

**Create**: `apps/web/src/features/demandas/components/TaskCard.tsx`
Card visual (usado no `DragOverlay` e dentro do `SortableTaskCard`). Mostra título, badge de prioridade (`translateTaskPriority`), prazo (`formatDate`), realce de atrasada (`isOverdue` → borda/badge destaque com token, ex.: `border-destructive`), progresso do checklist (`n/total`), tags. Props `{ task: Task; onClick?: () => void }`.

**Create**: `apps/web/src/features/demandas/components/SortableTaskCard.tsx` — clone de [SortableDealCard.tsx](apps/web/src/features/pipeline/components/SortableDealCard.tsx) (`useSortable` com `data: { status: task.status }`), renderiza `TaskCard`.

**Create**: `apps/web/src/features/demandas/components/KanbanColumn.tsx` — clone de [pipeline/components/KanbanColumn.tsx](apps/web/src/features/pipeline/components/KanbanColumn.tsx): `useDroppable({ id: status })` + `SortableContext verticalListSortingStrategy`. Cabeçalho com `translateTaskStatus(status)` e contagem. Sem soma de valores. Props `{ status: TaskStatus; tasks: Task[]; children: ReactNode }`.

#### Checklist

**Create**: `apps/web/src/features/demandas/components/ChecklistEditor.tsx`
Editor de checklist para o `TaskFormDialog`, via `useFieldArray` (modelo [ItemsEditor.tsx](apps/web/src/features/propostas/components/ItemsEditor.tsx)). Cada linha: checkbox `done` + input `text` + botão remover; botão "Adicionar item". Sem asterisco (checklist é opcional).

#### ProjetosListPage

**Create**: `apps/web/src/features/demandas/ProjetosListPage.tsx`
Modelo [PropostasListPage.tsx](apps/web/src/features/propostas/PropostasListPage.tsx): `useState` de filtros (`status`, `search`, `page`), `LIMIT = 20`, tabela em `<div className="rounded-lg border">`, `ColumnRadioFilter` local (copiar o helper de `PropostasListPage`), `TableLink` para `/projetos/:id`, `<Badge variant={PROJECT_STATUS_BADGE[status]}>{translateProjectStatus(status)}</Badge>`, skeleton, `TableEmpty`, paginação "Anterior/Próxima". Colunas: Nome, Cliente, Tipo de serviço, Status (filtro), Tarefas (`_count.tasks`), Prazo (`formatDate(dueDate)`). Botão "Novo projeto" abre `ProjectFormDialog`.

#### ProjetoDetalhePage

**Create**: `apps/web/src/features/demandas/ProjetoDetalhePage.tsx`
`useParams` → `useProject(id)` + `useBoard(id)`. Header com voltar (`/projetos`), nome, `<Badge>` de status, cliente (link `/clientes/:clientId`), botões "Editar" (abre `ProjectFormDialog`), "Excluir" (`ConfirmDialog` → `useDeleteProject`, navega para `/projetos`), "Nova tarefa" (abre `TaskFormDialog` com `defaultProjectId`). Loading skeleton; `Empty` fallback ('Projeto não encontrado.').
Kanban: `DndContext` + `closestCorners`, `PointerSensor {distance: 8}`, agrupa board por `Map<TaskStatus, Task[]>`, colunas na ordem `TASK_STATUS_ORDER`, `resolveTarget`/`handleDragStart`/`handleDragEnd` clonados de [PipelineBoardPage.tsx:51-87](apps/web/src/features/pipeline/PipelineBoardPage.tsx#L51-L87) (sem o desvio de `isLost`/`LostReasonDialog` — não há), `DragOverlay` com `TaskCard`. `useMoveTask(id)` para persistir. Clicar num card abre `TaskFormDialog` de edição.
Checklist inline: dentro do `TaskCard`/detalhe, cada item do checklist da task tem um checkbox que ao alternar chama `useUpdateTask(task.id).mutate({ checklist: novoArray })` reescrevendo o array inteiro (marca/desmarca `done`). O toggle vive no card (ou num popover simples do card) — sem página de detalhe de task.

> **Decisão de UX do toggle inline**: para evitar excesso de superfície, o toggle de checklist fica no `TaskFormDialog` (edição) **e** como progresso clicável no `TaskCard` quando há itens. Implementação mínima aceitável: toggle apenas no `TaskFormDialog`; o card mostra progresso `n/total` (read-only). O executor pode entregar o toggle direto no card se trivial, mas o critério de sucesso exige ao menos o toggle no dialog persistindo via `PATCH`.

#### ProjectFormDialog

**Create**: `apps/web/src/features/demandas/ProjectFormDialog.tsx`
Modelo [DealFormDialog.tsx](apps/web/src/features/pipeline/DealFormDialog.tsx): RHF + Zod pt-BR, `zodResolver`, `useEffect([open, project, defaultClientId, reset])`. Props `{ open, onOpenChange, project?, defaultClientId? }`. Campos: Nome (obrigatório), Cliente (Select com busca + cadastro rápido via `ClientFormDialog`, **oculto quando `defaultClientId`**), Tipo de serviço (Select de `SERVICE_TYPE_LABELS`), Status (Select de `PROJECT_STATUS_LABELS`, **só no modo edição**), Início (`date`), Prazo (`date`). `FieldLabel required` nos obrigatórios. Submit `useCreateProject`/`useUpdateProject`, `toast.success`/`toast.error(extractApiMessage(...))`.
Schema Zod:
```ts
const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE', 'WEBSITE', 'PAID_TRAFFIC']),
  status: z.enum(['ACTIVE', 'PAUSED', 'DONE', 'CANCELED']).optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
});
```

#### TaskFormDialog

**Create**: `apps/web/src/features/demandas/TaskFormDialog.tsx`
Props `{ open, onOpenChange, task?, defaultProjectId }`. Campos: Título (obrigatório), Descrição (`textarea`), Prioridade (Select `TASK_PRIORITY_LABELS`), Prazo (`date`), Tags (input simples separado por vírgula ou editor de chips mínimo), Checklist (`ChecklistEditor`). `status` **não** é editado aqui (muda só via board). `useCreateTask` no create (com `projectId: defaultProjectId`, `status` default `BACKLOG` no backend), `useUpdateTask` no edit. Toasts pt-BR.
Schema Zod:
```ts
const schema = z.object({
  title: z.string().min(2, 'O título deve ter no mínimo 2 caracteres.'),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  dueDate: z.string().optional(),
  tags: z.array(z.string()).optional(),
  checklist: z.array(z.object({ text: z.string().min(1, 'Informe o texto.'), done: z.boolean() })).optional(),
});
```

#### Rotas e nav

**Modify**: `apps/web/src/routes/router.tsx`
- Importar as páginas: `ProjetosListPage`, `ProjetoDetalhePage`.
- Trocar o placeholder da aba do cliente `projetos` (linha 37) por um `ProjetosTab` (ver abaixo).
- Trocar `/projetos/:id` (linha 44) por `<ProjetoDetalhePage />`.
- Adicionar rota `/projetos` → `<ProjetosListPage />`.
```tsx
import ProjetosListPage from '@/features/demandas/ProjetosListPage';
import ProjetoDetalhePage from '@/features/demandas/ProjetoDetalhePage';
import ProjetosTab from '@/features/clientes/tabs/ProjetosTab';
// ...
{ path: 'projetos', element: <ProjetosTab /> },   // era PlaceholderTab
// ...
{ path: '/projetos', element: <ProjetosListPage /> },       // novo
{ path: '/projetos/:id', element: <ProjetoDetalhePage /> }, // era PlaceholderPage
```

**Create**: `apps/web/src/features/clientes/tabs/ProjetosTab.tsx`
Modelo [PropostasTab.tsx](apps/web/src/features/clientes/tabs/PropostasTab.tsx): `useOutletContext<Client>()`, `useProjectsByClient(client.id)`, lista de projetos com `TableLink` para `/projetos/:id`, badge de status, `_count.tasks`; botão "Novo projeto" abre `ProjectFormDialog` com `defaultClientId={client.id}`; `Empty` fallback.

**Modify**: `apps/web/src/app/nav.ts`
Adicionar item "Projetos" no grupo "Operação" (ícone `FolderKanban` de lucide).
```ts
import { /* ... */ FolderKanban } from "lucide-react"
// ...
{ label: "Operação", items: [
  { to: "/demandas", label: "Demandas", icon: ListTodo },
  { to: "/projetos", label: "Projetos", icon: FolderKanban },
] },
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — `tsc -b` + build Vite sem erros.
- [x] `pnpm --filter web lint` — `oxlint` sem erros.

#### Manual Verification
- [ ] `/projetos` lista projetos com filtro de status/busca e paginação; "Novo projeto" cria.
- [ ] `/projetos/:id` mostra ficha + Kanban; arrastar cartão entre colunas persiste (otimista, sem "pulo"); erro faz rollback com toast pt-BR.
- [ ] "Nova tarefa" cria na coluna correta; editar tarefa abre dialog preenchido.
- [ ] Checklist: adicionar/remover no dialog salva; toggle `done` persiste (recarregar mantém).
- [ ] Aba "Projetos" do cliente lista os projetos e cria com cliente pré-selecionado.
- [ ] Item "Projetos" aparece no nav e navega para `/projetos`.
- [ ] Todos os enums exibidos traduzidos; obrigatórios com `*` via `FieldLabel required`.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: "Minhas demandas" + destaque de atrasadas

### Goal
Entregar a página `/demandas` como visão de tarefas cruzando projetos, com filtros (prioridade, prazo, cliente) e realce das atrasadas.

### Changes

**Create**: `apps/web/src/features/demandas/MinhasDemandasPage.tsx`
Página de lista (não-board) consumindo `useTasks(params)`. Filtros no topo (barra), não paginação pesada — usar `LIMIT = 50`.
- Filtros: Prioridade (`ColumnRadioFilter`/select de `TASK_PRIORITY_LABELS`), Cliente (lookup via `useClientOptions`, opcional), Prazo (`dueBefore` — input `date`; um atalho "Atrasadas"/"Esta semana" opcional), Status (opcional — `TASK_STATUS_LABELS`).
- Tabela: Tarefa (`TableLink`? não há rota de task — em vez disso link para `/projetos/:projectId`), Projeto (`task.project.name` → link `/projetos/:projectId`), Cliente (`task.project.client.name` → link `/clientes/:clientId`), Prioridade (badge), Status (badge/tradução), Prazo (`formatDate`).
- **Atrasadas**: linhas onde `isOverdue(task)` recebem realce (ex.: `text-destructive` no prazo + um `<Badge variant="destructive">Atrasada</Badge>`), usando `lib/overdue.ts` da Fase 2.
- Skeleton no loading; `TableEmpty` ('Nenhuma tarefa encontrada.').

**Modify**: `apps/web/src/routes/router.tsx`
Trocar o placeholder de `/demandas` (linha 45) por `<MinhasDemandasPage />`.
```tsx
import MinhasDemandasPage from '@/features/demandas/MinhasDemandasPage';
// ...
{ path: '/demandas', element: <MinhasDemandasPage /> }, // era PlaceholderPage
```

> **Backend**: nenhum endpoint novo — `GET /tasks?priority=&dueBefore=&clientId=&status=` já existe na Fase 1. O ordenamento por prazo (`dueDate asc`) já vem do repositório.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] `/demandas` lista tarefas de múltiplos projetos; filtro por prioridade/cliente/prazo funciona.
- [ ] Tarefas com `dueDate` passado e status ≠ DONE aparecem realçadas como "Atrasada".
- [ ] Links levam ao projeto (`/projetos/:id`) e ao cliente (`/clientes/:id`) corretos.
- [ ] Nav "Demandas" abre esta página (não mais placeholder).

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4: Criar Projeto ao ganhar (automático)

### Goal
Ao mover um deal para um estágio `isWon` (Kanban ou aceite de proposta), criar automaticamente um `Project` a partir do deal, sem duplicar em re-ganhos.

### Changes

#### Migration

**Modify**: `apps/api/prisma/schema.prisma` — adicionar `dealId` a `Project` e a back-relation em `Deal`.
```prisma
model Project {
  id          String        @id @default(uuid())
  clientId    String
  client      Client        @relation(fields: [clientId], references: [id])
  proposalId  String?
  proposal    Proposal?     @relation(fields: [proposalId], references: [id])
  dealId      String?       // origem: deal ganho (dedupe de criar-ao-ganhar)
  deal        Deal?         @relation(fields: [dealId], references: [id])
  name        String
  // ... (demais campos inalterados)
  @@index([dealId])
}

model Deal {
  // ... (campos inalterados)
  proposals     Proposal[]
  projects      Project[]   // back-relation p/ Project.deal
  activities    Activity[]
  // ...
}
```
Gerar migration: `pnpm --filter api exec prisma migrate dev --name add_project_deal_id` (ou o comando de migration usado no projeto). Isso regenera o Prisma Client com `Project.dealId`.

#### Domain/Infra — `findByDealId`

**Modify**: `apps/api/src/modules/projects/domain/project.repository.ts` — adicionar à interface:
```ts
  /** Primeiro projeto já vinculado a um deal (dedupe de criar-ao-ganhar). */
  findByDealId(dealId: string): Promise<ProjectWithClient | null>;
```

**Modify**: `apps/api/src/modules/projects/infra/prisma-project.repository.ts` — implementar:
```ts
  findByDealId(dealId: string) {
    return this.prisma.project.findFirst({ where: { dealId }, include: withClient });
  }
```

#### Application — `ProjectsService.createFromDeal`

**Modify**: `apps/api/src/modules/projects/application/projects.service.ts` — adicionar método público (consumido pelo `PipelineModule`). Dedupe por `dealId`; não valida posse (o `DealsService` já validou o deal antes de chamar).
```ts
import type { Deal } from '@prisma/client';
// ...
  /**
   * Cria um Project a partir de um Deal ganho, se ainda não existir um vinculado
   * a esse deal. Idempotente: chamadas repetidas para o mesmo deal não duplicam.
   */
  async createFromDeal(deal: Deal): Promise<void> {
    const existing = await this.repo.findByDealId(deal.id);
    if (existing) return;
    await this.repo.create({
      clientId: deal.clientId,
      dealId: deal.id,
      name: deal.title,
      serviceType: deal.serviceType,
      // proposalId fica null: o move não conhece a proposta; opcional em Project.
    });
  }
```

#### Pipeline — ramo `isWon` em `DealsService.move`

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts`
Injetar `ProjectsService` e, após o move para um estágio `isWon`, criar o projeto. Como `move` é chamado tanto pelo Kanban quanto por `ProposalsService.accept → moveDealToWon`, ambos os caminhos ficam cobertos.
```ts
import { ProjectsService } from '../../projects/application/projects.service';
// ...
constructor(
  @Inject(DEAL_REPOSITORY) private readonly repo: DealRepository,
  private readonly clients: ClientsService,
  private readonly stages: PipelineStagesService,
  private readonly projects: ProjectsService, // novo
) {}
// ...
async move(ownerId: string, id: string, dto: MoveDealDto): Promise<DealWithClient> {
  const deal = await this.loadOwned(ownerId, id);
  const targetStage = await this.stages.findOne(dto.stageId);
  const stageChanged = deal.stageId !== dto.stageId;

  const patch: { stageMovedAt?: Date; lostReason?: string | null } = {};
  if (stageChanged) patch.stageMovedAt = new Date();
  if (targetStage.isLost) {
    const reason = dto.lostReason?.trim();
    if (!reason) throw new UnprocessableEntityException('Informe o motivo da perda.');
    patch.lostReason = reason;
  } else if (stageChanged) {
    patch.lostReason = null;
  }

  const moved = await this.repo.move(id, dto.stageId, dto.position, patch);

  // Criar-ao-ganhar: ao entrar num estágio isWon, semeia um Project (idempotente).
  if (targetStage.isWon && stageChanged) {
    await this.projects.createFromDeal(moved);
  }
  return moved;
}
```
> **Nota de posse**: `createFromDeal` recebe o `Deal` já carregado/validado por `loadOwned`; não revalida cliente. `DealWithClient` é atribuível a `Deal` para os campos usados (`id`, `clientId`, `title`, `serviceType`).

#### Wiring — evitar dependência circular

**Modify**: `apps/api/src/modules/pipeline/pipeline.module.ts` — importar `ProjectsModule` e mantê-lo exportando `ProjectsService`.
```ts
import { ProjectsModule } from '../projects/projects.module';
// ...
@Module({
  imports: [ClientsModule, ProjectsModule],
  // ...
})
```
Cadeia de dependência: `PipelineModule → ProjectsModule → ClientsModule`. `ProjectsModule` **não** importa `PipelineModule` → **sem ciclo**. `ProposalsModule` já importa `PipelineModule` e continua funcionando (o `accept` chama `deals.move`, que agora cria o projeto).

> **Verificação anti-ciclo**: confirmar que `ProjectsModule` não passa a importar `PipelineModule`. Se algum dia precisar, usar `forwardRef`. Nesta fase não é necessário.

#### Spec

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.spec.ts` (se existir; senão criar) — adicionar `projects: { createFromDeal: jest.Mock }` ao construtor e casos:
- Mover para estágio `isWon` (stageChanged) chama `projects.createFromDeal` com o deal movido.
- Mover dentro do mesmo estágio `isWon` (sem mudança) **não** chama `createFromDeal`.
- Mover para estágio comum não chama `createFromDeal`.

Verificar/atualizar `apps/api/src/modules/proposals/application/proposals.service.spec.ts`: o mock de `deals` já expõe `move`; nenhuma mudança de assinatura em `ProposalsService`.

#### Frontend — invalidação cruzada

**Modify**: `apps/web/src/features/pipeline/api/hooks.ts` — no `useMoveDeal`, invalidar também `queryKeys.projects.all` no `onSettled` (um deal movido para "Ganhou" pode ter criado um projeto).
```ts
onSettled: () => {
  void qc.invalidateQueries({ queryKey: queryKeys.deals.board });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all });
},
```

**Modify**: `apps/web/src/features/propostas/api/hooks.ts` — no `useProposalAction`, ao `accept`, invalidar também `queryKeys.projects.all`.
```ts
if (action === 'accept') {
  void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all });
}
```

#### ENDPOINTS.md

**Modify**: `apps/api/ENDPOINTS.md` — atualizar o **Propósito** de `PATCH /deals/:id/move` para registrar o efeito colateral: "Ao mover para um estágio `isWon` (mudança de estágio), cria automaticamente um Projeto a partir do deal (idempotente por `dealId`)." Atualizar também `POST /proposals/:id/accept` para mencionar que, ao mover o deal para "Ganhou", o Projeto é criado.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma migrate dev --name add_project_deal_id` — migration aplica; client regenera.
- [x] `pnpm --filter api build` — compila com `ProjectsService` injetado em `DealsService` e `Project.dealId` no client.
- [x] `pnpm --filter api lint` — sem erros.
- [x] `pnpm --filter api test` — specs de `DealsService` (criar-ao-ganhar) e demais passam.
- [x] `pnpm --filter web build` && `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] Arrastar um deal para a coluna "Ganhou" no Kanban cria um Projeto (visível em `/projetos`) com nome = título do deal, mesmo cliente e tipo de serviço.
- [ ] Aceitar uma proposta vinculada a um deal move o deal para "Ganhou" **e** cria o Projeto.
- [ ] Mover o deal para fora e de volta a "Ganhou" **não** cria um segundo projeto (dedupe por `dealId`).
- [ ] Mover entre estágios comuns não cria projeto.
- [ ] App sobe sem erro de dependência circular (`pnpm --filter api start:dev`).

**⏸ PAUSE**: Confirmação final humana.

---

## Testing Strategy

### Unit Tests
- **`projects.service.spec.ts`**: posse no `create`/`list`; `409` no `delete` com tarefas; `404` pt-BR no `loadOwned`.
- **`tasks.service.spec.ts`**: `position = max+1` no `create`; `completedAt` set/limpo no `move` para/de `DONE`; `404` pt-BR.
- **`deals.service.spec.ts`** (Fase 4): `createFromDeal` chamado só ao entrar em `isWon` com mudança de estágio; não chamado nos demais casos.
- Edge cases: `move` com `position` fora do range (clamp), coluna vazia (`maxPositionInStatus === -1`).

### Integration Tests
- Fluxo backend manual (curl/Bruno): criar projeto → criar tarefas → board → move → verificar reindex de posições em origem e destino.
- Fluxo criar-ao-ganhar: aceitar proposta com deal → confirmar 1 projeto; repetir move → confirmar sem duplicata.
- Frontend: arrastar cartões no Kanban (otimista + rollback ao simular erro de rede).

### Migration & Rollback
- **Fases 1–3**: sem migration — deploy direto (o client Prisma já contém `Project`/`Task`).
- **Fase 4**: `prisma migrate dev --name add_project_deal_id` adiciona coluna `Project.dealId` (nullable) + índice. Rollback: `prisma migrate resolve`/reverter a migration; a coluna é nullable, sem backfill, então dados existentes não são afetados. Projetos criados antes da fase ficam com `dealId = null` (não deduplicáveis por deal, aceitável).

## Environment Considerations
- **CI/CD**: nenhum passo novo; `build`/`lint`/`test` já cobrem. A Fase 4 exige `prisma migrate deploy` no pipeline de deploy do backend.
- **Migrations**: apenas na Fase 4 (`add_project_deal_id`). Requer Postgres em execução (`docker compose up -d` local).
- **Config/Secrets**: nenhuma variável de ambiente nova.
- **Multi-environment**: sem diferenças entre dev/staging/prod além da aplicação da migration da Fase 4.

## Dependencies & Risks
- **Dependência circular (Fase 4)**: `PipelineModule → ProjectsModule`. Mitigado porque `ProjectsModule` só depende de `ClientsModule`. Se surgir necessidade reversa, usar `forwardRef` — não previsto nesta fase.
- **`checklist` como `Json`**: reescrito por inteiro no `update` (não há merge parcial). O client envia o array completo; risco de corrida entre dois toggles simultâneos (aceitável — single-user).
- **Ordenação de `dueDate` nulo**: Prisma coloca `null` por último em `asc` — desejado para "Minhas demandas". Confirmar comportamento na verificação manual.
- **Posição no board vs. lista**: só o board reordena `position`; a lista "Minhas demandas" é read-only, sem risco de inconsistência.
- **`DealWithClient` → `Deal` em `createFromDeal`**: o objeto retornado por `repo.move` inclui `client`; é atribuível a `Deal` para os campos usados. Se o TypeScript reclamar, tipar o parâmetro como `Pick<Deal, 'id' | 'clientId' | 'title' | 'serviceType'>`.

## References
- PRD: `specs/research/2026-07-23-fase-4-demandas.md`
- Related specs: `specs/plans/2026-07-21-fase-2-pipeline.md`, `specs/plans/2026-07-23-fase-3-propostas.md`
- Padrões-chave: `apps/api/src/modules/pipeline/` (move/reindex/posse), `apps/api/src/modules/proposals/` (CRUD/specs), `apps/web/src/features/pipeline/` (Kanban dnd-kit), `apps/web/src/features/propostas/` (listagem/ficha/form)
