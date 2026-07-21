---
date: 2026-07-21T15:07:26-03:00
author: claude
source_prd: specs/research/2026-07-21-fase-2-pipeline.md
git_commit: 26d71f511620a3e20e51224b9aae66008c98e7a6
branch: main
status: implemented
tags: [spec, pipeline, deals, stages, kanban, dnd-kit]
---

# Spec: Fase 2 — Pipeline (estágios configuráveis + Kanban de oportunidades)

## Overview

Implementar a camada de aplicação da Fase 2 sobre uma persistência **já pronta** (models
`PipelineStage`/`Deal`, índice `Deal(stageId, position)`, seed dos 7 estágios). O trabalho é
backend (NestJS) + frontend (React), sem migration nova no caminho principal.

No **backend**, criar um único `PipelineModule` (coeso: estágios + deals) seguindo o padrão em
camadas consolidado na Fase 1 (`domain`/`application`/`infra`/`api`, DI por token `Symbol`,
posse derivada via `ClientsService` porque `Deal`/`PipelineStage` **não têm `ownerId`**). Entrega
CRUD de estágios (com reordenação e proteção contra exclusão de estágio em uso), CRUD de deals,
`PATCH /deals/:id/move` (reindexação de `position` em `$transaction`, `stageMovedAt`, motivo de
perda obrigatório) e um endpoint de board sem paginação.

No **frontend**, criar `features/pipeline/` replicando os padrões de `clientes` (api 3-arquivos,
TanStack Query, RHF+Zod), com um Kanban **dnd-kit** (drag & drop + optimistic update), diálogo de
motivo de perda ao mover para "Perdeu", indicador "esfriando" derivado no client (> 7 dias de
`stageMovedAt`), uma tela enxuta de configuração de estágios e uma aba "Oportunidades" na ficha do
cliente.

## Current State

- **Persistência pronta**: `apps/api/prisma/schema.prisma:70-99` (`PipelineStage`, `Deal`),
  enum `ServiceType` (`:260-264`), índice `@@index([stageId, position])`, seed idempotente dos 7
  estágios (`apps/api/prisma/seed.ts`). **Nenhuma migration nova.**
- **Backend**: `apps/api/src/modules/` tem `activities`, `auth`, `clients`, `contacts`, `users`.
  `JwtAuthGuard` global via `APP_GUARD` (`app.module.ts`), `@CurrentUserId()` lê `req.user.sub`,
  helpers de paginação em `shared/pagination.ts`. Não há módulo de pipeline.
- **Frontend**: `/pipeline` renderiza `<PlaceholderPage title="Pipeline" />` (`routes/router.tsx:35`);
  item de nav já existe (`app/nav.ts`). Padrão `clientes` consolidado. **dnd-kit não instalado.**
  `SERVICE_TYPE_LABELS`/`translateServiceType` já existem (`lib/labels.ts:37-42`).

## Desired End State

- **API** expõe, sob `/api/v1` (Bearer): `GET/POST /pipeline-stages`, `PATCH /pipeline-stages/reorder`,
  `PATCH/DELETE /pipeline-stages/:id`; `GET /deals` (paginado), `GET /deals/board` (flat, sem
  paginação), `POST /deals`, `GET/PATCH/DELETE /deals/:id`, `PATCH /deals/:id/move`. Todas
  documentadas em `ENDPOINTS.md`. Posse sempre validada via cliente do deal.
- **Web**: `/pipeline` é um Kanban funcional com drag & drop, criação/edição de deal, motivo de
  perda obrigatório ao arrastar para "Perdeu", indicador "esfriando", tela de configuração de
  estágios; a ficha do cliente ganha a aba "Oportunidades".
- `pnpm --filter api test`, `pnpm --filter api build`, `pnpm --filter web build` passam.

## What We're NOT Doing

- **Criar Projeto ao "Ganhar"** — Projeto é Fase 4; na Fase 2 mover para "Ganhou" apenas move o
  deal (sem CTA/gancho).
- **Cron / `@nestjs/schedule`** — "esfriando" é derivado no client a partir de `stageMovedAt`;
  threshold constante de 7 dias no MVP (não configurável).
- **Soft delete de deal** — `DELETE /deals/:id` é hard delete; FKs `SET NULL` já preservam
  `Proposal`/`Activity` vinculados.
- **Paginação por coluna no board** — o board carrega todos os deals do owner de uma vez.
- **`position` fracionário/gap** — inteiro 0-based reindexado no backend em transação.
- **Migration nova / mudança de schema** — a persistência já cobre a Fase 2.
- **Multi-tenancy / RLS** — segue single-tenant; posse via `client.ownerId`.

---

## Phase 1: Backend — Estágios (pipeline-stages)

### Goal
Criar o `PipelineModule` e a camada completa de `pipeline-stages` (CRUD + reordenar + proteção
contra exclusão de estágio em uso), registrada e documentada.

### Changes

#### Módulo e domínio

**Create**: `apps/api/src/modules/pipeline/domain/pipeline-stage.repository.ts`
Interface + token DI. Estágios são globais (sem `ownerId`).
```ts
import type { PipelineStage, Prisma } from '@prisma/client';

export const PIPELINE_STAGE_REPOSITORY = Symbol('PIPELINE_STAGE_REPOSITORY');

export interface PipelineStageRepository {
  findAllOrdered(): Promise<PipelineStage[]>;
  findById(id: string): Promise<PipelineStage | null>;
  findByName(name: string): Promise<PipelineStage | null>;
  create(data: Prisma.PipelineStageUncheckedCreateInput): Promise<PipelineStage>;
  update(id: string, data: Prisma.PipelineStageUpdateInput): Promise<PipelineStage>;
  delete(id: string): Promise<void>;
  /** Maior `order` atual (ou -1 se não houver estágios). */
  maxOrder(): Promise<number>;
  /** Quantos deals apontam para este estágio (guard de exclusão). */
  countDeals(stageId: string): Promise<number>;
  /** Reatribui `order` sequencial na ordem dos ids, em transação. */
  reorder(ids: string[]): Promise<void>;
}
```

**Create**: `apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts`
```ts
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
    const r = await this.prisma.pipelineStage.aggregate({ _max: { order: true } });
    return r._max.order ?? -1;
  }
  countDeals(stageId: string) {
    return this.prisma.deal.count({ where: { stageId } });
  }
  async reorder(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.pipelineStage.update({ where: { id }, data: { order: index } }),
      ),
    );
  }
}
```

**Create**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts`
Exceções pt-BR. Guard de exclusão via `countDeals` (evita importar Prisma na application — regra
do `apps/api/CLAUDE.md`).
```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PipelineStage } from '@prisma/client';
import { PIPELINE_STAGE_REPOSITORY, type PipelineStageRepository } from '../domain/pipeline-stage.repository';
import type { CreatePipelineStageDto } from '../api/dto/create-pipeline-stage.dto';
import type { UpdatePipelineStageDto } from '../api/dto/update-pipeline-stage.dto';

@Injectable()
export class PipelineStagesService {
  constructor(
    @Inject(PIPELINE_STAGE_REPOSITORY) private readonly repo: PipelineStageRepository,
  ) {}

  list(): Promise<PipelineStage[]> {
    return this.repo.findAllOrdered();
  }

  async findOne(id: string): Promise<PipelineStage> {
    const stage = await this.repo.findById(id);
    if (!stage) throw new NotFoundException('Estágio não encontrado.');
    return stage;
  }

  /** Primeiro estágio (menor `order`); usado como destino padrão de novos deals. */
  async firstStage(): Promise<PipelineStage> {
    const [first] = await this.repo.findAllOrdered();
    if (!first) throw new NotFoundException('Nenhum estágio configurado.');
    return first;
  }

  async create(dto: CreatePipelineStageDto): Promise<PipelineStage> {
    if (await this.repo.findByName(dto.name)) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    const order = (await this.repo.maxOrder()) + 1;
    return this.repo.create({
      name: dto.name,
      order,
      isWon: dto.isWon ?? false,
      isLost: dto.isLost ?? false,
    });
  }

