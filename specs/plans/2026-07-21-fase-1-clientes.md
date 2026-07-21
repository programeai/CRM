---
date: 2026-07-21T15:11:23+0000
author: claude
source_prd: specs/research/2026-07-21-fase-1-clientes.md
git_commit: 66c2291b54960fa510ed2c7aa6ac5640abe39eec
branch: main
status: implemented
tags: [spec, clients, contacts, activities, backend, frontend]
---

# Spec: Fase 1 — Clientes (CRUD de clientes/contatos, timeline e follow-ups)

## Overview

Primeira feature de negócio do CRM. Vamos construir três recursos de backend — **Clients**, **Contacts** e **Activities** — seguindo o **repository pattern em camadas** (`domain`/`application`/`infra`/`api`) descrito em `apps/api/CLAUDE.md`, e a feature de frontend **`clientes`** (listagem paginada com filtros, formulário de criar/editar em `Sheet`, e ficha do cliente com Dados + Contatos + Timeline + abas placeholder).

Como é a primeira feature de negócio, ela **estabelece padrões que ainda não existem**: convenção de paginação `{ data, meta }` (helper transversal em `shared/`), hooks TanStack Query (queryKeys + mutations + invalidação) e helpers de formatação (CPF/CNPJ, telefone, datas). Fases posteriores (Pipeline, Propostas, Financeiro) reutilizam esses padrões.

A fundação (Fase 0) está estável e pode ser assumida como pronta: schema Prisma completo migrado, auth JWT com `JwtAuthGuard` global (`req.user.sub`), `PrismaModule` `@Global`, `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted` + `transform`), axios com refresh no front, `QueryClientProvider` montado, traduções de enum em `lib/labels.ts` e componentes UI prontos.

## Current State

- **Backend:** módulos `auth` e `users` usam `PrismaService` direto (padrão transversal simples). Não há módulo de negócio em camadas ainda. Não há paginação, nem helpers compartilhados em `shared/`. `ENDPOINTS.md` documenta só Auth.
- **Schema:** `Client`, `Contact`, `Activity` e enums já migrados. `Client` **não tem** campos de endereço. Índices existentes: só `Activity(clientId, createdAt)`.
- **Frontend:** rotas `/clientes` e `/clientes/:id` são `PlaceholderPage`. Item de menu "Clientes" já existe em `nav.ts`. `lib/labels.ts` já traduz `PersonType`/`LeadSource`/`ClientStatus`/`ActivityType`. **Não existem** `lib/format.ts` nem `lib/query-keys.ts`. Nenhum uso de TanStack Query ainda (só o provider).

Detalhes completos no PRD (`specs/research/2026-07-21-fase-1-clientes.md`).

## Desired End State

Ao fim das 6 fases:

- **API:** `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/archive`; `GET/POST /clients/:id/contacts`, `PATCH/DELETE /contacts/:id`; `GET/POST /activities` (filtro por `clientId`/`dealId`), `PATCH /activities/:id`, `POST /activities/:id/complete`. Todas autenticadas via guard global, `ownerId` derivado de `req.user.sub`, mensagens pt-BR, listagens paginadas `{ data, meta }`. `ENDPOINTS.md` reflete todas as rotas.
- **Schema:** `Client` com campos simples de endereço e índices para os filtros.
- **Web:** `/clientes` lista clientes (busca por nome/documento + filtros de status e origem, paginação, Badge de status, `TableLink` → ficha, estados vazio/carregando); botão "Novo cliente" abre `Sheet` com o formulário; `/clientes/:id` mostra a ficha com abas Dados, Contatos e Timeline reais (+ Propostas/Projetos/Contratos como "Em breve"), com arquivar via `ConfirmDialog`.

## What We're NOT Doing

- **Multi-tenancy / RLS** — single-tenant; `ownerId` é só preparação (`CLAUDE.md` raiz §escopo). Não filtrar por organização, não criar tabela de tenant.
- **Filtro por tags na listagem** — decidido fora do MVP desta fase (o campo `tags[]` continua editável no form e visível na ficha).
- **Abas funcionais de Propostas/Projetos/Contratos na ficha** — só placeholder "Em breve"; são fases futuras.
- **`@unique` de `document` no banco** — a unicidade é checada em aplicação (evita migration de constraint e permite `document` nulo repetido).
- **Cron/jobs, dashboard, e demais recursos do SPEC §5** (Deals, Proposals, Projects, Tasks, Contracts, Payments) — fases futuras.
- **RBAC / permissões** — `permission` nos itens de nav/tabs continua ignorado.
- **Exclusão física de cliente** — apenas arquivamento (soft delete via `archivedAt`).

---

## Phase 1: Migração de schema (endereço + índices)

### Goal
Adicionar campos simples de endereço ao `Client` e índices para os filtros de listagem, gerando uma migration nova.

### Changes

#### Prisma schema

**Modify**: `apps/api/prisma/schema.prisma` (model `Client`, atualmente linhas 22-45)

Adicionar os campos de endereço (todos opcionais) e dois índices. Inserir os campos após `notes` e antes de `archivedAt`; adicionar o bloco de índices ao fim do model.

```prisma
model Client {
  id         String       @id @default(uuid())
  ownerId    String // preparação p/ multiusuário
  name       String
  tradeName  String?
  personType PersonType   @default(COMPANY)
  document   String? // CPF/CNPJ
  email      String?
  phone      String?
  website    String?
  source     LeadSource?
  status     ClientStatus @default(LEAD)
  tags       String[]
  notes      String?
  // --- endereço (opcional, campos simples) ---
  zipCode    String?
  street     String?
  number     String?
  complement String?
  district   String?
  city       String?
  state      String? // UF
  // --- soft delete ---
  archivedAt DateTime?
  contacts   Contact[]
  activities Activity[]
  deals      Deal[]
  proposals  Proposal[]
  projects   Project[]
  contracts  Contract[]
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  @@index([ownerId, status])
  @@index([ownerId, archivedAt])
}
```

### Success Criteria

#### Automated Verification
- [x] `docker compose up -d` — Postgres no ar (porta host 5435).
- [x] `pnpm --filter api exec prisma migrate dev --name add_client_address_and_indexes` — cria e aplica a migration sem erro.
- [x] `pnpm --filter api exec prisma generate` — client Prisma regenerado com os novos campos.
- [x] `pnpm --filter api build` — compila sem erros de tipo.

