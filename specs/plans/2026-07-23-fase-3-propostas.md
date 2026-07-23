---
date: 2026-07-23T00:00:00-03:00
author: claude
source_prd: specs/research/2026-07-23-fase-3-propostas.md
git_commit: c5b8e35aa22f974806746f8c287fe80e8b704b14
branch: main
status: implemented
tags: [spec, proposals, proposal-items, versioning, status-cycle, cron, decimal]
---

# Spec: Fase 3 — Propostas

## Overview

Implementar o módulo de **Propostas**: documento comercial vinculado a um cliente (e opcionalmente a
uma oportunidade), com **itens** (descrição/quantidade/valor unitário), **total calculado no backend**
(em centavos inteiros, nunca float), **ciclo de status** validado (`422` em transição inválida),
**versionamento** (`v2`, `v3`…, só a mais recente editável) e **expiração automática** por cron diário.

A persistência já está pronta (`Proposal`, `ProposalItem`, enum `ProposalStatus`, self-relation
`parent`/`versions`, `@@index([clientId, status])` migrados na `init`) — **nenhuma migration** é
necessária. O trabalho é a camada de aplicação: backend NestJS espelhando **exatamente** o módulo
`pipeline` (o mais recente e consolidado) e frontend React espelhando `clientes`/`pipeline`.

A estratégia é entregar em 6 fases: três de backend (CRUD+itens+total; máquina de estados+ações;
cron de expiração) e três de frontend (dados+listagem; formulário+editor de itens; ficha+aba do
cliente). Cada fase é independentemente verificável.

## Current State