  async update(id: string, dto: UpdatePipelineStageDto): Promise<PipelineStage> {
    const stage = await this.findOne(id);
    if (dto.name && dto.name !== stage.name && (await this.repo.findByName(dto.name))) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    return this.repo.update(id, dto);
  }

  async reorder(ids: string[]): Promise<PipelineStage[]> {
    await this.repo.reorder(ids);
    return this.repo.findAllOrdered();
  }

  async delete(id: string): Promise<void> {
    await this.findOne(id);
    if ((await this.repo.countDeals(id)) > 0) {
      throw new ConflictException(
        'Não é possível excluir um estágio que possui oportunidades.',
      );
    }
    await this.repo.delete(id);
  }
}
```

#### DTOs (api/dto)

**Create**: `apps/api/src/modules/pipeline/api/dto/create-pipeline-stage.dto.ts`
```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePipelineStageDto {
  @IsString({ message: 'O nome do estágio é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional() @IsBoolean() isWon?: boolean;
  @IsOptional() @IsBoolean() isLost?: boolean;
}
```

**Create**: `apps/api/src/modules/pipeline/api/dto/update-pipeline-stage.dto.ts`
```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreatePipelineStageDto } from './create-pipeline-stage.dto';

export class UpdatePipelineStageDto extends PartialType(CreatePipelineStageDto) {}
```

**Create**: `apps/api/src/modules/pipeline/api/dto/reorder-stages.dto.ts`
```ts
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderStagesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Informe a ordem dos estágios.' })
  @IsUUID('4', { each: true, message: 'Estágio inválido.' })
  ids: string[];
}
```

#### Controller

**Create**: `apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts`
⚠️ `@Patch('reorder')` **deve ser declarado antes** de `@Patch(':id')` para não ser capturado
pela rota paramétrica.
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PipelineStagesService } from '../application/pipeline-stages.service';
import { CreatePipelineStageDto } from './dto/create-pipeline-stage.dto';
import { UpdatePipelineStageDto } from './dto/update-pipeline-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

@Controller('pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly stages: PipelineStagesService) {}

  @Get() list() {
    return this.stages.list();
  }

  @Post() create(@Body() dto: CreatePipelineStageDto) {
    return this.stages.create(dto);
  }

  @Patch('reorder') reorder(@Body() dto: ReorderStagesDto) {
    return this.stages.reorder(dto.ids);
  }

  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdatePipelineStageDto) {
    return this.stages.update(id, dto);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.stages.delete(id);
  }
}
```

#### Módulo + registro

**Create**: `apps/api/src/modules/pipeline/pipeline.module.ts`
(Deals serão adicionados na Fase 2 — este arquivo será editado lá.)
```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PipelineStagesController } from './api/pipeline-stages.controller';
import { PipelineStagesService } from './application/pipeline-stages.service';
import { PIPELINE_STAGE_REPOSITORY } from './domain/pipeline-stage.repository';
import { PrismaPipelineStageRepository } from './infra/prisma-pipeline-stage.repository';

@Module({
  imports: [ClientsModule],
  controllers: [PipelineStagesController],
  providers: [
    PipelineStagesService,
    { provide: PIPELINE_STAGE_REPOSITORY, useClass: PrismaPipelineStageRepository },
  ],
  exports: [PipelineStagesService],
})
export class PipelineModule {}
```

**Modify**: `apps/api/src/app.module.ts`
Adicionar import e registrar no array `imports`.
```ts
import { PipelineModule } from './modules/pipeline/pipeline.module';
// ...
  imports: [
    // ...
    ContactsModule,
    ActivitiesModule,
    PipelineModule, // <-- adicionar
  ],
```

#### Teste

**Create**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.spec.ts`
Mock manual da interface (padrão `clients.service.spec.ts`).
```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PipelineStagesService } from './pipeline-stages.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