#### Manual Verification
- [x] Novos campos e índices aparecem no arquivo `apps/api/prisma/migrations/<timestamp>_add_client_address_and_indexes/migration.sql`.
- [x] `prisma studio` (ou inspeção) mostra as colunas novas na tabela `Client`.

**⏸ PAUSE**: Após a verificação automatizada passar, parar para confirmação humana antes da Fase 2.

---

## Phase 2: Backend — módulo Clients (em camadas)

### Goal
Entregar o CRUD de clientes em camadas (`domain`/`application`/`infra`/`api`) com arquivamento, paginação `{ data, meta }`, validação/unicidade de documento e `ownerId` derivado do token — estabelecendo os padrões que Contacts/Activities reutilizam.

### Changes

#### Shared — paginação e usuário atual (transversais)

**Create**: `apps/api/src/shared/pagination.ts`
Contrato e helper de paginação reutilizável por todos os módulos de listagem.
```ts
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
}
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Normaliza page/limit para valores seguros (>=1, limit<=MAX_LIMIT). */
export function normalizePage(page?: number, limit?: number) {
  const p = Number.isFinite(page) && page! > 0 ? Math.floor(page!) : DEFAULT_PAGE;
  const l =
    Number.isFinite(limit) && limit! > 0
      ? Math.min(Math.floor(limit!), MAX_LIMIT)
      : DEFAULT_LIMIT;
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}

export function paginated<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
  return { data, meta: { total, page, limit } };
}
```

**Create**: `apps/api/src/shared/dto/pagination-query.dto.ts`
Base de query para listagens paginadas (herdada pelos DTOs de filtro).
```ts
import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'A página deve ser um número inteiro.' })
  @Min(1, { message: 'A página deve ser no mínimo 1.' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O limite deve ser um número inteiro.' })
  @Min(1, { message: 'O limite deve ser no mínimo 1.' })
  limit?: number;
}
```

**Create**: `apps/api/src/shared/current-user.decorator.ts`
Decorator para ler `sub` do `req.user` (substitui o acesso manual a `req.user.sub` visto no `auth.controller`). Reutilizado por todos os controllers de negócio.
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Extrai o id do usuário autenticado (req.user.sub), populado pelo JwtAuthGuard global. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { user: { sub: string } }>();
    return req.user.sub;
  },
);
```

**Create**: `apps/api/src/shared/document.ts`
Validação própria de CPF/CNPJ (sem lib nova). Valida dígitos verificadores; ignora máscara.
```ts
/** Remove tudo que não é dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** Valida CPF (PF) ou CNPJ (PJ) conforme o tipo de pessoa. */
export function isValidDocument(document: string, personType: 'INDIVIDUAL' | 'COMPANY'): boolean {
  return personType === 'INDIVIDUAL' ? isValidCPF(document) : isValidCNPJ(document);
}
```

#### Módulo Clients — camada `domain`

**Create**: `apps/api/src/modules/clients/domain/client.repository.ts`
Interface do repositório + token DI. A camada `application` depende disto, nunca do Prisma.
```ts
import type { Client, Prisma } from '@prisma/client';

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

export interface ClientListFilter {
  ownerId: string;
  search?: string; // casa em name, tradeName, document
  status?: Client['status'];
  source?: NonNullable<Client['source']>;
  includeArchived?: boolean;
  skip: number;
  take: number;
}

export interface ClientRepository {
  create(data: Prisma.ClientUncheckedCreateInput): Promise<Client>;
  findById(id: string, ownerId: string): Promise<Client | null>;
  findManyAndCount(filter: ClientListFilter): Promise<{ data: Client[]; total: number }>;
  update(id: string, ownerId: string, data: Prisma.ClientUpdateInput): Promise<Client>;
  archive(id: string, ownerId: string): Promise<Client>;
  /** Existe cliente com este documento (mesmo owner), excluindo opcionalmente um id? */
  existsByDocument(ownerId: string, document: string, exceptId?: string): Promise<boolean>;
}
```

#### Módulo Clients — camada `infra`

**Create**: `apps/api/src/modules/clients/infra/prisma-client.repository.ts`
Implementação Prisma da interface. Único ponto que toca `PrismaService`.
```ts
import { Injectable } from '@nestjs/common';
import type { Client, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ClientListFilter, ClientRepository } from '../domain/client.repository';

@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ClientUncheckedCreateInput) {
    return this.prisma.client.create({ data });
  }

  findById(id: string, ownerId: string) {
    return this.prisma.client.findFirst({ where: { id, ownerId } });
  }

  async findManyAndCount(filter: ClientListFilter) {
    const where: Prisma.ClientWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.includeArchived ? {} : { archivedAt: null }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { tradeName: { contains: filter.search, mode: 'insensitive' } },
              { document: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, ownerId: string, data: Prisma.ClientUpdateInput) {
    // updateMany garante o filtro por ownerId; retorna o registro atualizado.
    return this.prisma.client
      .updateMany({ where: { id, ownerId }, data })
      .then(() => this.prisma.client.findFirstOrThrow({ where: { id, ownerId } }));
  }

  archive(id: string, ownerId: string) {
    return this.update(id, ownerId, { archivedAt: new Date() });
  }

  async existsByDocument(ownerId: string, document: string, exceptId?: string) {
    const found = await this.prisma.client.findFirst({
      where: { ownerId, document, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    return found !== null;
  }
}
```

#### Módulo Clients — camada `api` (DTOs)

**Create**: `apps/api/src/modules/clients/api/dto/create-client.dto.ts`
```ts
import {
  IsArray, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { PersonType, LeadSource, ClientStatus } from '@prisma/client';

export class CreateClientDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional() @IsString() tradeName?: string;

  @IsEnum(PersonType, { message: 'Tipo de pessoa inválido.' })
  personType: PersonType;

  @IsOptional() @IsString() document?: string;

  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() website?: string;

  @IsOptional() @IsEnum(LeadSource, { message: 'Origem inválida.' }) source?: LeadSource;
  @IsOptional() @IsEnum(ClientStatus, { message: 'Status inválido.' }) status?: ClientStatus;

  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;

  // endereço
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}
```

**Create**: `apps/api/src/modules/clients/api/dto/update-client.dto.ts`
```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateClientDto } from './create-client.dto';

export class UpdateClientDto extends PartialType(CreateClientDto) {}
```
> Nota: `@nestjs/mapped-types` já é dependência transitiva do Nest; se não resolver, adicionar com `pnpm --filter api add @nestjs/mapped-types`.

**Create**: `apps/api/src/modules/clients/api/dto/list-clients-query.dto.ts`
```ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ClientStatus, LeadSource } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListClientsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(ClientStatus, { message: 'Status inválido.' }) status?: ClientStatus;
  @IsOptional() @IsEnum(LeadSource, { message: 'Origem inválida.' }) source?: LeadSource;
}
```

#### Módulo Clients — camada `application`

**Create**: `apps/api/src/modules/clients/application/clients.service.ts`
Regra de negócio pura: depende da interface do repositório (token DI), valida documento, checa unicidade, deriva `ownerId`.
```ts
import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import type { Client } from '@prisma/client';
import { CLIENT_REPOSITORY, type ClientRepository } from '../domain/client.repository';
import { isValidDocument, onlyDigits } from '../../../shared/document';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateClientDto } from '../api/dto/create-client.dto';
import type { UpdateClientDto } from '../api/dto/update-client.dto';
import type { ListClientsQueryDto } from '../api/dto/list-clients-query.dto';