- **Persistência**: `Proposal`/`ProposalItem`/`ProposalStatus` completos em
  [schema.prisma:101-140](../../apps/api/prisma/schema.prisma#L101-L140) e
  [schema.prisma:266-273](../../apps/api/prisma/schema.prisma#L266-L273). `Decimal(12,2)` em
  `discount`/`total`/`unitPrice`, `Decimal(10,2)` em `quantity`.
- **Backend**: não existe `src/modules/proposals/`. Módulos atuais: `auth`, `users`, `clients`,
  `contacts`, `activities`, `pipeline`. `@nestjs/schedule` **não instalado**; nenhum `ScheduleModule`.
  `PipelineModule` **exporta `DealsService`** (pipeline.module.ts:24).
- **Frontend**: `translateProposalStatus`/`PROPOSAL_STATUS_LABELS` já existem
  ([labels.ts:44-52](../../apps/web/src/lib/labels.ts#L44-L52)); item de nav Propostas já existe
  ([nav.ts:32](../../apps/web/src/app/nav.ts#L32)); sub-aba `/clientes/:id/propostas` e rotas
  `/propostas`, `/propostas/:id` renderizam placeholders
  ([router.tsx:33,39-40](../../apps/web/src/routes/router.tsx#L33-L40)).

## Desired End State

Ao fim das 6 fases:

- **API** expõe `GET/POST /proposals`, `GET/PATCH/DELETE /proposals/:id`, `POST /proposals/:id/send`,
  `/accept`, `/reject`, `/new-version` — todas Bearer, com posse derivada de `client.ownerId`, mensagens
  pt-BR, e documentadas em `ENDPOINTS.md`.
- `total` é sempre recalculado no backend a partir dos itens + desconto (centavos inteiros); qualquer
  `total` do cliente é ignorado.
- Transições de status inválidas retornam `422`. `EXPIRED` só é atingido por cron/derivação, nunca por
  ação manual. `PATCH`/`DELETE` só operam em `DRAFT`.
- Aceitar uma proposta seta `ACCEPTED`/`decidedAt` e, se houver `dealId`, move o deal para o estágio
  `isWon` via `DealsService`.
- Um job diário (03:00) marca `SENT`/`NEGOTIATING` vencidas como `EXPIRED`.
- **Frontend** tem `features/propostas/` com listagem (`/propostas`), ficha (`/propostas/:id`) e aba na
  ficha do cliente (`/clientes/:id/propostas`), incluindo criação/edição com editor de itens e total ao
  vivo, ações de status e histórico de versões — tudo pt-BR.

## What We're NOT Doing

- **Migration de schema** — a decisão foi gerar o número via `max+1` por ano em transação; não há
  coluna/sequence nova, portanto **nenhuma migration** (nem `@@index([parentId])`).
- **Criar Projeto/Contrato no aceite** — módulos das fases 4/5 não existem; o aceite apenas move o deal
  para `isWon`. Sem CTA placeholder.
- **Editar proposta em `SENT`/`NEGOTIATING` in-place** — a edição de conteúdo só é permitida em `DRAFT`;
  para propostas já enviadas a UI oferece "nova versão".
- **`EXPIRED` por ação manual** — só via cron/derivação.
- **PDF / envio por e-mail da proposta** — fora do escopo desta fase.
- **Optimistic updates no frontend** — não há drag&drop; invalidação simples basta.

---

## Phase 1: Backend — CRUD, itens, total e número

### Goal
Criar o módulo `proposals` com CRUD completo (create/list/findOne/update/delete de rascunho), itens via
nested write, cálculo de `total` em centavos, gerador `PROP-AAAA-NNNN` e posse derivada — espelhando o
módulo `pipeline`.

### Changes

#### Domínio (contrato do repositório)

**Create**: `apps/api/src/modules/proposals/domain/proposal.repository.ts`
Interface + token `Symbol` + tipos, espelhando `deal.repository.ts`. `ProposalWithItems` inclui itens
(ordenados) e dados mínimos do cliente. Note que **posse deriva de `client.ownerId`** — o filtro de
lista recebe `ownerId` e a infra filtra por `client: { ownerId }`.
```ts
import type { Prisma } from '@prisma/client';

export const PROPOSAL_REPOSITORY = Symbol('PROPOSAL_REPOSITORY');

/** Proposta + itens (ordenados) + dados mínimos do cliente para listagem/ficha. */
export type ProposalWithItems = Prisma.ProposalGetPayload<{
  include: {
    items: true;
    client: { select: { id: true; name: true } };
  };
}>;

export interface ProposalListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  status?: import('@prisma/client').ProposalStatus;
  skip: number;
  take: number;
}

export interface ProposalRepository {
  create(data: Prisma.ProposalUncheckedCreateInput): Promise<ProposalWithItems>;
  findById(id: string): Promise<ProposalWithItems | null>;
  findManyAndCount(
    filter: ProposalListFilter,
  ): Promise<{ data: ProposalWithItems[]; total: number }>;
  /** Substitui os itens (deleteMany + create) e aplica o patch numa transação. */
  updateWithItems(
    id: string,
    data: Prisma.ProposalUpdateInput,
    items: Prisma.ProposalItemUncheckedCreateWithoutProposalInput[],
  ): Promise<ProposalWithItems>;
  /** Patch de campos escalares (status/datas) sem tocar nos itens. */
  update(id: string, data: Prisma.ProposalUpdateInput): Promise<ProposalWithItems>;
  delete(id: string): Promise<void>;
  /** Maior sequencial (sufixo NNNN) entre as propostas do ano informado; 0 se não houver. */
  maxSequenceForYear(year: number): Promise<number>;
  /** Todas as versões de uma cadeia (mesmo `number`), ordenadas por `version`. */
  findVersionsByNumber(number: string): Promise<ProposalWithItems[]>;
}
```

#### Infra (repositório Prisma)

**Create**: `apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts`
Espelha `prisma-deal.repository.ts`: `PrismaService` só aqui, `include` const `as const`, `$transaction`
para list+count e para substituir itens. `maxSequenceForYear` filtra por `number` começando em
`PROP-<ano>-` e extrai o maior sufixo.
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ProposalListFilter,
  ProposalRepository,
} from '../domain/proposal.repository';

const withItems = {
  items: { orderBy: { order: 'asc' } },
  client: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PrismaProposalRepository implements ProposalRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ProposalUncheckedCreateInput) {
    return this.prisma.proposal.create({ data, include: withItems });
  }

  findById(id: string) {
    return this.prisma.proposal.findUnique({ where: { id }, include: withItems });
  }

  async findManyAndCount(filter: ProposalListFilter) {
    const where: Prisma.ProposalWhereInput = {
      client: { ownerId: filter.ownerId },
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.proposal.findMany({
        where,
        include: withItems,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.proposal.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, data: Prisma.ProposalUpdateInput) {
    return this.prisma.proposal.update({ where: { id }, data, include: withItems });
  }

  async updateWithItems(
    id: string,
    data: Prisma.ProposalUpdateInput,
    items: Prisma.ProposalItemUncheckedCreateWithoutProposalInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      await tx.proposal.update({
        where: { id },
        data: {
          ...data,
          items: { create: items.map((it) => ({ ...it })) },
        },
      });
      return tx.proposal.findUniqueOrThrow({ where: { id }, include: withItems });
    });
  }

  async delete(id: string) {
    // itens primeiro (FK sem cascade); ver Migration & Rollback.
    await this.prisma.$transaction([
      this.prisma.proposalItem.deleteMany({ where: { proposalId: id } }),
      this.prisma.proposal.delete({ where: { id } }),
    ]);
  }

  async maxSequenceForYear(year: number): Promise<number> {
    // Ordena desc por `number`; como o sufixo é zero-padded (0001..9999) e o
    // prefixo é fixo por ano, a ordenação lexical coincide com a numérica.
    const last = await this.prisma.proposal.findFirst({
      where: { number: { startsWith: `PROP-${year}-` } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    if (!last) return 0;
    const suffix = last.number.split('-')[2];
    return Number(suffix) || 0;
  }

  findVersionsByNumber(number: string) {
    return this.prisma.proposal.findMany({
      where: { number },
      include: withItems,
      orderBy: { version: 'asc' },
    });
  }
}
```

#### Aplicação (service) — cálculo de total e número

**Create**: `apps/api/src/modules/proposals/application/money.ts`
Helper de aritmética monetária em centavos, isolado para teste unitário. Sem lib externa.
```ts
/** Converte reais (number, 2 casas) para centavos inteiros. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Centavos inteiros → reais (number, 2 casas) para gravar no Decimal. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Calcula o total (em reais, 2 casas) a partir dos itens e desconto.
 * Cada linha é arredondada isolada (Σ round(qty×unit)); desconto subtraído
 * ao fim; nunca negativo. Tudo em centavos para evitar erro de float.
 */
export function computeTotal(
  items: { quantity: number; unitPrice: number }[],
  discount?: number,
): number {
  const gross = items.reduce(
    (sum, it) => sum + toCents(it.quantity * it.unitPrice),
    0,
  );
  const net = Math.max(0, gross - toCents(discount ?? 0));
  return fromCents(net);
}
```

**Create**: `apps/api/src/modules/proposals/application/proposals.service.ts`
Espelha `deals.service.ts`. Injeta `PROPOSAL_REPOSITORY`, `ClientsService` (posse) e `DealsService`
(validar `dealId` no create; usado no accept na Fase 2). `loadOwned` deriva posse via
`this.clients.findOne(ownerId, proposal.clientId)`. **Fase 1 cobre**: `list`, `findOne`, `create`,
`update`, `delete`. As ações de status entram na Fase 2 (mesmo arquivo).
```ts
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PROPOSAL_REPOSITORY,
  type ProposalRepository,
  type ProposalWithItems,
} from '../domain/proposal.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { DealsService } from '../../pipeline/application/deals.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import { computeTotal } from './money';
import type { CreateProposalDto } from '../api/dto/create-proposal.dto';
import type { UpdateProposalDto } from '../api/dto/update-proposal.dto';
import type { ListProposalsQueryDto } from '../api/dto/list-proposals-query.dto';

@Injectable()
export class ProposalsService {
  constructor(
    @Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository,
    private readonly clients: ClientsService,
    private readonly deals: DealsService,
  ) {}

  async list(ownerId: string, query: ListProposalsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      status: query.status,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async findOne(ownerId: string, id: string): Promise<ProposalWithItems> {
    return this.loadOwned(ownerId, id);
  }

  /** Versões da cadeia (mesmo `number`) da proposta informada. */
  async versions(ownerId: string, id: string): Promise<ProposalWithItems[]> {
    const proposal = await this.loadOwned(ownerId, id);
    return this.repo.findVersionsByNumber(proposal.number);
  }

  async create(
    ownerId: string,
    dto: CreateProposalDto,
  ): Promise<ProposalWithItems> {
    await this.clients.findOne(ownerId, dto.clientId); // valida posse do cliente
    if (dto.dealId) await this.deals.findOne(ownerId, dto.dealId); // valida posse do deal

    const number = await this.generateNumber();
    const total = computeTotal(dto.items, dto.discount);

    return this.repo.create({
      number,
      version: 1,
      clientId: dto.clientId,
      dealId: dto.dealId ?? null,
      serviceType: dto.serviceType,
      status: 'DRAFT',
      scope: dto.scope ?? null,
      paymentTerms: dto.paymentTerms ?? null,
      deliveryTime: dto.deliveryTime ?? null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      discount: dto.discount ?? null,
      total,
      items: {
        create: dto.items.map((it, order) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          order,
        })),
      },
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateProposalDto,
  ): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    if (proposal.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        'Apenas rascunhos podem ser editados. Crie uma nova versão.',
      );
    }
    // Itens e total só recalculados se `items` vier no payload; senão, mantém.
    if (dto.items) {
      const total = computeTotal(dto.items, dto.discount);
      return this.repo.updateWithItems(
        id,
        {
          ...(dto.serviceType !== undefined ? { serviceType: dto.serviceType } : {}),
          ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
          ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms } : {}),
          ...(dto.deliveryTime !== undefined ? { deliveryTime: dto.deliveryTime } : {}),
          ...(dto.validUntil !== undefined
            ? { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }
            : {}),
          discount: dto.discount ?? null,
          total,
        },
        dto.items.map((it, order) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          order,
        })),
      );
    }
    return this.repo.update(id, {
      ...(dto.serviceType !== undefined ? { serviceType: dto.serviceType } : {}),
      ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
      ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms } : {}),
      ...(dto.deliveryTime !== undefined ? { deliveryTime: dto.deliveryTime } : {}),
      ...(dto.validUntil !== undefined
        ? { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }
        : {}),
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const proposal = await this.loadOwned(ownerId, id);
    if (proposal.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        'Apenas rascunhos podem ser excluídos.',
      );
    }
    await this.repo.delete(id);
  }

  /** Gera PROP-AAAA-NNNN: max sequencial do ano corrente + 1, zero-padded a 4 dígitos. */
  private async generateNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const next = (await this.repo.maxSequenceForYear(year)) + 1;
    return `PROP-${year}-${String(next).padStart(4, '0')}`;
  }

  /** Carrega a proposta garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<ProposalWithItems> {
    const proposal = await this.repo.findById(id);
    if (!proposal) throw new NotFoundException('Proposta não encontrada.');
    await this.clients.findOne(ownerId, proposal.clientId); // 404 se não for do dono
    return proposal;
  }
}
```

**Create**: `apps/api/src/modules/proposals/application/money.spec.ts`
Cobre o núcleo do cálculo (o ponto sem precedente no projeto).
```ts
import { computeTotal } from './money';

describe('computeTotal', () => {
  it('soma itens sem erro de float (0.1 + 0.2)', () => {
    expect(computeTotal([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }])).toBe(0.3);
  });
  it('multiplica quantidade × valor unitário', () => {
    expect(computeTotal([{ quantity: 3, unitPrice: 99.9 }])).toBe(299.7);
  });
  it('subtrai o desconto', () => {
    expect(computeTotal([{ quantity: 1, unitPrice: 1000 }], 150)).toBe(850);
  });
  it('nunca fica negativo', () => {
    expect(computeTotal([{ quantity: 1, unitPrice: 100 }], 999)).toBe(0);
  });
});
```

**Create**: `apps/api/src/modules/proposals/application/proposals.service.spec.ts`
Mock manual (sem `TestingModule`), como `deals.service.spec.ts`. Cobre Fase 1: número gerado,
posse validada, `PATCH`/`DELETE` bloqueados fora de `DRAFT`. Estende-se na Fase 2.
```ts
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import type { ProposalRepository } from '../domain/proposal.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { DealsService } from '../../pipeline/application/deals.service';

describe('ProposalsService', () => {
  let repo: jest.Mocked<ProposalRepository>;
  let clients: { findOne: jest.Mock };
  let deals: { findOne: jest.Mock; move: jest.Mock; board: jest.Mock };
  let service: ProposalsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      updateWithItems: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxSequenceForYear: jest.fn(),
      findVersionsByNumber: jest.fn(),
    } as unknown as jest.Mocked<ProposalRepository>;
    clients = { findOne: jest.fn() };
    deals = { findOne: jest.fn(), move: jest.fn(), board: jest.fn() };
    service = new ProposalsService(
      repo,
      clients as unknown as ClientsService,
      deals as unknown as DealsService,
    );
  });

  it('gera número sequencial do ano e valida posse ao criar', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.maxSequenceForYear.mockResolvedValue(41);
    repo.create.mockResolvedValue({ id: 'p1' } as never);
    await service.create('owner', {
      clientId: 'cli',
      serviceType: 'SOFTWARE',
      items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner', 'cli');
    const year = new Date().getFullYear();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ number: `PROP-${year}-0042`, total: 100, status: 'DRAFT' }),
    );
  });

  it('lança NotFoundException ao carregar proposta inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bloqueia edição fora de DRAFT', async () => {
    repo.findById.mockResolvedValue({ id: 'p1', clientId: 'cli', status: 'SENT' } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(
      service.update('owner', 'p1', { scope: 'x' } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('bloqueia exclusão fora de DRAFT', async () => {
    repo.findById.mockResolvedValue({ id: 'p1', clientId: 'cli', status: 'ACCEPTED' } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.delete('owner', 'p1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
```

#### API (DTOs + controller)

**Create**: `apps/api/src/modules/proposals/api/dto/proposal-item.dto.ts`
```ts
import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class ProposalItemDto {
  @IsString({ message: 'A descrição do item é obrigatória.' })
  @MinLength(1, { message: 'A descrição do item é obrigatória.' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Quantidade inválida.' })
  @Min(0, { message: 'A quantidade não pode ser negativa.' })
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor unitário inválido.' })
  @Min(0, { message: 'O valor unitário não pode ser negativo.' })
  unitPrice: number;
}
```

**Create**: `apps/api/src/modules/proposals/api/dto/create-proposal.dto.ts`
```ts
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ServiceType } from '@prisma/client';
import { ProposalItemDto } from './proposal-item.dto';

export class CreateProposalDto {
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Oportunidade inválida.' })
  dealId?: string;

  @IsEnum(ServiceType, { message: 'Tipo de serviço inválido.' })
  serviceType: ServiceType;

  @IsArray()
  @ArrayNotEmpty({ message: 'Informe ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items: ProposalItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Desconto inválido.' })
  @Min(0, { message: 'O desconto não pode ser negativo.' })
  discount?: number;

  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() deliveryTime?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de validade inválida.' })
  validUntil?: string;
}
```

**Create**: `apps/api/src/modules/proposals/api/dto/update-proposal.dto.ts`
`clientId`/`dealId` não são editáveis (proposta não muda de dono nem de oportunidade via PATCH).
```ts
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProposalDto } from './create-proposal.dto';

export class UpdateProposalDto extends PartialType(
  OmitType(CreateProposalDto, ['clientId', 'dealId'] as const),
) {}
```

**Create**: `apps/api/src/modules/proposals/api/dto/list-proposals-query.dto.ts`
```ts
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProposalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListProposalsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID('4', { message: 'Cliente inválido.' }) clientId?: string;
  @IsOptional()
  @IsEnum(ProposalStatus, { message: 'Status inválido.' })
  status?: ProposalStatus;
}
```

**Create**: `apps/api/src/modules/proposals/api/proposals.controller.ts`
Fase 1 registra as rotas CRUD + `versions`. As rotas de ação (`send`/`accept`/`reject`/`new-version`)
entram na Fase 2. **Rota estática (`versions` está sob `:id`, então não conflita)**; manter ordem:
coletivas → `create` → `:id` (get/patch/delete) → sub-rotas de `:id`.
```ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ProposalsService } from '../application/proposals.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListProposalsQueryDto,
  ) {
    return this.proposals.list(ownerId, query);
  }

  @Post() create(
    @CurrentUserId() ownerId: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.proposals.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.findOne(ownerId, id);
  }

  @Get(':id/versions') versions(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.versions(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.proposals.update(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.delete(ownerId, id);
  }
}
```

#### Módulo + registro

**Create**: `apps/api/src/modules/proposals/proposals.module.ts`
```ts
import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ProposalsController } from './api/proposals.controller';
import { ProposalsService } from './application/proposals.service';
import { PROPOSAL_REPOSITORY } from './domain/proposal.repository';
import { PrismaProposalRepository } from './infra/prisma-proposal.repository';

@Module({
  imports: [ClientsModule, PipelineModule],
  controllers: [ProposalsController],
  providers: [
    ProposalsService,
    { provide: PROPOSAL_REPOSITORY, useClass: PrismaProposalRepository },
  ],
  exports: [ProposalsService],
})
export class ProposalsModule {}
```

**Modify**: `apps/api/src/app.module.ts`
Adicionar `ProposalsModule` aos imports (o `ScheduleModule` entra na Fase 3).
```ts
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
// ...
  imports: [
    // ...
    PipelineModule,
    ProposalsModule,
  ],
```

#### Documentação (DoD)

**Modify**: `apps/api/ENDPOINTS.md`
Adicionar seção `## Proposals` ao final, no formato fixo. Fase 1 documenta `GET/POST /proposals`,
`GET /proposals/:id`, `GET /proposals/:id/versions`, `PATCH /proposals/:id`, `DELETE /proposals/:id`
(as ações de status entram na Fase 2). Exemplo do primeiro bloco:
```markdown
## Proposals

### GET /proposals
- **Propósito:** Listar propostas do usuário autenticado (via cliente), com filtros e paginação.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page?`, `limit?`, `clientId?`, `status?`)
- **Resposta:** `200 { data: Proposal[], meta: { total, page, limit } }` (`Proposal` inclui `items[]` e `client: { id, name }`).
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.list`

### POST /proposals
- **Propósito:** Criar uma proposta (status `DRAFT`, `version 1`); gera `number` PROP-AAAA-NNNN e calcula `total` no backend a partir dos itens e desconto.
- **Auth:** Bearer (access token).
- **Body:** `{ clientId: uuid, serviceType: ServiceType, items: [{ description, quantity, unitPrice }] (≥1), dealId?: uuid, discount?: number, scope?, paymentTerms?, deliveryTime?, validUntil?: ISO date }`
- **Resposta:** `201 Proposal` (com `items[]`, `total`, `number`).
- **Erros:** `400` (validação / `Informe ao menos um item.`), `404 Cliente não encontrado.` / `Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.create`

### DELETE /proposals/:id
- **Propósito:** Excluir uma proposta **apenas em rascunho** (`DRAFT`), removendo também seus itens.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Proposta não encontrada.`, `422 Apenas rascunhos podem ser excluídos.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.remove`
```
(Documentar também `GET /proposals/:id`, `GET /proposals/:id/versions` e `PATCH /proposals/:id` no
mesmo padrão — `PATCH` cita `422 Apenas rascunhos podem ser editados. Crie uma nova versão.`)

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila sem erros de tipo (inclui o novo módulo).
- [x] `pnpm --filter api test` — `money.spec.ts` e `proposals.service.spec.ts` passam.
- [x] `pnpm --filter api lint` — sem erros.

#### Manual Verification
- [ ] `POST /proposals` com 2 itens (`2×99,90` e `1×100`) e `discount 50` retorna `total` `249.80` e `number` `PROP-2026-0001`.
- [ ] Criar segunda proposta gera `PROP-2026-0002`.
- [ ] `POST /proposals` com `clientId` de outro dono → `404`.
- [ ] `POST /proposals` sem itens → `400 Informe ao menos um item.`
- [ ] `PATCH`/`DELETE` numa proposta não-`DRAFT` → `422`.
- [ ] `GET /proposals?clientId=…&status=DRAFT` filtra corretamente e pagina.

**⏸ PAUSE**: Após a verificação automatizada, parar para confirmação manual antes da Fase 2.

---

## Phase 2: Backend — máquina de estados e ações

### Goal
Adicionar as transições de status validadas (`422` em transição inválida) e as ações
`send`/`accept`/`reject`/`new-version`; o aceite move o deal vinculado para `isWon`.

### Changes

#### Aplicação (service)

**Modify**: `apps/api/src/modules/proposals/application/proposals.service.ts`
Adicionar o mapa de transições e os métodos de ação. `EXPIRED` **não** é alvo de nenhuma transição
manual (só cron/derivação). O aceite move o deal via `DealsService`.
```ts
import type { ProposalStatus } from '@prisma/client';

// Transições manuais permitidas (EXPIRED só via cron; ACCEPTED/REJECTED/EXPIRED terminais).
const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['SENT'],
  SENT: ['NEGOTIATING', 'ACCEPTED', 'REJECTED'],
  NEGOTIATING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

// dentro da classe ProposalsService:

  async send(ownerId: string, id: string): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    this.assertTransition(proposal.status, 'SENT');
    return this.repo.update(id, { status: 'SENT', sentAt: new Date() });
  }

  async reject(ownerId: string, id: string): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    this.assertTransition(proposal.status, 'REJECTED');
    return this.repo.update(id, { status: 'REJECTED', decidedAt: new Date() });
  }

  async accept(ownerId: string, id: string): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    this.assertTransition(proposal.status, 'ACCEPTED');
    const accepted = await this.repo.update(id, {
      status: 'ACCEPTED',
      decidedAt: new Date(),
    });
    // Move o deal vinculado para o estágio "Ganhou" (isWon), se houver.
    if (proposal.dealId) await this.moveDealToWon(ownerId, proposal.dealId);
    return accepted;
  }

  /** Clona a proposta como nova versão (mesmo `number`, `version+1`, DRAFT), copiando itens/campos. */
  async newVersion(ownerId: string, id: string): Promise<ProposalWithItems> {
    const source = await this.loadOwned(ownerId, id);
    return this.repo.create({
      number: source.number,
      version: source.version + 1,
      parentId: source.id,
      clientId: source.clientId,
      dealId: source.dealId,
      serviceType: source.serviceType,
      status: 'DRAFT',
      scope: source.scope,
      paymentTerms: source.paymentTerms,
      deliveryTime: source.deliveryTime,
      validUntil: source.validUntil,
      discount: source.discount,
      total: source.total,
      items: {
        create: source.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          order: it.order,
        })),
      },
    });
  }

  private assertTransition(from: ProposalStatus, to: ProposalStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new UnprocessableEntityException('Transição de status inválida.');
    }
  }

  /** Encontra o estágio isWon e move o deal via DealsService (posse já validada). */
  private async moveDealToWon(ownerId: string, dealId: string): Promise<void> {
    const board = await this.deals.board(ownerId);
    const deal = board.find((d) => d.id === dealId);
    const wonStage = /* estágio isWon */ await this.findWonStage();
    if (deal && wonStage && deal.stageId !== wonStage.id) {
      await this.deals.move(ownerId, dealId, { stageId: wonStage.id, position: 0 });
    }
  }