describe('PipelineStagesService', () => {
  let repo: jest.Mocked<PipelineStageRepository>;
  let service: PipelineStagesService;

  beforeEach(() => {
    repo = {
      findAllOrdered: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxOrder: jest.fn(),
      countDeals: jest.fn(),
      reorder: jest.fn(),
    };
    service = new PipelineStagesService(repo);
  });

  it('cria estágio no fim da ordem', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.maxOrder.mockResolvedValue(4);
    repo.create.mockResolvedValue({ id: 's1' } as never);
    await service.create({ name: 'Qualificação' } as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Qualificação', order: 5, isWon: false, isLost: false }),
    );
  });

  it('rejeita nome duplicado com ConflictException', async () => {
    repo.findByName.mockResolvedValue({ id: 's9' } as never);
    await expect(service.create({ name: 'Ganhou' } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lança NotFoundException ao buscar estágio inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('impede excluir estágio com oportunidades', async () => {
    repo.findById.mockResolvedValue({ id: 's1' } as never);
    repo.countDeals.mockResolvedValue(3);
    await expect(service.delete('s1')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
```

#### Documentação (DoD)

**Modify**: `apps/api/ENDPOINTS.md` — adicionar seção `## Pipeline stages` no mesmo commit, no
formato fixo (`Propósito`/`Auth`/`Body`/`Resposta`/`Erros`/`Handler`), cobrindo os 5 endpoints:
- `GET /pipeline-stages` → `200 PipelineStage[]` (ordenados por `order`).
- `POST /pipeline-stages` → `{ name, isWon?, isLost? }` → `201 PipelineStage`; erros `409 Já existe um estágio com este nome.`
- `PATCH /pipeline-stages/reorder` → `{ ids: uuid[] }` → `200 PipelineStage[]`.
- `PATCH /pipeline-stages/:id` → parciais → `200 PipelineStage`; `404 Estágio não encontrado.`, `409`.
- `DELETE /pipeline-stages/:id` → `200`; `404 Estágio não encontrado.`, `409 Não é possível excluir um estágio que possui oportunidades.`

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — passa, incluindo `pipeline-stages.service.spec.ts`.
- [x] `pnpm --filter api build` — compila (módulo registrado, tipos OK).
- [x] `pnpm --filter api lint` — sem erros.

#### Manual Verification
- [ ] Com API rodando (`docker compose up -d` + seed aplicado): `GET /api/v1/pipeline-stages` (com Bearer) retorna os 7 estágios ordenados.
- [ ] `POST /pipeline-stages` cria estágio no fim; nome repetido retorna 409 em pt-BR.
- [ ] `DELETE` de um estágio do seed que tenha deal retorna 409 pt-BR; estágio novo/vazio exclui com 200.
- [ ] `PATCH /pipeline-stages/reorder` reordena e o `GET` reflete a nova ordem.

**⏸ PAUSE**: Após verificação automatizada, parar para confirmação manual antes da Fase 2.

---

## Phase 2: Backend — Deals (CRUD + move + board)

### Goal
Adicionar a camada de `deals` ao `PipelineModule`: CRUD, listagem paginada, board sem paginação,
e `PATCH /deals/:id/move` com reindexação transacional de `position`, `stageMovedAt` e motivo de
perda obrigatório.

### Changes

#### Domínio

**Create**: `apps/api/src/modules/pipeline/domain/deal.repository.ts`
```ts
import type { Prisma } from '@prisma/client';

export const DEAL_REPOSITORY = Symbol('DEAL_REPOSITORY');

/** Deal + dados mínimos do cliente para exibir no card do board/lista. */
export type DealWithClient = Prisma.DealGetPayload<{
  include: { client: { select: { id: true; name: true } } };
}>;

export interface DealListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  stageId?: string;
  search?: string; // casa em title
  skip: number;
  take: number;
}

/** Campos ajustados no destino durante um move (calculados no service). */
export interface DealMovePatch {
  stageMovedAt?: Date;
  lostReason?: string | null;
}

export interface DealRepository {
  create(data: Prisma.DealUncheckedCreateInput): Promise<DealWithClient>;
  findById(id: string): Promise<DealWithClient | null>;
  findManyAndCount(filter: DealListFilter): Promise<{ data: DealWithClient[]; total: number }>;
  /** Todos os deals do owner, ordenados por (stageId, position) — alimenta o board. */
  findAllForBoard(ownerId: string): Promise<DealWithClient[]>;
  update(id: string, data: Prisma.DealUpdateInput): Promise<DealWithClient>;
  delete(id: string): Promise<void>;
  /** Maior `position` na coluna (ou -1 se vazia). */
  maxPositionInStage(stageId: string): Promise<number>;
  /** Move o deal p/ (stageId, position) reindexando as colunas afetadas em transação. */
  move(dealId: string, toStageId: string, toPosition: number, patch: DealMovePatch): Promise<DealWithClient>;
}
```

#### Infra

**Create**: `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts`
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  DealListFilter,
  DealMovePatch,
  DealRepository,
  DealWithClient,
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
    return this.prisma.deal.update({ where: { id }, data, include: withClient });
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

  async move(dealId: string, toStageId: string, toPosition: number, patch: DealMovePatch) {
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

      return tx.deal.findUniqueOrThrow({ where: { id: dealId }, include: withClient });
    });
  }
}
```

#### Application

**Create**: `apps/api/src/modules/pipeline/application/deals.service.ts`
Posse via `ClientsService.findOne` (padrão `loadOwned`); estágio validado via
`PipelineStagesService`.
```ts
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DEAL_REPOSITORY, type DealRepository, type DealWithClient } from '../domain/deal.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { PipelineStagesService } from './pipeline-stages.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateDealDto } from '../api/dto/create-deal.dto';
import type { UpdateDealDto } from '../api/dto/update-deal.dto';
import type { ListDealsQueryDto } from '../api/dto/list-deals-query.dto';
import type { MoveDealDto } from '../api/dto/move-deal.dto';

@Injectable()
export class DealsService {
  constructor(
    @Inject(DEAL_REPOSITORY) private readonly repo: DealRepository,
    private readonly clients: ClientsService,
    private readonly stages: PipelineStagesService,
  ) {}

  async list(ownerId: string, query: ListDealsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      stageId: query.stageId,
      search: query.search,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  board(ownerId: string): Promise<DealWithClient[]> {
    return this.repo.findAllForBoard(ownerId);
  }

  async findOne(ownerId: string, id: string): Promise<DealWithClient> {
    return this.loadOwned(ownerId, id);
  }

  async create(ownerId: string, dto: CreateDealDto): Promise<DealWithClient> {
    await this.clients.findOne(ownerId, dto.clientId); // valida que o cliente é do dono
    const stage = dto.stageId
      ? await this.stages.findOne(dto.stageId)
      : await this.stages.firstStage();
    const position = (await this.repo.maxPositionInStage(stage.id)) + 1;
    return this.repo.create({
      clientId: dto.clientId,
      stageId: stage.id,
      title: dto.title,
      serviceType: dto.serviceType,
      amount: dto.amount ?? null,
      probability: dto.probability ?? null,
      expectedClose: dto.expectedClose ? new Date(dto.expectedClose) : null,
      position,
    });
  }

  async update(ownerId: string, id: string, dto: UpdateDealDto): Promise<DealWithClient> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.serviceType !== undefined ? { serviceType: dto.serviceType } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.probability !== undefined ? { probability: dto.probability } : {}),
      ...(dto.expectedClose !== undefined
        ? { expectedClose: dto.expectedClose ? new Date(dto.expectedClose) : null }
        : {}),
    });
  }

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
      patch.lostReason = null; // saiu de "Perdeu" → limpa o motivo
    }
    return this.repo.move(id, dto.stageId, dto.position, patch);
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.loadOwned(ownerId, id);
    await this.repo.delete(id);
  }

  /** Carrega o deal garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(ownerId: string, id: string): Promise<DealWithClient> {
    const deal = await this.repo.findById(id);
    if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
    await this.clients.findOne(ownerId, deal.clientId); // 404 se não for do dono
    return deal;
  }
}
```

#### DTOs

**Create**: `apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts`
```ts
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ServiceType } from '@prisma/client';

export class CreateDealDto {
  @IsString({ message: 'O título é obrigatório.' })
  @MinLength(2, { message: 'O título deve ter no mínimo 2 caracteres.' })
  title: string;

  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsOptional() @IsUUID('4', { message: 'Estágio inválido.' })
  stageId?: string;

  @IsEnum(ServiceType, { message: 'Tipo de serviço inválido.' })
  serviceType: ServiceType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' })
  amount?: number;

  @IsOptional()
  @IsInt({ message: 'A probabilidade deve ser um número inteiro.' })
  @Min(0, { message: 'A probabilidade deve estar entre 0 e 100.' })
  @Max(100, { message: 'A probabilidade deve estar entre 0 e 100.' })
  probability?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Data prevista inválida.' })
  expectedClose?: string;
}
```

**Create**: `apps/api/src/modules/pipeline/api/dto/update-deal.dto.ts`
`clientId` e `stageId` fora do update (cliente não muda; estágio muda só via `/move`).
```ts
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateDealDto } from './create-deal.dto';

export class UpdateDealDto extends PartialType(
  OmitType(CreateDealDto, ['clientId', 'stageId'] as const),
) {}
```

**Create**: `apps/api/src/modules/pipeline/api/dto/list-deals-query.dto.ts`
```ts
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListDealsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID('4', { message: 'Cliente inválido.' }) clientId?: string;
  @IsOptional() @IsUUID('4', { message: 'Estágio inválido.' }) stageId?: string;
  @IsOptional() @IsString() search?: string;
}
```

**Create**: `apps/api/src/modules/pipeline/api/dto/move-deal.dto.ts`
```ts
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class MoveDealDto {
  @IsUUID('4', { message: 'Estágio inválido.' })
  stageId: string;

  @IsInt({ message: 'Posição inválida.' })
  @Min(0, { message: 'Posição inválida.' })
  position: number;

  @IsOptional() @IsString() lostReason?: string;
}
```

#### Controller

**Create**: `apps/api/src/modules/pipeline/api/deals.controller.ts`
⚠️ `@Get('board')` **antes** de `@Get(':id')`.
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DealsService } from '../application/deals.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { MoveDealDto } from './dto/move-deal.dto';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get() list(@CurrentUserId() ownerId: string, @Query() query: ListDealsQueryDto) {
    return this.deals.list(ownerId, query);
  }

  @Get('board') board(@CurrentUserId() ownerId: string) {
    return this.deals.board(ownerId);
  }

  @Post() create(@CurrentUserId() ownerId: string, @Body() dto: CreateDealDto) {
    return this.deals.create(ownerId, dto);
  }

  @Get(':id') findOne(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.deals.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.deals.update(ownerId, id, dto);
  }

  @Patch(':id/move') move(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: MoveDealDto,
  ) {
    return this.deals.move(ownerId, id, dto);
  }

  @Delete(':id') remove(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.deals.delete(ownerId, id);
  }
}
```

#### Módulo (editar)

**Modify**: `apps/api/src/modules/pipeline/pipeline.module.ts`
Adicionar `DealsController`, `DealsService` e o provider do `DEAL_REPOSITORY`; exportar `DealsService`.
```ts
import { DealsController } from './api/deals.controller';
import { DealsService } from './application/deals.service';
import { DEAL_REPOSITORY } from './domain/deal.repository';
import { PrismaDealRepository } from './infra/prisma-deal.repository';
// ...
@Module({
  imports: [ClientsModule],
  controllers: [PipelineStagesController, DealsController],
  providers: [
    PipelineStagesService,
    DealsService,
    { provide: PIPELINE_STAGE_REPOSITORY, useClass: PrismaPipelineStageRepository },
    { provide: DEAL_REPOSITORY, useClass: PrismaDealRepository },
  ],
  exports: [PipelineStagesService, DealsService],
})
export class PipelineModule {}
```

#### Teste

**Create**: `apps/api/src/modules/pipeline/application/deals.service.spec.ts`
Mock manual de `DealRepository`, `ClientsService`, `PipelineStagesService`.
```ts
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DealsService } from './deals.service';
import type { DealRepository } from '../domain/deal.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { PipelineStagesService } from './pipeline-stages.service';

describe('DealsService', () => {
  let repo: jest.Mocked<DealRepository>;
  let clients: { findOne: jest.Mock };
  let stages: { findOne: jest.Mock; firstStage: jest.Mock };
  let service: DealsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findAllForBoard: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxPositionInStage: jest.fn(),
      move: jest.fn(),
    } as never;
    clients = { findOne: jest.fn() };
    stages = { findOne: jest.fn(), firstStage: jest.fn() };
    service = new DealsService(
      repo,
      clients as unknown as ClientsService,
      stages as unknown as PipelineStagesService,
    );
  });

  it('cria deal no fim do estágio padrão, validando posse do cliente', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.firstStage.mockResolvedValue({ id: 'stage-0', isLost: false });
    repo.maxPositionInStage.mockResolvedValue(2);
    repo.create.mockResolvedValue({ id: 'd1' } as never);
    await service.create('owner', {
      title: 'Projeto X',
      clientId: 'cli',
      serviceType: 'SOFTWARE',
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner', 'cli');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 'stage-0', position: 3 }),
    );
  });

  it('lança NotFoundException ao carregar deal inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exige motivo de perda ao mover para estágio isLost', async () => {
    repo.findById.mockResolvedValue({ id: 'd1', clientId: 'cli', stageId: 's1' } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'perdeu', isLost: true });
    await expect(
      service.move('owner', 'd1', { stageId: 'perdeu', position: 0 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.move).not.toHaveBeenCalled();
  });

  it('atualiza stageMovedAt ao mudar de estágio', async () => {
    repo.findById.mockResolvedValue({ id: 'd1', clientId: 'cli', stageId: 's1' } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 's2', isLost: false });
    repo.move.mockResolvedValue({ id: 'd1' } as never);
    await service.move('owner', 'd1', { stageId: 's2', position: 0 });
    expect(repo.move).toHaveBeenCalledWith(
      'd1',
      's2',
      0,
      expect.objectContaining({ stageMovedAt: expect.any(Date), lostReason: null }),
    );
  });
});
```

#### Documentação (DoD)

**Modify**: `apps/api/ENDPOINTS.md` — adicionar seção `## Deals` cobrindo:
`GET /deals` (paginado, query `page?,limit?,clientId?,stageId?,search?`), `GET /deals/board`
(`200 Deal[]` com `client:{id,name}`, sem paginação), `POST /deals`, `GET /deals/:id`,
`PATCH /deals/:id`, `PATCH /deals/:id/move` (`{stageId,position,lostReason?}`; `422 Informe o
motivo da perda.`), `DELETE /deals/:id`. Erros: `404 Oportunidade não encontrada.` /
`404 Cliente não encontrado.` / `404 Estágio não encontrado.`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — passa, incluindo `deals.service.spec.ts`.
- [x] `pnpm --filter api build` — compila.
- [x] `pnpm --filter api lint` — sem erros.

#### Manual Verification
- [ ] `POST /deals` com `clientId` de outro contexto/inexistente → `404 Cliente não encontrado.`
- [ ] `POST /deals` sem `stageId` cria no primeiro estágio com `position` no fim da coluna.
- [ ] `GET /deals/board` retorna todos os deals com `client.name`, ordenados por stage+position.
- [ ] `PATCH /deals/:id/move` para "Perdeu" sem `lostReason` → `422 Informe o motivo da perda.`; com motivo, move e grava `lostReason` + `stageMovedAt`.
- [ ] Após vários moves, as `position` de cada coluna permanecem 0-based contíguas (sem furos/duplicatas).
- [ ] `DELETE /deals/:id` remove o deal; proposta/atividade vinculada permanece com `dealId = null`.

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 3.

---

## Phase 3: Frontend — Fundação da feature pipeline

### Goal
Instalar dnd-kit e criar a feature `pipeline` com camada de dados (api/hooks/types), o
`DealFormDialog` e o `PipelineBoardPage` renderizando colunas e cards **sem** drag & drop ainda
(criar/editar já funcionam). Trocar a rota `/pipeline`.

### Changes

#### Dependência

Instalar dnd-kit (da raiz, pnpm workspaces):
```bash
pnpm --filter web add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

#### Camada de dados

**Create**: `apps/web/src/features/pipeline/api/types.ts`
```ts
import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ServiceType = 'SOFTWARE' | 'WEBSITE' | 'PAID_TRAFFIC';

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}

export interface Deal {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  stageId: string;
  title: string;
  serviceType: ServiceType;
  amount?: string | null; // Decimal serializa como string no JSON
  probability?: number | null;
  expectedClose?: string | null;
  lostReason?: string | null;
  position: number;
  stageMovedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealBody {
  title: string;
  clientId: string;
  serviceType: ServiceType;
  amount?: number;
  probability?: number;
  expectedClose?: string;
}
export type UpdateDealBody = Partial<Omit<CreateDealBody, 'clientId'>>;
export interface MoveDealBody {
  stageId: string;
  position: number;
  lostReason?: string;
}

export interface CreateStageBody {
  name: string;
  isWon?: boolean;
  isLost?: boolean;
}
export type UpdateStageBody = Partial<CreateStageBody>;
```
> `Paginated<T>` é reexportado do tipo já existente em `clientes/api/types` (tipo puro, sem lógica
> — reuso aceitável entre features por ser contrato transversal). Se preferir isolamento estrito,
> mover `Paginated`/`PageMeta` para `@/lib/pagination` num passo opcional.

**Create**: `apps/web/src/features/pipeline/api/deals.api.ts`
```ts
import { api } from '@/lib/api';
import type {
  CreateDealBody,
  Deal,
  MoveDealBody,
  Paginated,
  UpdateDealBody,
} from './types';

export const dealsApi = {
  board: () => api.get<Deal[]>('/deals/board').then((r) => r.data),
  listByClient: (clientId: string) =>
    api
      .get<Paginated<Deal>>('/deals', { params: { clientId, limit: 100 } })
      .then((r) => r.data),
  create: (body: CreateDealBody) => api.post<Deal>('/deals', body).then((r) => r.data),
  update: (id: string, body: UpdateDealBody) =>
    api.patch<Deal>(`/deals/${id}`, body).then((r) => r.data),
  move: (id: string, body: MoveDealBody) =>
    api.patch<Deal>(`/deals/${id}/move`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/deals/${id}`).then((r) => r.data),
};
```

**Create**: `apps/web/src/features/pipeline/api/stages.api.ts`
```ts
import { api } from '@/lib/api';
import type { CreateStageBody, PipelineStage, UpdateStageBody } from './types';

export const stagesApi = {
  list: () => api.get<PipelineStage[]>('/pipeline-stages').then((r) => r.data),
  create: (body: CreateStageBody) =>
    api.post<PipelineStage>('/pipeline-stages', body).then((r) => r.data),
  update: (id: string, body: UpdateStageBody) =>
    api.patch<PipelineStage>(`/pipeline-stages/${id}`, body).then((r) => r.data),
  reorder: (ids: string[]) =>
    api.patch<PipelineStage[]>('/pipeline-stages/reorder', { ids }).then((r) => r.data),
  remove: (id: string) => api.delete(`/pipeline-stages/${id}`).then((r) => r.data),
};
```

**Create**: `apps/web/src/features/pipeline/api/clients-lookup.api.ts`
Para o seletor de cliente do `DealFormDialog` sem importar o interior da feature `clientes`
(apenas uma chamada HTTP crua à API pública).
```ts
import { api } from '@/lib/api';

export interface ClientOption {
  id: string;
  name: string;
}
interface ClientsPage {
  data: ClientOption[];
}

export const clientsLookupApi = {
  search: (search?: string) =>
    api
      .get<ClientsPage>('/clients', { params: { search: search || undefined, limit: 20 } })
      .then((r) => r.data.data),
};
```

**Modify**: `apps/web/src/lib/query-keys.ts` — adicionar blocos `deals` e `stages`.
```ts
export const queryKeys = {
  clients: { /* … inalterado … */ },
  activities: { /* … inalterado … */ },
  deals: {
    all: ['deals'] as const,
    board: ['deals', 'board'] as const,
    byClient: (clientId: string) => ['deals', 'client', clientId] as const,
  },
  stages: {
    all: ['stages'] as const,
  },
  clientOptions: (search: string) => ['client-options', search] as const,
} as const;
```

**Create**: `apps/web/src/features/pipeline/api/hooks.ts`
`useMoveDeal` é o único com optimistic update (detalhado na Fase 4 — nesta fase pode invalidar
simples; será substituído na 4). Demais mutations invalidam board + byClient.
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { dealsApi } from './deals.api';
import { stagesApi } from './stages.api';
import { clientsLookupApi } from './clients-lookup.api';
import type { CreateDealBody, CreateStageBody, UpdateDealBody, UpdateStageBody } from './types';

// --- Board / stages ---
export function useBoard() {
  return useQuery({ queryKey: queryKeys.deals.board, queryFn: dealsApi.board });
}
export function useStages() {
  return useQuery({ queryKey: queryKeys.stages.all, queryFn: stagesApi.list });
}
export function useDealsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.deals.byClient(clientId),
    queryFn: () => dealsApi.listByClient(clientId),
  });
}
export function useClientOptions(search: string) {
  return useQuery({
    queryKey: queryKeys.clientOptions(search),
    queryFn: () => clientsLookupApi.search(search),
  });
}

// --- Deal mutations ---
function invalidateDeals(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
}
export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDealBody) => dealsApi.create(body),
    onSuccess: () => invalidateDeals(qc),
  });
}
export function useUpdateDeal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDealBody) => dealsApi.update(id, body),
    onSuccess: () => invalidateDeals(qc),
  });
}
export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dealsApi.remove(id),
    onSuccess: () => invalidateDeals(qc),
  });
}

// --- Stage mutations ---
function invalidateStages(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.stages.all });
  void qc.invalidateQueries({ queryKey: queryKeys.deals.board });
}
export function useCreateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStageBody) => stagesApi.create(body),
    onSuccess: () => invalidateStages(qc),
  });
}
export function useUpdateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStageBody }) =>
      stagesApi.update(id, body),
    onSuccess: () => invalidateStages(qc),
  });
}
export function useReorderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => stagesApi.reorder(ids),
    onSuccess: () => invalidateStages(qc),
  });
}
export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stagesApi.remove(id),
    onSuccess: () => invalidateStages(qc),
  });
}
```