@Injectable()
export class ClientsService {
  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly repo: ClientRepository,
  ) {}

  async create(ownerId: string, dto: CreateClientDto): Promise<Client> {
    const document = await this.resolveDocument(ownerId, dto.document, dto.personType);
    return this.repo.create({ ...dto, document, ownerId });
  }

  async list(ownerId: string, query: ListClientsQueryDto) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId, search: query.search, status: query.status, source: query.source, skip, take,
    });
    return paginated(data, total, page, limit);
  }

  async findOne(ownerId: string, id: string): Promise<Client> {
    const client = await this.repo.findById(id, ownerId);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  async update(ownerId: string, id: string, dto: UpdateClientDto): Promise<Client> {
    const existing = await this.findOne(ownerId, id);
    const personType = dto.personType ?? existing.personType;
    const data: UpdateClientDto & { document?: string | null } = { ...dto };
    if (dto.document !== undefined) {
      data.document = dto.document
        ? await this.resolveDocument(ownerId, dto.document, personType, id)
        : null;
    }
    return this.repo.update(id, ownerId, data);
  }

  async archive(ownerId: string, id: string): Promise<Client> {
    await this.findOne(ownerId, id);
    return this.repo.archive(id, ownerId);
  }

  /** Valida formato e unicidade do documento; retorna só dígitos, ou undefined se vazio. */
  private async resolveDocument(
    ownerId: string, document: string | undefined,
    personType: 'INDIVIDUAL' | 'COMPANY', exceptId?: string,
  ): Promise<string | undefined> {
    if (!document) return undefined;
    const clean = onlyDigits(document);
    if (!isValidDocument(clean, personType)) {
      throw new BadRequestException(
        personType === 'INDIVIDUAL' ? 'CPF inválido.' : 'CNPJ inválido.',
      );
    }
    if (await this.repo.existsByDocument(ownerId, clean, exceptId)) {
      throw new ConflictException('Já existe um cliente com este documento.');
    }
    return clean;
  }
}
```

#### Módulo Clients — camada `api` (controller)

**Create**: `apps/api/src/modules/clients/api/clients.controller.ts`
```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ClientsService } from '../application/clients.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@CurrentUserId() ownerId: string, @Query() query: ListClientsQueryDto) {
    return this.clients.list(ownerId, query);
  }

  @Post()
  create(@CurrentUserId() ownerId: string, @Body() dto: CreateClientDto) {
    return this.clients.create(ownerId, dto);
  }

  @Get(':id')
  findOne(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.clients.findOne(ownerId, id);
  }

  @Patch(':id')
  update(@CurrentUserId() ownerId: string, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(ownerId, id, dto);
  }

  @Post(':id/archive')
  archive(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.clients.archive(ownerId, id);
  }
}
```

#### Módulo Clients — module

**Create**: `apps/api/src/modules/clients/clients.module.ts`
```ts
import { Module } from '@nestjs/common';
import { ClientsController } from './api/clients.controller';
import { ClientsService } from './application/clients.service';
import { CLIENT_REPOSITORY } from './domain/client.repository';
import { PrismaClientRepository } from './infra/prisma-client.repository';