```

> **Decisão de implementação para `moveDealToWon`**: `DealsService` hoje **não** expõe um lookup de
> estágio `isWon`. Duas opções — escolher no /code, preferindo a primeira:
> 1. **Adicionar `PipelineStagesService.wonStage()`** (retorna o primeiro `isWon` ou `null`) e injetar
>    `PipelineStagesService` no `ProposalsService` (o `PipelineModule` já exporta `PipelineStagesService`).
>    `await this.deals.move(ownerId, dealId, { stageId: won.id, position: 0 })`.
> 2. Adicionar um método `DealsService.markWon(ownerId, dealId)` que encapsula o lookup + move.
>
> A **opção 1** é a mais aderente ao padrão (services finos e reuso do `move` existente). Ajustar o
> construtor do `ProposalsService` para `(repo, clients, deals, stages)` e o `.spec.ts` conforme.

**Modify**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts` (se opção 1)
```ts
/** Primeiro estágio marcado como "Ganhou" (isWon), ou null se não houver. */
async wonStage(): Promise<PipelineStage | null> {
  const stages = await this.repo.findAllOrdered();
  return stages.find((s) => s.isWon) ?? null;
}
```

**Modify**: `apps/api/src/modules/proposals/application/proposals.service.spec.ts`
Adicionar casos: `send` de `DRAFT` seta `sentAt`; `accept` de `DRAFT` → `422` (precisa passar por
`SENT`); `accept` de `SENT` seta `decidedAt` e chama `deals.move` quando há `dealId`; `newVersion`
cria `version+1` com mesmo `number` e `parentId`.
```ts
it('recusa aceitar direto de DRAFT (transição inválida)', async () => {
  repo.findById.mockResolvedValue({ id: 'p1', clientId: 'cli', status: 'DRAFT' } as never);
  clients.findOne.mockResolvedValue({ id: 'cli' });
  await expect(service.accept('owner', 'p1')).rejects.toBeInstanceOf(UnprocessableEntityException);
});

it('aceita de SENT, seta decidedAt e move o deal para Ganhou', async () => {
  repo.findById.mockResolvedValue({ id: 'p1', clientId: 'cli', status: 'SENT', dealId: 'd1' } as never);
  clients.findOne.mockResolvedValue({ id: 'cli' });
  repo.update.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' } as never);
  stages.wonStage.mockResolvedValue({ id: 'won', isWon: true });
  deals.board.mockResolvedValue([{ id: 'd1', stageId: 's1' }]);
  await service.accept('owner', 'p1');
  expect(repo.update).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'ACCEPTED' }));
  expect(deals.move).toHaveBeenCalledWith('owner', 'd1', { stageId: 'won', position: 0 });
});
```
(Ajustar o `beforeEach` para incluir o mock `stages = { wonStage: jest.fn(), … }` e passar ao construtor.)