#### Helpers de exibição

**Create**: `apps/web/src/features/pipeline/lib/deal-format.ts`
```ts
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata o `amount` (string do Decimal) como moeda pt-BR, ou '—' se nulo. */
export function formatDealAmount(amount?: string | null): string {
  if (amount == null || amount === '') return '—';
  return currency.format(Number(amount));
}

const COOLING_DAYS = 7;

/** Dias parados no estágio atual (desde `stageMovedAt`). */
export function daysInStage(stageMovedAt: string): number {
  const ms = Date.now() - new Date(stageMovedAt).getTime();
  return Math.floor(ms / 86_400_000);
}

/** "Esfriando": parado > 7 dias (indicador só aplicado a estágios não terminais). */
export function isCooling(stageMovedAt: string): boolean {
  return daysInStage(stageMovedAt) > COOLING_DAYS;
}
```

#### DealFormDialog

**Create**: `apps/web/src/features/pipeline/DealFormDialog.tsx`
RHF+Zod. Segue o padrão de `ClientFormDialog` (schema, `blank`, `extractApiMessage`, toasts,
`MoneyInput`, `Controller`+`Select`). Sem seletor de estágio (deal nasce no 1º estágio; move é via
board). Com `defaultClientId`, trava o cliente (uso na aba do cliente).
```tsx
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { SERVICE_TYPE_LABELS, translateServiceType } from '@/lib/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClientOptions, useCreateDeal, useUpdateDeal } from './api/hooks';
import type { Deal, ServiceType } from './api/types';

const schema = z.object({
  title: z.string().min(2, 'O título deve ter no mínimo 2 caracteres.'),
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE', 'WEBSITE', 'PAID_TRAFFIC']),
  amount: z.number().min(0).optional(),
  probability: z
    .number()
    .int()
    .min(0, 'A probabilidade deve estar entre 0 e 100.')
    .max(100, 'A probabilidade deve estar entre 0 e 100.')
    .optional(),
  expectedClose: z.string().optional(),
});
type Values = z.infer<typeof schema>;

function extractApiMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(msg)) return msg[0] ?? fallback;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal;
  defaultClientId?: string;
}

export function DealFormDialog({ open, onOpenChange, deal, defaultClientId }: Props) {
  const isEdit = !!deal;
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal(deal?.id ?? '');

  const [clientSearch, setClientSearch] = useState('');
  const debounced = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debounced);

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<Values>({
      resolver: zodResolver(schema),
      defaultValues: { title: '', clientId: defaultClientId ?? '', serviceType: 'SOFTWARE' },
    });

  useEffect(() => {
    if (!open) return;
    reset(
      deal
        ? {
            title: deal.title,
            clientId: deal.clientId,
            serviceType: deal.serviceType,
            amount: deal.amount != null ? Number(deal.amount) : undefined,
            probability: deal.probability ?? undefined,
            expectedClose: deal.expectedClose?.slice(0, 10) ?? '',
          }
        : { title: '', clientId: defaultClientId ?? '', serviceType: 'SOFTWARE' },
    );
  }, [open, deal, defaultClientId, reset]);

  const onSubmit = async (v: Values) => {
    const body = {
      title: v.title.trim(),
      clientId: v.clientId,
      serviceType: v.serviceType,
      amount: v.amount && v.amount > 0 ? v.amount : undefined,
      probability: v.probability,
      expectedClose: v.expectedClose || undefined,
    };
    try {
      if (isEdit) {
        const { clientId: _omit, ...patch } = body;
        await updateDeal.mutateAsync(patch);
        toast.success('Oportunidade atualizada.');
      } else {
        await createDeal.mutateAsync(body);
        toast.success('Oportunidade criada.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit ? 'Falha ao atualizar a oportunidade.' : 'Falha ao criar a oportunidade.',
        ),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar oportunidade' : 'Nova oportunidade'}</DialogTitle>
          <DialogDescription>Dados da oportunidade.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={handleSubmit(onSubmit)}
            id="deal-form"
          >
            <Field className="sm:col-span-2" data-invalid={!!errors.title}>
              <FieldLabel htmlFor="title">Título</FieldLabel>
              <Input id="title" aria-invalid={!!errors.title} {...register('title')} />
              {errors.title && <FieldError>{errors.title.message}</FieldError>}
            </Field>

            {/* Seletor de cliente — oculto quando defaultClientId (aba do cliente) */}
            {!defaultClientId && (
              <Field className="sm:col-span-2" data-invalid={!!errors.clientId}>
                <FieldLabel>Cliente</FieldLabel>
                <Controller
                  control={control}
                  name="clientId"
                  render={({ field }) => (
                    <Select<string> value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger />
                      <SelectContent>
                        <div className="p-2">
                          <Input
                            placeholder="Buscar cliente…"
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                          />
                        </div>
                        {(clientOptions ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.clientId && <FieldError>{errors.clientId.message}</FieldError>}
              </Field>
            )}

            <Field>
              <FieldLabel>Tipo de serviço</FieldLabel>
              <Controller
                control={control}
                name="serviceType"
                render={({ field }) => (
                  <Select<ServiceType> value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger />
                    <SelectContent>
                      {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {translateServiceType(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="amount">Valor</FieldLabel>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput
                    id="amount"
                    value={field.value ?? 0}
                    onValueChange={field.onChange}
                  />
                )}
              />
            </Field>

            <Field data-invalid={!!errors.probability}>
              <FieldLabel htmlFor="probability">Probabilidade (%)</FieldLabel>
              <Input
                id="probability"
                type="number"
                min={0}
                max={100}
                aria-invalid={!!errors.probability}
                {...register('probability', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })}
              />
              {errors.probability && <FieldError>{errors.probability.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="expectedClose">Fechamento previsto</FieldLabel>
              <Input id="expectedClose" type="date" {...register('expectedClose')} />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="deal-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isEdit ? 'Salvar' : 'Criar oportunidade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
> Verificar a API real do `Select` de `@/components/ui/select` para o filtro embutido; se o
> primitivo não aceitar conteúdo arbitrário no `SelectContent`, usar apenas a lista de opções
> (busca via debounce continua funcionando) — o filtro inline é um "nice to have".

#### Card e coluna (estáticos nesta fase)

**Create**: `apps/web/src/features/pipeline/components/DealCard.tsx`
Card puro (sem dnd). Mostra título, cliente, valor, badge de serviço e (se aplicável) indicador
"esfriando".
```tsx
import { Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { translateServiceType } from '@/lib/labels';
import { formatDealAmount, isCooling } from '../lib/deal-format';
import type { Deal } from '../api/types';

interface Props {
  deal: Deal;
  cooling?: boolean; // calculado pelo pai (só estágios não terminais)
  onClick?: () => void;
}

export function DealCard({ deal, cooling, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-sm hover:border-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{deal.title}</span>
        {cooling && isCooling(deal.stageMovedAt) && (
          <Badge variant="destructive" className="gap-1">
            <Flame className="size-3" /> Esfriando
          </Badge>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{deal.client.name}</span>
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{translateServiceType(deal.serviceType)}</Badge>
        <span className="text-sm tabular-nums">{formatDealAmount(deal.amount)}</span>
      </div>
    </button>
  );
}
```

**Create**: `apps/web/src/features/pipeline/components/KanbanColumn.tsx`
Coluna estática nesta fase (recebe os deals já agrupados/ordenados). Cabeçalho com nome do estágio
+ contagem + soma.
```tsx
import type { ReactNode } from 'react';
import { formatDealAmount } from '../lib/deal-format';
import type { Deal, PipelineStage } from '../api/types';

interface Props {
  stage: PipelineStage;
  deals: Deal[];
  children: ReactNode; // cards
}

export function KanbanColumn({ stage, deals, children }: Props) {
  const sum = deals.reduce((acc, d) => acc + (d.amount ? Number(d.amount) : 0), 0);
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{stage.name}</span>
        <span className="text-xs text-muted-foreground">{deals.length}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        {formatDealAmount(String(sum))}
      </span>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
```

#### Página do board

**Create**: `apps/web/src/features/pipeline/PipelineBoardPage.tsx` (export **default**)
Nesta fase: agrupa deals por `stageId`, renderiza colunas + `DealCard`, botões "Nova oportunidade"
e "Configurar estágios" (o segundo só ganha ação na Fase 5), abre `DealFormDialog` para criar/editar.
```tsx
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoard, useStages } from './api/hooks';
import { KanbanColumn } from './components/KanbanColumn';
import { DealCard } from './components/DealCard';
import { DealFormDialog } from './DealFormDialog';
import type { Deal } from './api/types';

export default function PipelineBoardPage() {
  const { data: stages, isLoading: loadingStages } = useStages();
  const { data: deals, isLoading: loadingDeals } = useBoard();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>();

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const d of deals ?? []) {
      const arr = map.get(d.stageId) ?? [];
      arr.push(d);
      map.set(d.stageId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [deals]);

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (deal: Deal) => {
    setEditing(deal);
    setFormOpen(true);
  };

  const isLoading = loadingStages || loadingDeals;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Pipeline</h1>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Nova oportunidade
        </Button>
      </div>

      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72" />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {(stages ?? []).map((stage) => {
            const stageDeals = byStage.get(stage.id) ?? [];
            const cooling = !stage.isWon && !stage.isLost;
            return (
              <KanbanColumn key={stage.id} stage={stage} deals={stageDeals}>
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    cooling={cooling}
                    onClick={() => openEdit(deal)}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>
      )}

      <DealFormDialog open={formOpen} onOpenChange={setFormOpen} deal={editing} />
    </div>
  );
}
```

#### Rota

**Modify**: `apps/web/src/routes/router.tsx`
```tsx
import PipelineBoardPage from '@/features/pipeline/PipelineBoardPage';
// ...
// trocar:
// { path: '/pipeline', element: <PlaceholderPage title="Pipeline" /> },
{ path: '/pipeline', element: <PipelineBoardPage /> },
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — `tsc -b && vite build` sem erros de tipo.
- [x] `pnpm --filter web lint` — sem erros.
- [x] dnd-kit presente em `apps/web/package.json` (será usado só na Fase 4).

#### Manual Verification
- [ ] `/pipeline` renderiza uma coluna por estágio (7 do seed), com os deals nas colunas certas ordenados por `position`.
- [ ] "Nova oportunidade" abre o diálogo; buscar/selecionar cliente + criar → o card aparece no primeiro estágio.
- [ ] Clicar num card abre o formulário em modo edição; salvar reflete no card.
- [ ] Cabeçalho da coluna mostra contagem e soma de valores corretas.

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 4.

---

## Phase 4: Frontend — Kanban drag & drop (dnd-kit + optimistic + motivo de perda + esfriando)

### Goal
Tornar o board arrastável com dnd-kit, persistindo o move com optimistic update; exigir motivo de
perda ao soltar em estágio `isLost`; consolidar o indicador "esfriando".

### Changes

#### Helper de reindexação (compartilhado com o optimistic update)

**Create**: `apps/web/src/features/pipeline/lib/reindex-board.ts`
Espelha a reindexação do backend sobre o array flat do cache do board.
```ts
import type { Deal } from '../api/types';

/**
 * Move `dealId` para (toStageId, toPosition) reindexando as `position` das colunas
 * afetadas. Retorna um NOVO array (imutável) para o cache do React Query.
 */
export function reindexBoard(
  deals: Deal[],
  dealId: string,
  toStageId: string,
  toPosition: number,
): Deal[] {
  const moving = deals.find((d) => d.id === dealId);
  if (!moving) return deals;
  const fromStageId = moving.stageId;

  const target = deals
    .filter((d) => d.stageId === toStageId && d.id !== dealId)
    .sort((a, b) => a.position - b.position);
  const clamped = Math.max(0, Math.min(toPosition, target.length));
  const orderedTarget = [
    ...target.slice(0, clamped),
    { ...moving, stageId: toStageId },
    ...target.slice(clamped),
  ];

  const positions = new Map<string, { stageId: string; position: number }>();
  orderedTarget.forEach((d, i) => positions.set(d.id, { stageId: toStageId, position: i }));

  if (fromStageId !== toStageId) {
    deals
      .filter((d) => d.stageId === fromStageId && d.id !== dealId)
      .sort((a, b) => a.position - b.position)
      .forEach((d, i) => positions.set(d.id, { stageId: fromStageId, position: i }));
  }

  return deals.map((d) => {
    const p = positions.get(d.id);
    return p ? { ...d, stageId: p.stageId, position: p.position } : d;
  });
}
```

#### Mutation de move com optimistic update

**Modify**: `apps/web/src/features/pipeline/api/hooks.ts` — adicionar `useMoveDeal`.
```ts
import { toast } from 'sonner';
import { reindexBoard } from '../lib/reindex-board';
import type { Deal, MoveDealBody } from './types';

export function useMoveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveDealBody }) => dealsApi.move(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals.board });
      const prev = qc.getQueryData<Deal[]>(queryKeys.deals.board);
      if (prev) {
        qc.setQueryData<Deal[]>(
          queryKeys.deals.board,
          reindexBoard(prev, id, body.stageId, body.position),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.deals.board, ctx.prev);
      toast.error('Falha ao mover a oportunidade.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals.board });
    },
  });
}
```

#### Card arrastável

**Create**: `apps/web/src/features/pipeline/components/SortableDealCard.tsx`
Envolve o `DealCard` com `useSortable`.
```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DealCard } from './DealCard';
import type { Deal } from '../api/types';

interface Props {
  deal: Deal;
  cooling: boolean;
  onClick: () => void;
}

export function SortableDealCard({ deal, cooling, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stageId: deal.stageId },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <DealCard deal={deal} cooling={cooling} onClick={onClick} />
    </div>
  );
}
```

#### Coluna como droppable

**Modify**: `apps/web/src/features/pipeline/components/KanbanColumn.tsx`
Envolver os cards num `SortableContext` (`verticalListSortingStrategy`) e registrar a coluna como
`useDroppable` (id = `stage.id`) para aceitar drop em coluna vazia.
```tsx
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
// ... dentro do componente:
const { setNodeRef } = useDroppable({ id: stage.id, data: { stageId: stage.id } });
// aplicar ref no container e:
// <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>
```

#### Diálogo de motivo de perda

**Create**: `apps/web/src/features/pipeline/LostReasonDialog.tsx`
Diálogo simples com textarea obrigatório; usado quando o destino é `isLost`.
```tsx
import { useEffect, useState } from 'react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  onCancel: () => void; // reverter o move visual
}

export function LostReasonDialog({ open, onOpenChange, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(false);
    }
  }, [open]);

  const confirm = () => {
    if (!reason.trim()) {
      setError(true);
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Motivo da perda</DialogTitle>
          <DialogDescription>Informe por que esta oportunidade foi perdida.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field data-invalid={error}>
            <FieldLabel htmlFor="lost-reason">Motivo</FieldLabel>
            <textarea
              id="lost-reason"
              rows={3}
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error && <FieldError>Informe o motivo da perda.</FieldError>}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirm}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

#### Board com DnD

**Modify**: `apps/web/src/features/pipeline/PipelineBoardPage.tsx`
Envolver com `DndContext` (sensor `PointerSensor` com `activationConstraint: { distance: 8 }`,
`collisionDetection: closestCorners`), usar `SortableDealCard`, `DragOverlay` com o card ativo,
e o handler `onDragEnd` que calcula `{stageId, position}` e dispara `useMoveDeal` — interceptando
destino `isLost` para abrir o `LostReasonDialog`.
```tsx
// imports adicionais
import {
  DndContext, DragOverlay, PointerSensor, closestCorners,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useMoveDeal } from './api/hooks';
import { SortableDealCard } from './components/SortableDealCard';
import { LostReasonDialog } from './LostReasonDialog';

// estado adicional
const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string; position: number } | null>(null);
const moveDeal = useMoveDeal();
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