@Module({
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
```

#### Registro do módulo

**Modify**: `apps/api/src/app.module.ts` (imports, atualmente linhas 11-19)
Adicionar `ClientsModule` aos `imports`.
```ts
import { ClientsModule } from './modules/clients/clients.module';
// ...
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
    PrismaModule,
    AuthModule,
    ClientsModule,
  ],
```

#### Teste de service

**Create**: `apps/api/src/modules/clients/application/clients.service.spec.ts`
Seguindo o padrão de `auth.service.spec.ts` (mock manual, `jest.Mocked`, descrições pt-BR). Cobrir: criação com `ownerId` derivado; `BadRequestException` para documento inválido; `ConflictException` para documento duplicado; `NotFoundException` em `findOne`/`update`/`archive` de id inexistente; paginação (chama repo com `skip/take` corretos).
```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import type { ClientRepository } from '../domain/client.repository';

describe('ClientsService', () => {
  let repo: jest.Mocked<ClientRepository>;
  let service: ClientsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(), findById: jest.fn(), findManyAndCount: jest.fn(),
      update: jest.fn(), archive: jest.fn(), existsByDocument: jest.fn(),
    };
    service = new ClientsService(repo);
  });

  it('cria cliente derivando ownerId e limpando o documento', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1' } as never);
    await service.create('owner-1', {
      name: 'Acme', personType: 'COMPANY', document: '11.222.333/0001-81',
    } as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1', document: '11222333000181' }),
    );
  });

  it('rejeita documento inválido com BadRequestException', async () => {
    await expect(
      service.create('owner-1', { name: 'X', personType: 'INDIVIDUAL', document: '123' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita documento duplicado com ConflictException', async () => {
    repo.existsByDocument.mockResolvedValue(true);
    await expect(
      service.create('owner-1', { name: 'X', personType: 'INDIVIDUAL', document: '390.533.447-05' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lança NotFoundException ao buscar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```
> Usar CPFs/CNPJs válidos reais nos testes (ex.: CPF `390.533.447-05`, CNPJ `11.222.333/0001-81`).

#### Documentação de endpoints

**Modify**: `apps/api/ENDPOINTS.md`
Adicionar uma seção `## Clients` com os 5 endpoints no formato fixo (Propósito/Auth/Body/Resposta/Erros/Handler), pt-BR. Ex. do `GET /clients`:
```md
## Clients

### GET /clients
- **Propósito:** Listar clientes do usuário autenticado (não arquivados), com busca e filtros, paginado.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page?`, `limit?`, `search?`, `status?`, `source?`)
- **Resposta:** `200 { data: Client[], meta: { total, page, limit } }`.
- **Erros:** `400` (query inválida), `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.list`
```
Documentar também `POST /clients`, `GET /clients/:id`, `PATCH /clients/:id`, `POST /clients/:id/archive` (erros: `400` documento inválido, `409` documento duplicado, `404` não encontrado).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila sem erros.
- [x] `pnpm --filter api lint` — sem erros de lint.
- [x] `pnpm --filter api test` — `clients.service.spec.ts` passa.

#### Manual Verification (com a API rodando: `pnpm --filter api start:dev`)
- [ ] `POST /api/v1/clients` (com Bearer) cria cliente; resposta traz `ownerId` do token, não do body.
- [ ] `POST /clients` com CPF inválido → `400 "CPF inválido."`; com documento repetido → `409 "Já existe um cliente com este documento."`.
- [ ] `GET /clients?search=&status=&page=1&limit=20` retorna `{ data, meta }`; arquivados não aparecem.
- [ ] `POST /clients/:id/archive` seta `archivedAt`; o cliente some da listagem padrão.
- [ ] `GET/PATCH /clients/:id` de id inexistente → `404 "Cliente não encontrado."`.
- [ ] `ENDPOINTS.md` cobre os 5 endpoints.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: Backend — módulos Contacts e Activities (em camadas)

### Goal
Entregar Contacts (aninhado em cliente, com regra "único principal") e Activities (timeline + follow-ups + concluir), reutilizando os padrões de camadas e o `ClientsService` para validar a existência/posse do cliente.

### Changes

#### Módulo Contacts

**Create**: `apps/api/src/modules/contacts/domain/contact.repository.ts`
```ts
import type { Contact, Prisma } from '@prisma/client';

export const CONTACT_REPOSITORY = Symbol('CONTACT_REPOSITORY');

export interface ContactRepository {
  findManyByClient(clientId: string): Promise<Contact[]>;
  findById(id: string): Promise<Contact | null>;
  create(data: Prisma.ContactUncheckedCreateInput): Promise<Contact>;
  update(id: string, data: Prisma.ContactUpdateInput): Promise<Contact>;
  delete(id: string): Promise<void>;
  /** Desmarca isPrimary de todos os contatos do cliente (usado antes de marcar um novo principal). */
  clearPrimary(clientId: string, exceptId?: string): Promise<void>;
}
```

**Create**: `apps/api/src/modules/contacts/infra/prisma-contact.repository.ts`
Implementação Prisma. `findManyByClient` ordena por `isPrimary desc, name asc`. `clearPrimary` faz `updateMany({ where: { clientId, isPrimary: true, id: { not: exceptId } }, data: { isPrimary: false } })`.

**Create**: `apps/api/src/modules/contacts/api/dto/create-contact.dto.ts`
```ts
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsString({ message: 'O nome do contato é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
```

**Create**: `apps/api/src/modules/contacts/api/dto/update-contact.dto.ts` — `PartialType(CreateContactDto)`.

**Create**: `apps/api/src/modules/contacts/application/contacts.service.ts`
Regras:
- `list(ownerId, clientId)`: valida o cliente via `ClientsService.findOne(ownerId, clientId)` (garante posse) e delega ao repo.
- `create(ownerId, clientId, dto)`: valida cliente; se `isPrimary === true`, `clearPrimary(clientId)` antes de criar. Se for o **primeiro** contato do cliente, forçar `isPrimary = true`.
- `update(ownerId, contactId, dto)`: carrega contato (404 se não existe), valida posse do cliente via `ClientsService`; se `isPrimary` virou `true`, `clearPrimary(clientId, contactId)` antes.
- `delete(ownerId, contactId)`: valida posse; remove. (Contact→Client é a única FK sem `RESTRICT` relevante aqui; a exclusão de contato é permitida.)
```ts
// Injeção: @Inject(CONTACT_REPOSITORY) private repo, private clients: ClientsService
// "único principal" garantido em aplicação (não há constraint no banco).
```
> `ContactsModule` importa `ClientsModule` (que exporta `ClientsService`).

**Create**: `apps/api/src/modules/contacts/api/contacts.controller.ts`
Duas rotas aninhadas e duas de topo (o SPEC mistura níveis):
```ts
@Controller() // rotas com caminhos absolutos abaixo
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('clients/:clientId/contacts')
  list(@CurrentUserId() ownerId: string, @Param('clientId') clientId: string) {
    return this.contacts.list(ownerId, clientId);
  }
  @Post('clients/:clientId/contacts')
  create(@CurrentUserId() ownerId: string, @Param('clientId') clientId: string, @Body() dto: CreateContactDto) {
    return this.contacts.create(ownerId, clientId, dto);
  }
  @Patch('contacts/:id')
  update(@CurrentUserId() ownerId: string, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(ownerId, id, dto);
  }
  @Delete('contacts/:id')
  remove(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.contacts.delete(ownerId, id);
  }
}
```

**Create**: `apps/api/src/modules/contacts/contacts.module.ts` — importa `ClientsModule`; providers `ContactsService` + `{ provide: CONTACT_REPOSITORY, useClass: PrismaContactRepository }`.

#### Módulo Activities

**Create**: `apps/api/src/modules/activities/domain/activity.repository.ts`
```ts
export const ACTIVITY_REPOSITORY = Symbol('ACTIVITY_REPOSITORY');
export interface ActivityListFilter { clientId?: string; dealId?: string; skip: number; take: number; }
export interface ActivityRepository {
  findManyAndCount(filter: ActivityListFilter): Promise<{ data: Activity[]; total: number }>;
  findById(id: string): Promise<Activity | null>;
  create(data: Prisma.ActivityUncheckedCreateInput): Promise<Activity>;
  update(id: string, data: Prisma.ActivityUpdateInput): Promise<Activity>;
}
```

**Create**: `apps/api/src/modules/activities/infra/prisma-activity.repository.ts`
`findManyAndCount` filtra por `clientId`/`dealId` quando presentes, ordena `createdAt desc`, usa o índice `Activity(clientId, createdAt)`.

**Create**: `apps/api/src/modules/activities/api/dto/create-activity.dto.ts`
```ts
import { IsEnum, IsOptional, IsString, IsUUID, MinLength, IsDateString } from 'class-validator';
import { ActivityType } from '@prisma/client';

export class CreateActivityDto {
  @IsUUID('4', { message: 'Cliente inválido.' }) clientId: string;
  @IsOptional() @IsUUID('4') dealId?: string;
  @IsEnum(ActivityType, { message: 'Tipo de atividade inválido.' }) type: ActivityType;
  @IsString({ message: 'O conteúdo é obrigatório.' })
  @MinLength(1, { message: 'O conteúdo é obrigatório.' }) content: string;
  @IsOptional() @IsDateString({}, { message: 'Data agendada inválida.' }) scheduledFor?: string;
}
```

**Create**: `apps/api/src/modules/activities/api/dto/update-activity.dto.ts`
`PartialType(CreateActivityDto)` **omitindo** `clientId` (não se move atividade de cliente): usar `PartialType(OmitType(CreateActivityDto, ['clientId'] as const))` de `@nestjs/mapped-types`.

**Create**: `apps/api/src/modules/activities/api/dto/list-activities-query.dto.ts`
`extends PaginationQueryDto` + `@IsOptional() @IsUUID clientId?` + `@IsOptional() @IsUUID dealId?`.

**Create**: `apps/api/src/modules/activities/application/activities.service.ts`
Regras:
- `create(ownerId, dto)`: valida cliente via `ClientsService.findOne(ownerId, dto.clientId)`; cria com `scheduledFor` opcional (follow-up).
- `list(ownerId, query)`: se `clientId` informado, valida posse via `ClientsService`; retorna paginado `{ data, meta }`.
- `update(ownerId, id, dto)`: carrega atividade (404), valida posse do cliente, atualiza.
- `complete(ownerId, id)`: carrega atividade, valida posse, seta `completedAt = new Date()`.

**Create**: `apps/api/src/modules/activities/api/activities.controller.ts`
```ts
@Controller('activities')
export class ActivitiesController {
  @Get() list(@CurrentUserId() ownerId, @Query() q: ListActivitiesQueryDto) { ... }
  @Post() create(@CurrentUserId() ownerId, @Body() dto: CreateActivityDto) { ... }
  @Patch(':id') update(@CurrentUserId() ownerId, @Param('id') id, @Body() dto: UpdateActivityDto) { ... }
  @Post(':id/complete') complete(@CurrentUserId() ownerId, @Param('id') id) { ... }
}
```

**Create**: `apps/api/src/modules/activities/activities.module.ts` — importa `ClientsModule`; providers `ActivitiesService` + repo token.

#### Registro dos módulos

**Modify**: `apps/api/src/app.module.ts` — adicionar `ContactsModule` e `ActivitiesModule` aos `imports`.

#### Testes de service

**Create**: `apps/api/src/modules/contacts/application/contacts.service.spec.ts` — cobrir "primeiro contato vira principal", "marcar principal desmarca os outros" (verifica chamada a `clearPrimary`), 404 em contato inexistente, e posse via `ClientsService` mockado.

**Create**: `apps/api/src/modules/activities/application/activities.service.spec.ts` — cobrir criação validando cliente, `complete` setando `completedAt`, 404 em atividade inexistente.

#### Documentação de endpoints

**Modify**: `apps/api/ENDPOINTS.md` — seções `## Contacts` (4 rotas) e `## Activities` (4 rotas), formato fixo, pt-BR.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila sem erros.
- [x] `pnpm --filter api lint` — sem erros.
- [x] `pnpm --filter api test` — specs de contacts e activities passam.

#### Manual Verification
- [ ] `POST /clients/:id/contacts` — primeiro contato vira `isPrimary: true` automaticamente; ao marcar outro como principal, o anterior perde a flag.
- [ ] `PATCH/DELETE /contacts/:id` — funcionam; contato de cliente de outro dono → `404`.
- [ ] `POST /activities` com `type: FOLLOW_UP` e `scheduledFor` cria follow-up; `POST /activities/:id/complete` seta `completedAt`.
- [ ] `GET /activities?clientId=...` retorna timeline paginada em ordem `createdAt desc`.
- [ ] `ENDPOINTS.md` cobre Contacts e Activities.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4: Frontend — fundação + listagem de clientes

### Goal
Criar os helpers transversais (format, query-keys), a camada de API/tipos/hooks de clients, e a página de listagem paginada com busca e filtros, trocando o placeholder de `/clientes`.

### Changes

#### Helpers transversais

**Create**: `apps/web/src/lib/format.ts`
```ts
/** Formata CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) a partir dos dígitos. */
export function formatDocument(value?: string | null): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value;
}

/** Formata telefone BR: (00) 00000-0000 ou (00) 0000-0000. */
export function formatPhone(value?: string | null): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return value;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  return dateFmt.format(new Date(value));
}
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '';
  return dateTimeFmt.format(new Date(value));
}
```

**Create**: `apps/web/src/lib/query-keys.ts`
Convenção central de queryKeys (primeiro uso de Query no projeto).
```ts
export const queryKeys = {
  clients: {
    all: ['clients'] as const,
    list: (params: Record<string, unknown>) => ['clients', 'list', params] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
    contacts: (clientId: string) => ['clients', clientId, 'contacts'] as const,
  },
  activities: {
    byClient: (clientId: string) => ['activities', 'client', clientId] as const,
  },
} as const;
```

#### Tipos e API de clients

**Create**: `apps/web/src/features/clientes/api/types.ts`
Tipos espelhando o backend (enums importados como union types em pt-BR já traduzidos via labels; os valores crus vêm do schema).
```ts
export type PersonType = 'INDIVIDUAL' | 'COMPANY';
export type LeadSource = 'REFERRAL' | 'PAID_TRAFFIC' | 'ORGANIC' | 'OUTBOUND' | 'OTHER';
export type ClientStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'LOST';
export type ActivityType = 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'WHATSAPP' | 'FOLLOW_UP';

export interface Client {
  id: string; name: string; tradeName?: string | null; personType: PersonType;
  document?: string | null; email?: string | null; phone?: string | null; website?: string | null;
  source?: LeadSource | null; status: ClientStatus; tags: string[]; notes?: string | null;
  zipCode?: string | null; street?: string | null; number?: string | null; complement?: string | null;
  district?: string | null; city?: string | null; state?: string | null;
  archivedAt?: string | null; createdAt: string; updatedAt: string;
}
export interface Contact {
  id: string; clientId: string; name: string; role?: string | null;
  email?: string | null; phone?: string | null; isPrimary: boolean;
}
export interface Activity {
  id: string; clientId: string; dealId?: string | null; type: ActivityType;
  content: string; scheduledFor?: string | null; completedAt?: string | null; createdAt: string;
}
export interface PageMeta { total: number; page: number; limit: number; }
export interface Paginated<T> { data: T[]; meta: PageMeta; }

export interface ListClientsParams {
  page?: number; limit?: number; search?: string; status?: ClientStatus; source?: LeadSource;
}
```

**Create**: `apps/web/src/features/clientes/api/clients.api.ts`
Funções que consomem `@/lib/api` (axios).
```ts
import { api } from '@/lib/api';
import type { Client, Contact, Activity, Paginated, ListClientsParams } from './types';

export const clientsApi = {
  list: (params: ListClientsParams) =>
    api.get<Paginated<Client>>('/clients', { params }).then((r) => r.data),
  get: (id: string) => api.get<Client>(`/clients/${id}`).then((r) => r.data),
  create: (body: Partial<Client>) => api.post<Client>('/clients', body).then((r) => r.data),
  update: (id: string, body: Partial<Client>) =>
    api.patch<Client>(`/clients/${id}`, body).then((r) => r.data),
  archive: (id: string) => api.post<Client>(`/clients/${id}/archive`).then((r) => r.data),
  // contacts
  listContacts: (clientId: string) =>
    api.get<Contact[]>(`/clients/${clientId}/contacts`).then((r) => r.data),
  createContact: (clientId: string, body: Partial<Contact>) =>
    api.post<Contact>(`/clients/${clientId}/contacts`, body).then((r) => r.data),
  updateContact: (id: string, body: Partial<Contact>) =>
    api.patch<Contact>(`/contacts/${id}`, body).then((r) => r.data),
  deleteContact: (id: string) => api.delete(`/contacts/${id}`).then((r) => r.data),
  // activities
  listActivities: (clientId: string) =>
    api.get<Paginated<Activity>>('/activities', { params: { clientId, limit: 100 } }).then((r) => r.data),
  createActivity: (body: Partial<Activity>) =>
    api.post<Activity>('/activities', body).then((r) => r.data),
  completeActivity: (id: string) =>
    api.post<Activity>(`/activities/${id}/complete`).then((r) => r.data),
};
```

**Create**: `apps/web/src/features/clientes/api/hooks.ts`
Hooks TanStack Query — estabelecem a convenção de invalidação.
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { clientsApi } from './clients.api';
import type { Client, ListClientsParams } from './types';

export function useClients(params: ListClientsParams) {
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: () => clientsApi.list(params),
  });
}
export function useClient(id: string) {
  return useQuery({ queryKey: queryKeys.clients.detail(id), queryFn: () => clientsApi.get(id) });
}
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Client>) => clientsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}
export function useUpdateClient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Client>) => clientsApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clients.all });
      qc.invalidateQueries({ queryKey: queryKeys.clients.detail(id) });
    },
  });
}
export function useArchiveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientsApi.archive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}
```
> Hooks de contatos e atividades (`useContacts`, `useActivities`, etc.) serão adicionados a este arquivo na Fase 6.

#### Página de listagem

**Create**: `apps/web/src/features/clientes/ClientesListPage.tsx`
Página com: título "Clientes" + botão "Novo cliente" (abre o `Sheet` da Fase 5 — na Fase 4 pode ser um botão desabilitado ou já integrado se as fases forem sequenciais); barra de filtros (busca com debounce, `Select` de status, `Select` de origem — opções traduzidas via `@/lib/labels`); `Table` com colunas Nome, Documento, Status (Badge), Origem, Criado em; `TableLink` no nome → `/clientes/:id`; `TableEmpty` quando vazio; `Skeleton` no carregamento; paginação (anterior/próxima + "página X de N", derivado de `meta`). Estado dos filtros em `useState`, passado ao `useClients`.
```tsx
// Esqueleto:
const [search, setSearch] = useState('');
const [status, setStatus] = useState<ClientStatus | undefined>();
const [source, setSource] = useState<LeadSource | undefined>();
const [page, setPage] = useState(1);
const debounced = useDebouncedValue(search, 300); // criar hook simples em hooks/ ou inline
const { data, isLoading } = useClients({ page, limit: 20, search: debounced || undefined, status, source });
// Badge de status: variantes → LEAD=secondary, ACTIVE=default, INACTIVE=outline, LOST=destructive
// Nome sempre via translate* de @/lib/labels; document via formatDocument.
```
Mapa de variante do Badge por status (helper local ou em `labels`):
```ts
const STATUS_BADGE: Record<ClientStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  LEAD: 'secondary', ACTIVE: 'default', INACTIVE: 'outline', LOST: 'destructive',
};
```

**Create** (se necessário): `apps/web/src/hooks/use-debounced-value.ts` — hook genérico de debounce (reutilizável).

#### Rota

**Modify**: `apps/web/src/routes/router.tsx` (linha 16)
Trocar o placeholder de `/clientes`:
```tsx
import ClientesListPage from '@/features/clientes/ClientesListPage';
// ...
{ path: '/clientes', element: <ClientesListPage /> },
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — compila (tsc + vite) sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification (com API + web rodando)
- [ ] `/clientes` lista clientes reais da API, paginados; navegação de páginas funciona.
- [ ] Busca por nome/documento filtra (com debounce); `Select` de status e origem filtram; opções exibidas em pt-BR (nunca enum cru).
- [ ] Status renderizado como `Badge` traduzido; documento formatado (CPF/CNPJ).
- [ ] Estado vazio (`TableEmpty`) e carregando (`Skeleton`) aparecem corretamente.
- [ ] Clicar no nome (`TableLink`) navega para `/clientes/:id`.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 5.