#### API (controller)

**Modify**: `apps/api/src/modules/proposals/api/proposals.controller.ts`
Adicionar as 4 rotas de ação sob `:id`. Manter depois das rotas CRUD.
```ts
  @Post(':id/send') send(
    @CurrentUserId() ownerId: string, @Param('id') id: string,
  ) {
    return this.proposals.send(ownerId, id);
  }

  @Post(':id/accept') accept(
    @CurrentUserId() ownerId: string, @Param('id') id: string,
  ) {
    return this.proposals.accept(ownerId, id);
  }

  @Post(':id/reject') reject(
    @CurrentUserId() ownerId: string, @Param('id') id: string,
  ) {
    return this.proposals.reject(ownerId, id);
  }

  @Post(':id/new-version') newVersion(
    @CurrentUserId() ownerId: string, @Param('id') id: string,
  ) {
    return this.proposals.newVersion(ownerId, id);
  }
```

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md`
Adicionar os 4 endpoints de ação na seção `## Proposals`, citando os `422` de transição. Exemplo:
```markdown
### POST /proposals/:id/accept
- **Propósito:** Aceitar a proposta (`SENT`/`NEGOTIATING` → `ACCEPTED`), setando `decidedAt`. Se houver `dealId`, move o deal vinculado para o estágio "Ganhou" (isWon).
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Proposal` (status `ACCEPTED`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.accept`
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila sem erros.
- [x] `pnpm --filter api test` — casos de transição/ação passam.
- [x] `pnpm --filter api lint` — sem erros.

#### Manual Verification
- [ ] `send` em `DRAFT` → `SENT` com `sentAt`; `send` de novo → `422`.
- [ ] `accept` direto de `DRAFT` → `422`; `accept` de `SENT` → `ACCEPTED` com `decidedAt`.
- [ ] Aceitar proposta com `dealId` move o deal para o estágio `isWon` (verificar no board).
- [ ] `reject` de `SENT`/`NEGOTIATING` → `REJECTED`.
- [ ] `new-version` cria linha nova: mesmo `number`, `version 2`, `parentId` = origem, status `DRAFT`, itens copiados.
- [ ] `GET /proposals/:id/versions` lista as duas versões ordenadas.

**⏸ PAUSE**: Confirmação manual antes da Fase 3.

---

## Phase 3: Backend — expiração por cron

### Goal
Instalar `@nestjs/schedule`, registrar `ScheduleModule.forRoot()` e criar um job diário (03:00) que
marca `SENT`/`NEGOTIATING` vencidas (`validUntil < hoje`) como `EXPIRED`; leituras também tratam
vencido como expirado (defesa entre execuções do cron).

### Changes

#### Dependência

**Instalar** (da raiz): `pnpm --filter api add @nestjs/schedule`

**Modify**: `apps/api/src/app.module.ts`
```ts
import { ScheduleModule } from '@nestjs/schedule';
// imports: [ ..., ScheduleModule.forRoot(), PipelineModule, ProposalsModule ]
```

#### Domínio + Infra

**Modify**: `apps/api/src/modules/proposals/domain/proposal.repository.ts`
Adicionar ao contrato:
```ts
/** Marca como EXPIRED toda proposta SENT|NEGOTIATING com validUntil < now. Retorna quantas. */
expireOverdue(now: Date): Promise<number>;
```

**Modify**: `apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts`
```ts
async expireOverdue(now: Date): Promise<number> {
  const r = await this.prisma.proposal.updateMany({
    where: {
      status: { in: ['SENT', 'NEGOTIATING'] },
      validUntil: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });
  return r.count;
}
```

#### Aplicação (job)

**Create**: `apps/api/src/modules/proposals/application/proposals-expiration.job.ts`
Provider com `@Cron`. Idempotente (`updateMany` só afeta vencidas ainda ativas). O método é público e
recebe/usa `new Date()` internamente para permitir teste por chamada direta.
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PROPOSAL_REPOSITORY,
  type ProposalRepository,
} from '../domain/proposal.repository';

@Injectable()
export class ProposalsExpirationJob {
  private readonly logger = new Logger(ProposalsExpirationJob.name);

  constructor(
    @Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const count = await this.repo.expireOverdue(new Date());
    if (count > 0) this.logger.log(`Propostas expiradas: ${count}`);
  }
}
```

**Create**: `apps/api/src/modules/proposals/application/proposals-expiration.job.spec.ts`
Testa por chamada direta (sem depender do agendador).
```ts
import { ProposalsExpirationJob } from './proposals-expiration.job';
import type { ProposalRepository } from '../domain/proposal.repository';

describe('ProposalsExpirationJob', () => {
  it('chama expireOverdue com a data atual', async () => {
    const repo = { expireOverdue: jest.fn().mockResolvedValue(2) } as unknown as ProposalRepository;
    const job = new ProposalsExpirationJob(repo);
    await job.run();
    expect(repo.expireOverdue).toHaveBeenCalledWith(expect.any(Date));
  });
});
```

**Modify**: `apps/api/src/modules/proposals/proposals.module.ts`
Registrar o job como provider.
```ts
import { ProposalsExpirationJob } from './application/proposals-expiration.job';
// providers: [ ProposalsService, ProposalsExpirationJob, { provide: PROPOSAL_REPOSITORY, useClass: PrismaProposalRepository } ]
```

#### Derivação na leitura

**Decisão**: manter simples nesta fase — a listagem/ficha exibem o `status` gravado. A derivação
"vencido = expirado" na leitura fica **documentada como pendência da Fase 6 (dashboard)**, onde as
consultas de conversão a exigem. Não bloquear a Fase 3 com isso. (Registrar como comentário no job.)

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila com `@nestjs/schedule` instalado.
- [x] `pnpm --filter api test` — `proposals-expiration.job.spec.ts` passa.
- [x] `pnpm --filter api lint` — sem erros.

#### Manual Verification
- [ ] App sobe sem erro de DI (`ScheduleModule.forRoot()` + job registrado).
- [ ] Criar proposta `SENT` com `validUntil` no passado, chamar `run()` (ou aguardar cron) → status vira `EXPIRED`.
- [ ] Proposta `SENT` sem `validUntil` **não** expira.
- [ ] Segunda execução do job não altera nada (idempotente).

**⏸ PAUSE**: Confirmação manual antes de iniciar o frontend (Fase 4).

---

## Phase 4: Frontend — dados, listagem e rotas

### Goal
Criar a camada de dados da feature `propostas` (types/api/hooks/query-keys), a página de listagem
`/propostas` e trocar os placeholders de rota.

### Changes

#### Tipos + API + hooks + query-keys

**Create**: `apps/web/src/features/propostas/api/types.ts`
Decimal serializa como `string` (mesma convenção de `Deal.amount`).
```ts
import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };
export type ServiceType = 'SOFTWARE' | 'WEBSITE' | 'PAID_TRAFFIC';
export type ProposalStatus =
  | 'DRAFT' | 'SENT' | 'NEGOTIATING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface ProposalItem {
  id: string;
  description: string;
  quantity: string;  // Decimal → string
  unitPrice: string;
  order: number;
}

export interface Proposal {
  id: string;
  number: string;
  version: number;
  parentId?: string | null;
  clientId: string;
  client: { id: string; name: string };
  dealId?: string | null;
  serviceType: ServiceType;
  status: ProposalStatus;
  scope?: string | null;
  paymentTerms?: string | null;
  deliveryTime?: string | null;
  validUntil?: string | null;
  discount?: string | null;
  total: string;
  items: ProposalItem[];
  sentAt?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}
export interface CreateProposalBody {
  clientId: string;
  serviceType: ServiceType;
  items: ProposalItemInput[];
  dealId?: string;
  discount?: number;
  scope?: string;
  paymentTerms?: string;
  deliveryTime?: string;
  validUntil?: string;
}
export type UpdateProposalBody = Partial<Omit<CreateProposalBody, 'clientId' | 'dealId'>>;

export interface ListProposalsParams {
  page?: number;
  limit?: number;
  clientId?: string;
  status?: ProposalStatus;
}
```

**Create**: `apps/web/src/features/propostas/api/proposals.api.ts`
Espelha `deals.api.ts`. Ações de status são `POST` sem corpo.
```ts
import { api } from '@/lib/api';
import type {
  CreateProposalBody, ListProposalsParams, Paginated, Proposal, UpdateProposalBody,
} from './types';

export const proposalsApi = {
  list: (params: ListProposalsParams) =>
    api.get<Paginated<Proposal>>('/proposals', { params }).then((r) => r.data),
  listByClient: (clientId: string) =>
    api.get<Paginated<Proposal>>('/proposals', { params: { clientId, limit: 100 } }).then((r) => r.data),
  get: (id: string) => api.get<Proposal>(`/proposals/${id}`).then((r) => r.data),
  versions: (id: string) => api.get<Proposal[]>(`/proposals/${id}/versions`).then((r) => r.data),
  create: (body: CreateProposalBody) => api.post<Proposal>('/proposals', body).then((r) => r.data),
  update: (id: string, body: UpdateProposalBody) =>
    api.patch<Proposal>(`/proposals/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/proposals/${id}`).then((r) => r.data),
  send: (id: string) => api.post<Proposal>(`/proposals/${id}/send`).then((r) => r.data),
  accept: (id: string) => api.post<Proposal>(`/proposals/${id}/accept`).then((r) => r.data),
  reject: (id: string) => api.post<Proposal>(`/proposals/${id}/reject`).then((r) => r.data),
  newVersion: (id: string) => api.post<Proposal>(`/proposals/${id}/new-version`).then((r) => r.data),
};
```

**Modify**: `apps/web/src/lib/query-keys.ts`
Adicionar bloco `proposals`.
```ts
  proposals: {
    all: ['proposals'] as const,
    list: (params: object) => ['proposals', 'list', params] as const,
    detail: (id: string) => ['proposals', 'detail', id] as const,
    versions: (id: string) => ['proposals', 'versions', id] as const,
    byClient: (clientId: string) => ['proposals', 'client', clientId] as const,
  },
```

**Create**: `apps/web/src/features/propostas/api/hooks.ts`
Hooks TanStack Query + invalidação de `proposals.all` + detalhe/versões. As ações de status também
invalidam `deals.all` (o aceite move o deal).
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { proposalsApi } from './proposals.api';
import type { CreateProposalBody, ListProposalsParams, UpdateProposalBody } from './types';

export function useProposals(params: ListProposalsParams) {
  return useQuery({
    queryKey: queryKeys.proposals.list(params),
    queryFn: () => proposalsApi.list(params),
  });
}
export function useProposalsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.proposals.byClient(clientId),
    queryFn: () => proposalsApi.listByClient(clientId),
  });
}
export function useProposal(id: string) {
  return useQuery({
    queryKey: queryKeys.proposals.detail(id),
    queryFn: () => proposalsApi.get(id),
    enabled: !!id,
  });
}
export function useProposalVersions(id: string) {
  return useQuery({
    queryKey: queryKeys.proposals.versions(id),
    queryFn: () => proposalsApi.versions(id),
    enabled: !!id,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.proposals.all });
}
export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProposalBody) => proposalsApi.create(body),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useUpdateProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProposalBody) => proposalsApi.update(id, body),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useDeleteProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => proposalsApi.remove(id),
    onSuccess: () => invalidateAll(qc),
  });
}
/** Ações de status: send/accept/reject/new-version. Aceite também invalida deals. */
export function useProposalAction(action: 'send' | 'accept' | 'reject' | 'newVersion') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => proposalsApi[action](id),
    onSuccess: () => {
      invalidateAll(qc);
      if (action === 'accept') void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    },
  });
}
```

#### Formatação monetária compartilhada

**Create**: `apps/web/src/features/propostas/lib/proposal-format.ts`
`formatMoney` genérico (mesma base do `formatDealAmount`), reusado na listagem/ficha/editor.
```ts
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata um Decimal serializado (string) ou number como moeda pt-BR; '—' se nulo. */
export function formatMoney(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  return currency.format(Number(value));
}
```

#### Listagem

**Create**: `apps/web/src/features/propostas/PropostasListPage.tsx` (export **default**)
Espelha `ClientesListPage.tsx`: `Table`/`TableLink`/`Badge`, filtro de status por coluna
(`ColumnRadioFilter` — extrair de `ClientesListPage` para `components/ui` **ou** replicar localmente;
preferir replicar local para não alterar a feature `clientes` nesta fase), paginação `data.meta`.
Colunas: Número, Cliente, Tipo de serviço, Status (filtro), Total, Validade. Sem campo de busca
(a API não filtra por texto — só `clientId`/`status`). Botão "Nova proposta" abre `ProposalFormDialog`
(criado na Fase 5; nesta fase, deixar o botão desabilitado com TODO ou já importar após a Fase 5).
```tsx
const STATUS_BADGE: Record<ProposalStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'outline',
  NEGOTIATING: 'outline',
  ACCEPTED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
};
// linha: <TableLink to={`/propostas/${p.id}`}>{p.number}</TableLink> · {p.client.name}
//        · translateServiceType · <Badge>{translateProposalStatus(p.status)}</Badge>
//        · formatMoney(p.total) · formatDate(p.validUntil)
```

#### Rotas

**Modify**: `apps/web/src/routes/router.tsx`
Trocar os placeholders `/propostas` e `/propostas/:id`; a sub-aba do cliente entra na Fase 6.
```tsx
import PropostasListPage from '@/features/propostas/PropostasListPage';
import PropostaDetalhePage from '@/features/propostas/PropostaDetalhePage'; // Fase 6
// ...
  { path: '/propostas', element: <PropostasListPage /> },
  { path: '/propostas/:id', element: <PropostaDetalhePage /> },