/** Resolve o estágio destino e a posição a partir do `over`. */
function resolveTarget(overId: string, activeId: string) {
  const stage = (stages ?? []).find((s) => s.id === overId);
  if (stage) {
    // soltou sobre a própria coluna (área vazia) → fim da coluna
    const col = byStage.get(stage.id) ?? [];
    const withoutActive = col.filter((d) => d.id !== activeId);
    return { stageId: stage.id, position: withoutActive.length };
  }
  // soltou sobre um card → assume o estágio e o índice desse card
  const overDeal = (deals ?? []).find((d) => d.id === overId);
  if (!overDeal) return null;
  const col = (byStage.get(overDeal.stageId) ?? []).filter((d) => d.id !== activeId);
  const index = col.findIndex((d) => d.id === overId);
  return { stageId: overDeal.stageId, position: index < 0 ? col.length : index };
}

function handleDragStart(e: DragStartEvent) {
  setActiveDeal((deals ?? []).find((d) => d.id === e.active.id) ?? null);
}

function handleDragEnd(e: DragEndEvent) {
  setActiveDeal(null);
  const { active, over } = e;
  if (!over) return;
  const target = resolveTarget(String(over.id), String(active.id));
  if (!target) return;
  const current = (deals ?? []).find((d) => d.id === active.id);
  if (current && current.stageId === target.stageId && current.position === target.position) return;

  const targetStage = (stages ?? []).find((s) => s.id === target.stageId);
  if (targetStage?.isLost) {
    setPendingLost({ id: String(active.id), ...target }); // abre diálogo antes de persistir
    return;
  }
  moveDeal.mutate({ id: String(active.id), body: target });
}
```
No JSX: envolver o board com `<DndContext sensors={sensors} collisionDetection={closestCorners}
onDragStart={handleDragStart} onDragEnd={handleDragEnd}>`, trocar `DealCard` por
`SortableDealCard` dentro das colunas, adicionar `<DragOverlay>{activeDeal && <DealCard
deal={activeDeal} />}</DragOverlay>`, e renderizar o `LostReasonDialog`:
```tsx
<LostReasonDialog
  open={!!pendingLost}
  onOpenChange={(o) => !o && setPendingLost(null)}
  onCancel={() => setPendingLost(null)} // rollback visual = invalidação do board
  onConfirm={(reason) => {
    if (pendingLost) {
      moveDeal.mutate({
        id: pendingLost.id,
        body: { stageId: pendingLost.stageId, position: pendingLost.position, lostReason: reason },
      });
    }
    setPendingLost(null);
  }}