---

## Phase 5: Frontend — formulário de criar/editar cliente

### Goal
Formulário RHF+Zod (pt-BR) em `Sheet` para criar e editar cliente, cobrindo todos os campos (incluindo endereço), com selects traduzidos, invalidação de cache e toasts.

### Changes

**Create**: `apps/web/src/features/clientes/ClientFormSheet.tsx`
`Sheet` lateral com formulário. Props: `{ open, onOpenChange, client? }` (sem `client` = criação; com = edição). Schema Zod pt-BR; ao submeter, usa `useCreateClient`/`useUpdateClient`; sucesso → `toast.success('Cliente criado.' | 'Cliente atualizado.')`, fecha o Sheet; erro → `toast.error` com a mensagem da API (extrair `error.response.data.message`).
```tsx
const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  tradeName: z.string().optional(),
  personType: z.enum(['INDIVIDUAL', 'COMPANY']),
  document: z.string().optional(),
  email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
  source: z.enum(['REFERRAL','PAID_TRAFFIC','ORGANIC','OUTBOUND','OTHER']).optional(),
  status: z.enum(['LEAD','ACTIVE','INACTIVE','LOST']),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  zipCode: z.string().optional(), street: z.string().optional(), number: z.string().optional(),
  complement: z.string().optional(), district: z.string().optional(),
  city: z.string().optional(), state: z.string().optional(),
});
```
Layout: usar `Field`/`FieldGroup`/`FieldLabel`/`FieldError`/`Input` (padrão do `LoginPage`); `Select` (Base UI) para `personType`, `source`, `status`, com `SelectItem` cujos textos vêm de `PERSON_TYPE_LABELS`/`LEAD_SOURCE_LABELS`/`CLIENT_STATUS_LABELS`. Campos de endereço agrupados sob um subtítulo "Endereço". Tags: input simples separado por vírgula → `string[]` (ou um input de chips simples). Botão submit com `Spinner` quando `isPending`/`isSubmitting`.
> Enviar `email: ''` como `undefined` (o backend rejeita `''` no `@IsEmail`); normalizar campos vazios para `undefined` antes do submit.