```
> Nesta fase só a listagem é obrigatória. `PropostaDetalhePage` é criada na Fase 6; para manter o
> build verde entre fases, importar `PropostaDetalhePage` só ao trocar a rota `/propostas/:id`
> (fazer essa troca junto da Fase 6) ou criar um stub mínimo agora. Preferir: trocar `/propostas`
> agora e deixar `/propostas/:id` como placeholder até a Fase 6.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — `tsc -b && vite build` sem erros de tipo.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] `/propostas` lista propostas com número, cliente, tipo, badge de status, total e validade.
- [ ] Filtro de status por coluna funciona; paginação anterior/próxima funciona.
- [ ] Item de nav "Propostas" leva à listagem.
- [ ] Lista vazia mostra estado "Nenhuma proposta encontrada.".

**⏸ PAUSE**: Confirmação manual antes da Fase 5.

---

## Phase 5: Frontend — formulário e editor de itens

### Goal
Criar `ProposalFormDialog` (RHF+Zod, pt-BR) com o `ItemsEditor` (linhas dinâmicas via `useFieldArray`,
subtotais e total ao vivo em centavos) para criar e editar (edição só em `DRAFT`).

### Changes

#### Editor de itens

**Create**: `apps/web/src/features/propostas/components/ItemsEditor.tsx`
`useFieldArray({ control, name: 'items' })`: cada linha tem descrição (`Input`), quantidade (`Input`
`type=number`), valor unitário (`MoneyInput` via `Controller`), subtotal calculado e botão remover.
Total ao vivo com `useWatch` no array + desconto, **calculado em centavos** (espelha `computeTotal`
do backend para consistência visual). `append`/`remove`; mínimo 1 item.
```tsx
import { useFieldArray, useWatch, type Control } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
// helper local espelhando o backend (centavos):
function toCents(v: number) { return Math.round((v || 0) * 100); }
function liveTotalCents(items: { quantity: number; unitPrice: number }[], discount = 0) {
  const gross = items.reduce((s, it) => s + toCents((it.quantity || 0) * (it.unitPrice || 0)), 0);
  return Math.max(0, gross - toCents(discount));
}
// exibe subtotal por linha = formatMoney((qty*unit)) e total = formatMoney(liveTotalCents/100)
```
Props: `{ control, register, errors }` (recebe do form pai). Renderiza `FieldError` da mensagem
`items` do Zod (mínimo 1 item, descrição obrigatória).

#### Formulário

**Create**: `apps/web/src/features/propostas/ProposalFormDialog.tsx`
Espelha `DealFormDialog.tsx`: seletor de cliente com busca (`useClientOptions` de
`@/features/pipeline/api/hooks` — reuso permitido pois é hook público da feature via barrel? **Não**:
uma feature não importa o interior de outra. Reusar o **componente de seleção** exige subir para
`components/ui` ou duplicar o lookup). **Decisão**: criar um `proposals/api/clients-lookup` local
espelhando `clients-lookup.api.ts` (pequeno) para não violar a fronteira entre features. Cadastro
rápido de cliente via `ClientFormDialog` (de `clientes`, que é import de feature→feature já praticado
em `DealFormDialog`, portanto aceitável para diálogos compartilhados de `clientes`).
```tsx
const schema = z.object({
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE', 'WEBSITE', 'PAID_TRAFFIC']),
  items: z.array(z.object({
    description: z.string().min(1, 'Descrição obrigatória.'),
    quantity: z.number().min(0, 'Quantidade inválida.'),
    unitPrice: z.number().min(0, 'Valor inválido.'),
  })).min(1, 'Adicione ao menos um item.'),
  discount: z.number().min(0).optional(),
  scope: z.string().optional(),
  paymentTerms: z.string().optional(),
  deliveryTime: z.string().optional(),
  validUntil: z.string().optional(),
});
// defaultValues.items = [{ description: '', quantity: 1, unitPrice: 0 }]
// onSubmit: create → toast 'Proposta criada.'; edit (só DRAFT) → update com items → 'Proposta atualizada.'
// submit externo via form="proposal-form"; extractApiMessage para erros.
```
Props: `{ open, onOpenChange, proposal?, defaultClientId? }`. No modo edição, `reset` a partir de
`proposal` convertendo `quantity`/`unitPrice`/`discount` de string→Number. Diálogo grande
(`sm:max-w-2xl`) por causa do editor de itens.

**Modify**: `apps/web/src/features/propostas/PropostasListPage.tsx`
Ligar o botão "Nova proposta" ao `ProposalFormDialog` (remover o TODO da Fase 4).

**Create**: `apps/web/src/features/propostas/api/clients-lookup.api.ts`
Cópia local do lookup (evita import do interior de `pipeline`).
```ts
import { api } from '@/lib/api';
export interface ClientOption { id: string; name: string }
export const clientsLookupApi = {
  search: (search?: string) =>
    api.get<{ data: ClientOption[] }>('/clients', { params: { search: search || undefined, limit: 20 } })
      .then((r) => r.data.data),
};
```
(+ um `useClientOptions` local em `proposals/api/hooks.ts` usando `queryKeys.clientOptions`.)

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros de tipo.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] Criar proposta pelo diálogo: adicionar/remover linhas de item, subtotais e total ao vivo batem com o `total` retornado pela API.
- [ ] Validação: sem itens → erro; descrição vazia → erro; campos obrigatórios com asterisco.
- [ ] Desconto reduz o total ao vivo; total nunca fica negativo.
- [ ] Cadastro rápido de cliente dentro do formulário funciona e já vem selecionado (modal-stack).
- [ ] Editar um rascunho preenche o formulário e salva; itens substituídos corretamente.

**⏸ PAUSE**: Confirmação manual antes da Fase 6.

---

## Phase 6: Frontend — ficha e aba do cliente

### Goal
Criar `PropostaDetalhePage` (página única com seções: dados + itens + ações de status + histórico de
versões) e a `PropostasTab` na ficha do cliente.

### Changes

#### Ficha da proposta

**Create**: `apps/web/src/features/propostas/PropostaDetalhePage.tsx` (export **default**)
Página única (não sub-abas). Seções:
- **Cabeçalho**: voltar para `/propostas`, `number` + `vN`, `<Badge>` de status, nome do cliente,
  botões de ação condicionais ao status.
- **Ações de status** (condicionais, via `useProposalAction` + `ConfirmDialog` quando destrutivo):
  - `DRAFT`: **Editar** (abre `ProposalFormDialog`), **Enviar** (`send`), **Excluir** (`delete`, confirm).
  - `SENT`/`NEGOTIATING`: **Aceitar** (`accept`, confirm — move o deal), **Recusar** (`reject`, confirm),
    **Nova versão** (`new-version` → navega para a nova proposta).
  - `ACCEPTED`/`REJECTED`/`EXPIRED`: só leitura + **Nova versão**.
- **Dados**: tipo de serviço, validade, condições de pagamento, prazo de entrega, escopo (markdown como
  texto simples nesta fase), `sentAt`/`decidedAt`.
- **Itens**: tabela descrição/qtd/valor unitário/subtotal + linha de desconto + **Total** (usar
  `formatMoney`).
- **Versões**: lista da cadeia (`useProposalVersions`) com link para cada versão e destaque na atual.

Estados de loading/erro espelham `ClienteDetalheLayout` (Skeleton / Empty "Proposta não encontrada.").
Toasts pt-BR em cada ação (`extractApiMessage` no catch).

**Modify**: `apps/web/src/routes/router.tsx`
Trocar o placeholder `/propostas/:id` por `<PropostaDetalhePage />` (se ainda não trocado na Fase 4).

#### Aba na ficha do cliente

**Create**: `apps/web/src/features/clientes/tabs/PropostasTab.tsx`
Espelha `OportunidadesTab.tsx`: `useOutletContext<Client>()`, `useProposalsByClient(client.id)`, lista
com número/status/total e link para a ficha; botão "Nova proposta" abre `ProposalFormDialog` com
`defaultClientId`. Estado vazio com `Empty`.
```tsx
// import { useProposalsByClient } from '@/features/propostas/api/hooks';
// import { ProposalFormDialog } from '@/features/propostas/ProposalFormDialog';
// import { formatMoney } from '@/features/propostas/lib/proposal-format';
// lista: número · translateProposalStatus(status) · formatMoney(total) → link /propostas/:id
```

**Modify**: `apps/web/src/routes/router.tsx`
Trocar a sub-aba `{ path: 'propostas', element: <PlaceholderTab title="Propostas" /> }` por
`<PropostasTab />` e importar o componente.
```tsx
import PropostasTab from '@/features/clientes/tabs/PropostasTab';
// children: { path: 'propostas', element: <PropostasTab /> },
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros de tipo.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] `/propostas/:id` mostra dados, itens com subtotais, total, e histórico de versões.
- [ ] Ações aparecem conforme o status (DRAFT: editar/enviar/excluir; SENT: aceitar/recusar/nova versão).
- [ ] Aceitar move o deal vinculado para "Ganhou" (verificar no pipeline) e atualiza o badge.
- [ ] "Nova versão" cria e navega para a nova proposta (v2, DRAFT).
- [ ] Aba "Propostas" na ficha do cliente lista as propostas e permite criar com o cliente pré-selecionado.
- [ ] Excluir rascunho remove da lista; excluir não-rascunho não é oferecido.