/>
```
> Como o move só é persistido após confirmar o motivo, ao cancelar não há optimistic pendente a
> reverter (o card volta ao lugar na próxima renderização, pois o cache não foi alterado). Se, na
> implementação, optar por optimistic também no caso `isLost`, garantir rollback no cancelamento.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros de tipo (tipos do dnd-kit incluídos).
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] Arrastar um card dentro da mesma coluna reordena e persiste (recarregar mantém a ordem).
- [ ] Arrastar entre colunas move o card; a coluna de origem fecha o buraco; `stageMovedAt` reinicia (indicador "esfriando" some).
- [ ] Soltar num estágio "Perdeu" abre o diálogo; sem motivo não persiste; com motivo grava e o card fica na coluna "Perdeu".
- [ ] Clicar (sem arrastar) num card ainda abre a edição (constraint de 8px não rouba o clique).
- [ ] Em erro de rede (simular offline), o card volta à posição original e aparece toast pt-BR.
- [ ] Card parado > 7 dias exibe o badge "Esfriando" (só em estágios não terminais).

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 5.

---

## Phase 5: Frontend — Configuração de estágios + aba "Oportunidades" no cliente

### Goal
Entregar a tela enxuta de configuração de estágios (criar/renomear/reordenar/excluir, marcar
`isWon`/`isLost`) e a aba "Oportunidades" na ficha do cliente.

### Changes

#### Configuração de estágios

**Create**: `apps/web/src/features/pipeline/StageConfigDialog.tsx`
Diálogo aberto pelo botão "Configurar estágios" do board. Lista os estágios ordenados com:
renomear inline (Input + salvar no blur), switches/checkboxes `isWon`/`isLost`, botões ↑/↓ que
disparam `useReorderStages` com a nova ordem de ids, adicionar novo (Input + `useCreateStage`),
excluir com `ConfirmDialog` (trata 409 com toast pt-BR via `extractApiMessage`).
```tsx
// Estrutura (resumo — seguir padrões de dialog/field/button já usados):
// - useStages() para a lista
// - const reorder = useReorderStages(); const create = useCreateStage();
//   const update = useUpdateStage(); const remove = useDeleteStage();
// - mover ↑/↓: const ids = stages.map(s=>s.id); trocar índices; reorder.mutate(ids)
// - excluir: try { await remove.mutateAsync(id); toast.success('Estágio excluído.') }
//            catch (e) { toast.error(extractApiMessage(e, 'Falha ao excluir o estágio.')) }
//            (o backend retorna 409 pt-BR quando o estágio tem oportunidades)
// - marcar isWon/isLost: update.mutate({ id, body: { isWon } })
```
Reusar o helper `extractApiMessage` — extrair para `@/features/pipeline/lib/api-error.ts` e
importar tanto aqui quanto no `DealFormDialog` (evita duplicar a função).

**Create**: `apps/web/src/features/pipeline/lib/api-error.ts`
```ts
import { isAxiosError } from 'axios';