**Modify**: `apps/web/src/features/clientes/ClientesListPage.tsx`
Integrar o `ClientFormSheet`: botão "Novo cliente" abre o sheet em modo criação; estado `const [formOpen, setFormOpen] = useState(false)`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] "Novo cliente" abre o `Sheet`; criar cliente válido → toast de sucesso, sheet fecha, listagem atualiza (invalidação).
- [ ] Validações Zod aparecem em pt-BR inline; CPF/CNPJ inválido retornado pela API vira `toast.error` em pt-BR; documento duplicado → toast de conflito.
- [ ] Selects de tipo/origem/status mostram rótulos traduzidos.
- [ ] Editar cliente existente (via botão na ficha, Fase 6, ou temporariamente na listagem) preenche o form e persiste.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 6.

---

## Phase 6: Frontend — ficha do cliente (Dados + Contatos + Timeline)

### Goal
Tela `/clientes/:id` com cabeçalho (nome, status, ações), `SectionTabs` (Dados, Contatos, Timeline reais + Propostas/Projetos/Contratos placeholder), CRUD de contatos inline (com "marcar principal"), timeline de atividades (criar, follow-up, concluir) e arquivamento via `ConfirmDialog`.

### Changes

#### Hooks adicionais

**Modify**: `apps/web/src/features/clientes/api/hooks.ts`
Adicionar: `useContacts(clientId)`, `useCreateContact(clientId)`, `useUpdateContact(clientId)`, `useDeleteContact(clientId)` (invalidam `queryKeys.clients.contacts(clientId)`); `useActivities(clientId)`, `useCreateActivity(clientId)`, `useCompleteActivity(clientId)` (invalidam `queryKeys.activities.byClient(clientId)`).