**⏸ PAUSE**: Confirmação manual final — Fase 3 concluída.

---

## Testing Strategy

### Unit Tests
- `money.spec.ts` — `computeTotal`: soma sem erro de float, multiplicação qtd×valor, desconto, piso zero.
- `proposals.service.spec.ts` — geração de número, posse (404), `PATCH`/`DELETE` só em DRAFT,
  transições válidas/inválidas (422), `accept` movendo o deal, `newVersion` (mesmo number, version+1).
- `proposals-expiration.job.spec.ts` — `run()` chama `expireOverdue` com `Date`.

### Integration Tests
- Fluxo manual ponta a ponta (checklists de Manual Verification por fase): criar → enviar → aceitar
  (deal move) / recusar / nova versão; expiração via job; filtros e paginação da listagem.
- Interação cross-módulo: `ProposalsModule` → `DealsService.move` e `PipelineStagesService.wonStage`;
  posse via `ClientsService.findOne`.

### Migration & Rollback
- **Sem migration** — `Proposal`/`ProposalItem` já existem na `init`. Nada a aplicar em ambientes.
- **`ProposalItem` sem cascade delete**: o `delete` do repositório remove os itens antes da proposta
  numa `$transaction` (idem `updateWithItems`). Não há FK `onDelete: Cascade` no schema atual.