export function extractApiMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(msg)) return msg[0] ?? fallback;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}
```
(E atualizar `DealFormDialog.tsx` para importar daqui em vez da cópia local.)

**Modify**: `apps/web/src/features/pipeline/PipelineBoardPage.tsx`
Adicionar botão "Configurar estágios" (variant outline) no cabeçalho que abre o `StageConfigDialog`.
```tsx
import { Settings2 } from 'lucide-react';
import { StageConfigDialog } from './StageConfigDialog';
// estado: const [configOpen, setConfigOpen] = useState(false);
// no header, antes de "Nova oportunidade":
// <Button variant="outline" onClick={() => setConfigOpen(true)}><Settings2 data-icon="inline-start" />Configurar estágios</Button>
// no fim: <StageConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
```

#### Aba "Oportunidades" na ficha do cliente

**Create**: `apps/web/src/features/clientes/tabs/OportunidadesTab.tsx`
Usa `useDealsByClient(clientId)` da feature pipeline (hook público) e `DealFormDialog` com
`defaultClientId`. Lista os deals do cliente (título, estágio, valor, tipo). Botão "Nova
oportunidade".
```tsx
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { KanbanSquare } from 'lucide-react';
import { translateServiceType } from '@/lib/labels';
import { useDealsByClient, useStages } from '@/features/pipeline/api/hooks';
import { DealFormDialog } from '@/features/pipeline/DealFormDialog';
import { formatDealAmount } from '@/features/pipeline/lib/deal-format';
import type { Client } from '../api/types';