#### Layout da ficha (rotas aninhadas)

**Create**: `apps/web/src/features/clientes/ClienteDetalheLayout.tsx`
Carrega o cliente (`useClient(id)`), renderiza o cabeçalho (nome + `tradeName`, `Badge` de status, botões "Editar" → abre `ClientFormSheet` em modo edição, "Arquivar" → `ConfirmDialog`), o `SectionTabs` e um `<Outlet context={client} />`. Estados de carregamento (`Skeleton`) e 404 (`Empty` "Cliente não encontrado."). Arquivar usa `useArchiveClient` → `toast.success('Cliente arquivado.')` e navega para `/clientes`.
```tsx
const tabs: SectionTabItem[] = [
  { label: 'Dados', to: `/clientes/${id}`, end: true },
  { label: 'Contatos', to: `/clientes/${id}/contatos` },
  { label: 'Timeline', to: `/clientes/${id}/timeline` },
  { label: 'Propostas', to: `/clientes/${id}/propostas` },
  { label: 'Projetos', to: `/clientes/${id}/projetos` },
  { label: 'Contratos', to: `/clientes/${id}/contratos` },
];
```

**Create**: `apps/web/src/features/clientes/tabs/DadosTab.tsx`
Lê `client` de `useOutletContext`; exibe os dados em seções (Identificação, Contato, Endereço, Tags, Observações), com `formatDocument`/`formatPhone`/`translate*`. Campos vazios com placeholder "—".