- Rollback de código: reverter os commits das fases; nenhum dado de schema alterado.

## Environment Considerations
- **CI/CD**: `pnpm --filter api build/test/lint` e `pnpm --filter web build/lint` devem passar por fase.
- **Migrations**: nenhuma (decisão registrada).
- **Config/Secrets**: nenhuma nova var de ambiente. `@nestjs/schedule` roda in-process (sem infra
  externa); o cron dispara no processo da API — em múltiplas instâncias, rodaria em cada uma
  (idempotente, sem efeito colateral duplicado). Single-tenant/instância única hoje.
- **Nova dependência**: `@nestjs/schedule` em `apps/api` (Fase 3).

## Dependencies & Risks
- **Concorrência no gerador de número**: `max+1` por ano tem corrida teórica sob criação simultânea;
  aceitável em single-user (decisão). Se virar multiusuário, migrar para sequence dedicada.
- **`moveDealToWon` depende de existir um estágio `isWon`**: se nenhum estágio for `isWon`, o aceite
  apenas marca `ACCEPTED` sem mover (comportamento defensivo — `wonStage()` retorna `null`).
- **Fronteira entre features (web)**: reusar lookup de cliente exige cópia local em `propostas`
  (não importar o interior de `pipeline`); `ClientFormDialog`/`ProposalFormDialog` são componentes
  compartilhados de suas features (padrão já usado em `DealFormDialog`).
- **Ordem de rotas no controller**: `:id/versions`, `:id/send` etc. estão sob `:id` — sem conflito com
  rotas estáticas coletivas; manter coletivas antes de `:id`.

## References
- PRD: `specs/research/2026-07-23-fase-3-propostas.md`
- Research Fase 2: `specs/research/2026-07-21-fase-2-pipeline.md`
- Plano Fase 2: `specs/plans/2026-07-21-fase-2-pipeline.md`
- Padrão canônico backend: `apps/api/src/modules/pipeline/`
- Padrões frontend: `apps/web/src/features/clientes/`, `apps/web/src/features/pipeline/`
- DoD de endpoints: `apps/api/ENDPOINTS.md` + `apps/api/CLAUDE.md`
- RHF `useFieldArray`: https://react-hook-form.com/docs/usefieldarray