export default function OportunidadesTab() {
  const client = useOutletContext<Client>();
  const { data, isLoading } = useDealsByClient(client.id);
  const { data: stages } = useStages();
  const [formOpen, setFormOpen] = useState(false);

  const stageName = (id: string) => stages?.find((s) => s.id === id)?.name ?? '—';
  const deals = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Oportunidades</h2>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Nova oportunidade
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : deals.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {deals.map((deal) => (
            <li
              key={deal.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{deal.title}</span>
                <span className="text-xs text-muted-foreground">
                  {stageName(deal.stageId)} · {translateServiceType(deal.serviceType)}
                </span>
              </div>
              <span className="text-sm tabular-nums">{formatDealAmount(deal.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KanbanSquare />
            </EmptyMedia>
            <EmptyTitle>Nenhuma oportunidade</EmptyTitle>
            <EmptyDescription>Crie a primeira oportunidade deste cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultClientId={client.id}
      />
    </div>
  );
}
```

**Modify**: `apps/web/src/features/clientes/ClienteDetalheLayout.tsx`
Adicionar a aba no array `tabs` (após "Timeline"):
```tsx
{ label: 'Oportunidades', to: `/clientes/${id}/oportunidades` },
```

**Modify**: `apps/web/src/routes/router.tsx`
Adicionar import e a rota filha em `/clientes/:id`:
```tsx
import OportunidadesTab from '@/features/clientes/tabs/OportunidadesTab';
// dentro de children de '/clientes/:id', junto às demais abas:
{ path: 'oportunidades', element: <OportunidadesTab /> },
```

#### Documentação de progresso

**Modify**: `ROADMAP.md` — marcar os 5 itens da Fase 2 como concluídos (mesmo commit da Fase 5).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] "Configurar estágios" abre o diálogo; criar/renomear/reordenar/excluir refletem no board após fechar.
- [ ] Marcar um estágio como `isWon`/`isLost` altera o comportamento (mover para ele passa a exigir motivo quando `isLost`).
- [ ] Tentar excluir um estágio com oportunidades mostra o toast pt-BR de 409.
- [ ] A aba "Oportunidades" na ficha do cliente lista só os deals daquele cliente; "Nova oportunidade" cria já vinculada ao cliente (sem seletor).
- [ ] Criar um deal na aba do cliente faz ele aparecer também no board global.

**⏸ PAUSE**: Confirmação final e atualização do ROADMAP.

---

## Testing Strategy

### Unit Tests
- `pipeline-stages.service.spec.ts`: criação no fim da ordem, conflito de nome, `NotFound`,
  guard de exclusão (`countDeals > 0` → `Conflict`).
- `deals.service.spec.ts`: criação valida posse + `position = max+1` + estágio padrão; `move` para
  `isLost` sem motivo → `UnprocessableEntity`; `move` mudando de estágio grava `stageMovedAt` e
  limpa `lostReason`; `findOne`/`loadOwned` inexistente → `NotFound`.
- Frontend: sem framework de teste configurado no `apps/web` — cobertura via `tsc` + verificação
  manual. (Não introduzir framework de teste nesta fase.)

### Integration Tests
- Fluxo backend manual (curl/HTTP) por endpoint conforme "Manual Verification" de cada fase.
- Fluxo E2E manual no navegador: criar deal → arrastar entre colunas → soltar em "Perdeu" com
  motivo → reordenar → configurar estágios → aba do cliente.
- Invariante crítica a validar após vários moves: cada coluna tem `position` 0-based contígua.

### Migration & Rollback
- **Sem migration nova.** O schema já contém `PipelineStage`/`Deal`/índice. Basta o banco estar
  migrado e semeado (`docker compose up -d`; `pnpm --filter api exec prisma migrate deploy` já
  aplicado; seed via `pnpm --filter api db:reset` em dev cria os 7 estágios).
- Rollback: reverter os commits das fases; nenhuma alteração de dados destrutiva é introduzida
  (deals/estágios criados podem ser removidos pela própria UI/endpoints).

## Environment Considerations
- **CI/CD**: sem novos passos; `build`/`lint`/`test` já cobrem. Nova dependência dnd-kit entra no
  `pnpm-lock.yaml` (commitar o lockfile).
- **Migrations**: nenhuma.
- **Config/Secrets**: nenhum novo env var.
- **Multi-environment**: estágios são globais (seed). Em ambientes já semeados, os 7 estágios
  existem; ambientes novos precisam do seed. Nenhuma diferença de comportamento entre dev/prod.

## Dependencies & Risks
- **dnd-kit no React 19**: peer dep `react >=16.8` — funciona sem warning (validado no PRD). Usar o
  stack clássico (`@dnd-kit/core` + `sortable` + `utilities`), **não** `@dnd-kit/react` 0.x.
- **Ordenação de rotas Nest**: `@Patch('reorder')` antes de `@Patch(':id')`; `@Get('board')` antes
  de `@Get(':id')` — caso contrário a rota estática é capturada pela paramétrica.
- **`amount` Decimal → string**: chega como string no JSON; sempre `Number(...)` antes de formatar
  e enviar número no create/update.
- **API do `Select` (`@base-ui`/shadcn)**: confirmar suporte ao filtro inline no `DealFormDialog`;
  se não suportar, cair para lista simples (a busca por debounce já resolve).
- **Race na reindexação**: MVP single-user; a reindexação em `$transaction` no backend é a fonte de
  verdade. O optimistic update no client é reconciliado por `invalidateQueries` no `onSettled`.
- **Isolamento entre features**: a aba do cliente importa hooks/dialog **públicos** de `pipeline`
  (não o interior). O seletor de cliente no `DealFormDialog` usa uma chamada HTTP própria
  (`clients-lookup.api.ts`), sem importar a feature `clientes`.

## References
- PRD: `specs/research/2026-07-21-fase-2-pipeline.md`
- Fase 1 (padrões): `specs/plans/2026-07-21-fase-1-clientes.md`
- Regras: `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `CLAUDE.md` (raiz)
- Endpoints (DoD): `apps/api/ENDPOINTS.md`
- Escopo/roadmap: `SPEC.md §3.2, §4, §5`, `ROADMAP.md §Fase 2`
- dnd-kit: https://dndkit.com/react/guides/multiple-sortable-lists/ ·
  https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