**Create**: `apps/web/src/features/clientes/tabs/ContatosTab.tsx`
Lista contatos (`useContacts`), botão "Novo contato" (form inline ou pequeno `Dialog`), editar/excluir por linha (`ConfirmDialog` na exclusão), ação "Tornar principal" (`useUpdateContact` com `isPrimary: true`); contato principal destacado com `Badge`.

**Create**: `apps/web/src/features/clientes/tabs/TimelineTab.tsx`
Form de nova atividade (Select de `type` traduzido via `ACTIVITY_TYPE_LABELS`, textarea de `content`, e `scheduledFor` opcional quando `type === 'FOLLOW_UP'`); lista cronológica (`useActivities`) com ícone/label do tipo, `formatDateTime(createdAt)`, e para follow-ups pendentes (`scheduledFor` e sem `completedAt`) um botão "Concluir" (`useCompleteActivity`).

**Create**: `apps/web/src/features/clientes/tabs/PlaceholderTab.tsx`
Componente simples reutilizado por Propostas/Projetos/Contratos: `Empty` com mensagem "Em breve — disponível em uma próxima fase.".

#### Rotas aninhadas

**Modify**: `apps/web/src/routes/router.tsx` (linha 17)
Trocar `/clientes/:id` por rota com filhos:
```tsx
import ClienteDetalheLayout from '@/features/clientes/ClienteDetalheLayout';
import DadosTab from '@/features/clientes/tabs/DadosTab';
import ContatosTab from '@/features/clientes/tabs/ContatosTab';
import TimelineTab from '@/features/clientes/tabs/TimelineTab';
import PlaceholderTab from '@/features/clientes/tabs/PlaceholderTab';
// ...
{
  path: '/clientes/:id',
  element: <ClienteDetalheLayout />,
  children: [
    { index: true, element: <DadosTab /> },
    { path: 'contatos', element: <ContatosTab /> },
    { path: 'timeline', element: <TimelineTab /> },
    { path: 'propostas', element: <PlaceholderTab title="Propostas" /> },
    { path: 'projetos', element: <PlaceholderTab title="Projetos" /> },
    { path: 'contratos', element: <PlaceholderTab title="Contratos" /> },
  ],
},
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] `/clientes/:id` mostra cabeçalho com nome + `Badge` de status; abas navegam (Dados/Contatos/Timeline reais; Propostas/Projetos/Contratos mostram "Em breve").
- [ ] Aba Dados exibe todos os campos formatados (documento, telefone, endereço) e enums traduzidos.
- [ ] Contatos: criar, editar, excluir; "Tornar principal" marca um e desmarca os demais; primeiro contato já vem principal.
- [ ] Timeline: criar atividade (nota/ligação/etc.); criar follow-up com data; "Concluir" marca `completedAt` e some da lista de pendentes.
- [ ] "Editar" abre o `ClientFormSheet` preenchido; "Arquivar" pede confirmação, arquiva e volta para `/clientes`.
- [ ] Nenhuma mensagem/label em inglês; nenhum enum cru na tela.

**⏸ PAUSE**: Fase final — confirmação humana de todos os fluxos.

---

## Testing Strategy

### Unit Tests
- **`clients.service.spec.ts`**: `ownerId` derivado; documento inválido (`400`); duplicado (`409`); `404` em findOne/update/archive; paginação passa `skip/take` corretos ao repo.
- **`contacts.service.spec.ts`**: primeiro contato vira principal; marcar principal desmarca os demais (`clearPrimary`); `404`; posse via `ClientsService`.
- **`activities.service.spec.ts`**: criação valida cliente; `complete` seta `completedAt`; `404`.
- **`shared/document.ts`**: casos válidos/ inválidos de CPF e CNPJ (dígitos verificadores, sequências repetidas, tamanho errado) — vale um spec dedicado.

### Integration Tests
- Fluxo manual documentado nos "Manual Verification" de cada fase (a Fase 0 não introduziu e2e; manter manual nesta fase, sem introduzir framework e2e novo).
- Cross-module: Contacts/Activities dependem de `ClientsService` (posse). Verificar que cliente de outro `ownerId` retorna `404` (não `403`, para não vazar existência).

### Migration & Rollback
- **Aplicar**: `pnpm --filter api exec prisma migrate dev` (dev) / `prisma migrate deploy` (ambientes). A migration só **adiciona** colunas opcionais e índices — sem perda de dados, retrocompatível.
- **Rollback**: reverter o commit e criar migration inversa (`DROP COLUMN`/`DROP INDEX`) se necessário; como as colunas são nulas e novas, o risco é baixo.

## Environment Considerations
- **CI/CD**: nenhum passo novo além dos já existentes (`build`/`lint`/`test`). A migration precisa rodar (`migrate deploy`) antes do deploy da API.
- **Migrations**: 1 migration nova (Fase 1).
- **Config/Secrets**: nenhuma variável nova. `VITE_API_URL` já aponta para `http://localhost:3000/api/v1`.
- **Multi-environment**: sem diferenças; Postgres local na porta host **5435** (Docker).

## Dependencies & Risks
- **`@nestjs/mapped-types`** (`PartialType`/`OmitType`): confirmar presença; se ausente, `pnpm --filter api add @nestjs/mapped-types` (é a única dependência potencialmente nova).
- **Ordem das fases**: Fase 1 (schema) bloqueia todo o resto; Fase 2 estabelece `shared/` + padrões reutilizados por 3 e 6; frontend (4-6) depende do backend (2-3) estar de pé para verificação manual.
- **Regra "único principal"** é garantida só em aplicação (sem constraint no banco) — cobrir bem no teste de service para evitar regressão.
- **`updateMany` + `findFirstOrThrow`** no repo de Client: duas queries; aceitável para volume single-tenant. Alternativa (`update` com `where` composto) exigiria `@@unique`; manter a abordagem simples.

## References
- PRD: `specs/research/2026-07-21-fase-1-clientes.md`
- Fase 0: `specs/plans/2026-07-20-fase-0-fundacao.md` (`status: implemented`)
- SPEC: `SPEC.md` §3.1 (Clientes), §3.5 (Atividades), §5 (endpoints/convenções)
- Regras: `CLAUDE.md` (raiz), `apps/api/CLAUDE.md` (camadas/ENDPOINTS.md), `apps/web/CLAUDE.md` (features/Query/labels)
