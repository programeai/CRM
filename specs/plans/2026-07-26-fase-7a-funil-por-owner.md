---
date: 2026-07-26T18:40:00-03:00
author: claude
source_prd: specs/research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md
git_commit: 7bcd8df2b37bc9f9d5362835c8e327a863ba364d
branch: main
status: implemented
tags: [spec, pipeline, rls, prisma, migration, users, dashboard]
---

# Spec: Fase 7A — Funil por owner (`PipelineStage.ownerId` + RLS)

## Overview

`PipelineStage` é hoje a **única** tabela de negócio sem `ownerId`, sem policy de RLS e com
`name @unique` global. Numa instância multi-owner — que é o que o produto virou em 2026-07-25 com
colaboradores e papéis, e que já roda em produção com autocadastro aberto — renomear, reordenar ou
excluir um estágio afeta **todos** os owners, e dois owners não podem ter estágios de mesmo nome.
Esta fase resgata um débito datado e declarado (`specs/research/2026-07-23-rls-por-ownerid.md:202`:
"escopar depois, se virar multiusuário real").

A estratégia é a de sempre neste repositório: `ownerId` como coluna denormalizada com FK
`ON DELETE CASCADE`, unique composta `(ownerId, name)`, policy `owner_isolation` com
`USING == WITH CHECK` e `FORCE ROW LEVEL SECURITY` (fail-closed), e filtro explícito de `ownerId`
nos repositórios como defesa em profundidade. A migration é **escrita à mão** — o Prisma emitiria
`ADD COLUMN ... NOT NULL` (que falha em banco com dados) e não faria a replicação por owner nem o
religamento dos `Deal`.

O provisionamento dos 7 estágios padrão sai da instância (a migration `0e80664`, com guard global
`WHERE NOT EXISTS`) e passa para a **criação da conta**, no mesmo nested create atômico que já cria
`Subscription` e o papel `Administrador`. Sem isso, uma conta criada depois deste deploy nasceria com
zero estágios e `firstStage()` responderia "Nenhum estágio configurado." na primeira oportunidade.

## Current State

- `model PipelineStage` ([schema.prisma:183-190](../../apps/api/prisma/schema.prisma#L183-L190)):
  `id`, `name @unique`, `order`, `isWon`, `isLost`, `deals Deal[]`. Sem `ownerId`, sem índice, sem
  relação com `User`.
- DDL: índice único `PipelineStage_name_key`; FK `Deal_stageId_fkey ... ON DELETE RESTRICT`
  (`20260721002325_init/migration.sql:247,277`).
- `Deal.ownerId` é coluna `TEXT NOT NULL` **sem FK** (a migration de denormalização criou apenas
  coluna + índice) — a integridade owner↔deal não é garantida pelo banco hoje.
- Os 9 métodos de
  [prisma-pipeline-stage.repository.ts](../../apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts)
  são globais; nenhuma assinatura da porta nem do service recebe `ownerId`; o controller não injeta
  `@CurrentOwnerId()` e o `GET` não tem `@RequirePermission`.
- Consumidores acoplados ao funil global: `deals.service.ts:54-56,102`, `proposals.service.ts:249`,
  `prisma-dashboard.repository.ts:22`, `prisma/seed.ts:112`.
- Os 7 estágios padrão estão **duplicados** entre `prisma/seed.ts:102-110` e a migration
  `20260725130000_seed_default_pipeline_stages`.

Detalhes completos no PRD.

## Desired End State

1. `PipelineStage` tem `ownerId TEXT NOT NULL` com FK para `User` (`ON DELETE CASCADE`), índice
   `PipelineStage_ownerId_idx`, unique `(ownerId, name)` e policy `owner_isolation` com
   `ENABLE`+`FORCE ROW LEVEL SECURITY`. O índice único global `PipelineStage_name_key` não existe
   mais.
2. Cada owner que existia antes do deploy tem a **sua** cópia dos estágios que estavam na tabela
   (preservando `name`, `order`, `isWon`, `isLost` — não os 7 padrões presumidos), e cada `Deal`
   aponta para a cópia do seu próprio `ownerId`. Zero linhas com `ownerId` nulo.
3. Toda leitura e escrita de estágio passa por `ownerId`: os 10 métodos da porta, o service, o
   controller (`@CurrentOwnerId()`), e os consumidores `DealsService`, `ProposalsService` e
   `PrismaDashboardRepository`.
4. Conta nova (senha ou OAuth) nasce com os 7 estágios padrão, criados no mesmo nested create de
   `Subscription`/`ownedRoles`, a partir de uma **constante única** em
   `apps/api/src/shared/default-pipeline-stages.ts` — consumida também pelo `prisma/seed.ts`.
5. `PATCH /pipeline-stages/reorder` rejeita com `422` uma lista de ids que não seja exatamente o
   conjunto de estágios do owner (hoje um id inexistente ou de outro owner estoura `P2025` cru
   dentro de um `Promise.all`, virando `500`).
6. `GET /pipeline-stages` exige `oportunidade:ver` ou `oportunidade:gerenciar`.
7. `ENDPOINTS.md`, `SPEC.md` (§1.3, §4, §6.4, §7) e `ROADMAP.md` (Fase 7) refletem o novo estado, e o
   comentário de `20260724050000_enable_rls/migration.sql:2` deixa de afirmar que estágios são
   globais.

## What We're NOT Doing

- **Toda a Frente B** (`assigneeId` em `Deal`/`Task`/`Activity`/`Client`, permissões de escopo por
  registro, filtros por responsável, boards e dashboard por pessoa) — plano separado, por decisão de
  escopo. As decisões de produto já tomadas para ele estão registradas em
  [Decisões registradas para a Frente B](#decisões-registradas-para-a-frente-b), no fim deste
  documento, para não se perderem.
- **Frontend**: nenhuma mudança. `PipelineStage` em
  [apps/web/src/features/pipeline/api/types.ts:6-12](../../apps/web/src/features/pipeline/api/types.ts#L6-L12)
  não declara `ownerId` e não precisa declarar — a API passa a devolver o campo e o tipo o ignora. Os
  dois consumidores de `useStages()` (`PipelineBoardPage`, `StageConfigDialog`) já estão atrás do
  `PermissionRoute` com as chaves de pipeline, então o `@RequirePermission` novo no `GET` não fecha
  nenhuma tela que já funcionava.
- **Interface de configuração de estágios em página própria** — segue no `StageConfigDialog`.
- **Estágio "template" compartilhado entre owners** ou herança de funil — o funil de cada owner é
  independente a partir da criação da conta.
- **Retirar a migration `20260725130000_seed_default_pipeline_stages`** — migration aplicada não se
  reescreve. Ela continua no histórico e o guard global dela vira inócuo (a tabela nunca mais fica
  vazia num banco com owners).
- **FK em `Deal.ownerId`** — a assimetria com as outras tabelas de negócio existe hoje e sai do
  escopo desta fase (mas o guard da migration, abaixo, verifica a invariante antes de confiar nela).

---

## Fase 1: Estágios por owner no banco e no backend

### Goal

`PipelineStage` passa a ser dado por owner, isolado por RLS, com todo o caminho de leitura/escrita
recebendo `ownerId` — e os estágios existentes replicados por owner com os `Deal` religados.

> **Por que banco e backend na mesma fase:** ao aplicar a migration e rodar `prisma generate`, o
> `PipelineStageUncheckedCreateInput` passa a exigir `ownerId` e `findUnique({ where: { name } })`
> deixa de existir — o build da API quebra. Não há ponto intermediário verificável entre os dois, e
> as duas partes vão no mesmo commit.

### Changes

#### 1.1 Prisma schema

**Modify**: `apps/api/prisma/schema.prisma`

Substituir o modelo (linhas 183-190). Relação **sem nome**: é a única relação entre `PipelineStage`
e `User` (diferente de `Role`, que precisa de `"OwnerRoles"` porque tem também `users User[]`).

```prisma
// Estágios do funil, por owner. Cada owner tem o seu conjunto (criado junto com
// a conta — ver UsersService) e o configura livremente, sem afetar ninguém:
// `@@unique([ownerId, name])` permite dois owners com um "Negociação" cada.
// Tem RLS por ownerId (ver migration 20260726120000_pipeline_stages_per_owner).
model PipelineStage {
  id      String  @id @default(uuid())
  ownerId String
  owner   User    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name    String
  order   Int
  isWon   Boolean @default(false)
  isLost  Boolean @default(false)
  deals   Deal[]

  @@unique([ownerId, name])
  @@index([ownerId])
}
```

Adicionar a back-relation em `model User`, junto de `ownedRoles` (linha 38):

```prisma
  ownedRoles       Role[]         @relation("OwnerRoles")
  pipelineStages   PipelineStage[]
  invites          CollaboratorInvite[]
```

#### 1.2 Migration escrita à mão

Gerar o diretório vazio e escrever o SQL à mão (o diff automático do Prisma não serve):

```bash
pnpm --filter api exec prisma migrate dev --create-only --name pipeline_stages_per_owner
```

**Create**: `apps/api/prisma/migrations/20260726120000_pipeline_stages_per_owner/migration.sql`

> Use o timestamp real que o Prisma gerar no nome do diretório; `20260726120000` aqui é ilustrativo.
> O que importa é ficar **depois** de `20260725130000_seed_default_pipeline_stages`.

```sql
-- Estágios do funil deixam de ser um catálogo global da instância e passam a ser
-- dado por owner, com RLS. Resgata o débito declarado em
-- specs/research/2026-07-23-rls-por-ownerid.md:202.
--
-- Notas de projeto:
--  * ownerId é TEXT → comparação texto=texto, SEM cast ::uuid.
--  * PipelineStage.id é TEXT (@default(uuid())) → gen_random_uuid()::text.
--  * Roda como crm_user (superuser), que bypassa RLS — não é preciso setar
--    app.owner_id aqui.
--  * A ordem é obrigatória: criar as cópias → religar os Deal → apagar as
--    originais. Deal_stageId_fkey é ON DELETE RESTRICT; inverter viola a FK.

-- ===========================================================================
-- 0. Guard de integridade
-- ===========================================================================
-- Deal.ownerId é coluna sem FK: nada no banco garante que aponta para um owner
-- real. A replicação abaixo parte de `User WHERE "ownerId" IS NULL`, então um
-- Deal com ownerId fora desse conjunto ficaria sem cópia de estágio para onde
-- apontar — e o DELETE do passo 4 estouraria na FK no meio da migration.
-- Melhor abortar aqui, com mensagem clara.
DO $$
DECLARE orfaos INT;
BEGIN
  SELECT count(*) INTO orfaos
    FROM "Deal" d
   WHERE NOT EXISTS (
     SELECT 1 FROM "User" u WHERE u."id" = d."ownerId" AND u."ownerId" IS NULL
   );
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % oportunidade(s) com "ownerId" que não corresponde a um owner em "User". Corrija os dados antes de aplicar.',
      orfaos;
  END IF;
END $$;

-- ===========================================================================
-- 1. Coluna nullable (o ADD COLUMN NOT NULL do Prisma falharia com dados)
-- ===========================================================================
ALTER TABLE "PipelineStage" ADD COLUMN "ownerId" TEXT;

-- ===========================================================================
-- 2. Template de partida
-- ===========================================================================
-- As linhas com "ownerId" nulo são o catálogo global que existe hoje (plantado
-- por 20260725130000_seed_default_pipeline_stages, possivelmente já renomeado /
-- reordenado / acrescido por quem chegou primeiro). Se a tabela estiver vazia
-- (ex.: banco recriado do zero, sem owners ainda), planta os 7 padrões para a
-- replicação ter de onde partir — sem owner, os passos 3-4 não fazem nada e o
-- passo 4 limpa tudo, deixando a tabela vazia e correta.
INSERT INTO "PipelineStage" ("id", "name", "order", "isWon", "isLost")
SELECT gen_random_uuid()::text, v.name, v.ordem, v.is_won, v.is_lost
FROM (VALUES
  ('Novo lead',            0, false, false),
  ('Contato feito',        1, false, false),
  ('Reunião/Diagnóstico',  2, false, false),
  ('Proposta enviada',     3, false, false),
  ('Negociação',           4, false, false),
  ('Ganhou',               5, true,  false),
  ('Perdeu',               6, false, true)
) AS v(name, ordem, is_won, is_lost)
WHERE NOT EXISTS (SELECT 1 FROM "PipelineStage");

-- ===========================================================================
-- 3. Replicar o template por owner
-- ===========================================================================
-- `WHERE u."ownerId" IS NULL` é o predicado canônico de "é owner" (colaborador
-- tem ownerId preenchido e herda o funil do owner, não ganha o próprio).
-- Owner sem nenhum deal também recebe: a origem é "User", não "Deal".
-- O CTE lê o snapshot do início da statement, então não enxerga as linhas que
-- este próprio INSERT cria.
WITH owners AS (
  SELECT "id" AS owner_id FROM "User" WHERE "ownerId" IS NULL
),
template AS (
  SELECT "name", "order", "isWon", "isLost"
    FROM "PipelineStage"
   WHERE "ownerId" IS NULL
)
INSERT INTO "PipelineStage" ("id", "ownerId", "name", "order", "isWon", "isLost")
SELECT gen_random_uuid()::text, o.owner_id, t."name", t."order", t."isWon", t."isLost"
  FROM owners o
 CROSS JOIN template t;

-- ===========================================================================
-- 4. Religar cada Deal à cópia do seu próprio owner
-- ===========================================================================
-- O casamento é por "name": o índice único global PipelineStage_name_key ainda
-- existe neste ponto (só cai no passo 6), então cada nome ocorre uma única vez
-- no template e o join produz exatamente uma linha por deal.
UPDATE "Deal" d
   SET "stageId" = clone."id"
  FROM "PipelineStage" orig
  JOIN "PipelineStage" clone ON clone."name" = orig."name"
 WHERE d."stageId"     = orig."id"
   AND orig."ownerId"  IS NULL
   AND clone."ownerId" = d."ownerId";

-- Nenhum Deal aponta mais para o template → a FK ON DELETE RESTRICT não bloqueia.
DELETE FROM "PipelineStage" WHERE "ownerId" IS NULL;

-- ===========================================================================
-- 5. NOT NULL + índice + FK
-- ===========================================================================
ALTER TABLE "PipelineStage" ALTER COLUMN "ownerId" SET NOT NULL;
CREATE INDEX "PipelineStage_ownerId_idx" ON "PipelineStage"("ownerId");
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 6. Unique global → unique composta
-- ===========================================================================
DROP INDEX "PipelineStage_name_key";
CREATE UNIQUE INDEX "PipelineStage_ownerId_name_key" ON "PipelineStage"("ownerId", "name");

-- ===========================================================================
-- 7. RLS por ownerId (molde de 20260724050000_enable_rls)
-- ===========================================================================
--  * current_setting('app.owner_id', true): o `true` é missing_ok → contexto
--    ausente vira NULL → policy casa zero linhas (FAIL-CLOSED), nunca erro.
--  * USING e WITH CHECK idênticos: leitura e escrita presas ao mesmo owner.
--  * FORCE: sujeita até o dono da tabela; crm_user (superuser) continua
--    bypassando por ser superuser — é o que mantém migrations e seed.
ALTER TABLE "PipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineStage" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "PipelineStage"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- GRANT explícito para a role da aplicação. O ALTER DEFAULT PRIVILEGES de
-- 20260724040000_create_app_role já cobre, mas repetimos para a migration ser
-- autossuficiente em bancos provisionados à mão.
GRANT SELECT, INSERT, UPDATE, DELETE ON "PipelineStage" TO crm_app;
```

**Se o guard do passo 0 disparar** em produção, a remediação é decidir o destino desses deals antes
de reaplicar. Diagnóstico:

```sql
SELECT d."ownerId", count(*)
  FROM "Deal" d
 WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = d."ownerId" AND u."ownerId" IS NULL)
 GROUP BY 1;
```

#### 1.3 Porta do repositório

**Modify**: `apps/api/src/modules/pipeline/domain/pipeline-stage.repository.ts`

Todo método passa a receber `ownerId`. A convenção de ordem dos parâmetros segue a que já existe nos
repositórios do projeto (`ClientRepository.findById(id, ownerId)`,
`PrismaCollaboratorRepository.findByIdAndOwner(id, ownerId)`): **`ownerId` depois do `id`** quando há
um id, e primeiro quando não há. `findAllIds` é novo (usado pela validação de `reorder`, Fase 3).

```ts
import type { PipelineStage, Prisma } from '@prisma/client';

export const PIPELINE_STAGE_REPOSITORY = Symbol('PIPELINE_STAGE_REPOSITORY');

/**
 * Estágios são dado do owner (RLS por ownerId). O filtro explícito aqui é
 * defesa em profundidade: a policy já fecha, mas o repositório não depende de
 * o contexto da transação ter sido setado.
 */
export interface PipelineStageRepository {
  findAllOrdered(ownerId: string): Promise<PipelineStage[]>;
  /** Ids de todos os estágios do owner — valida o payload de `reorder`. */
  findAllIds(ownerId: string): Promise<string[]>;
  findById(id: string, ownerId: string): Promise<PipelineStage | null>;
  findByName(ownerId: string, name: string): Promise<PipelineStage | null>;
  /** `data` já carrega `ownerId` (UncheckedCreateInput). */
  create(
    data: Prisma.PipelineStageUncheckedCreateInput,
  ): Promise<PipelineStage>;
  update(
    id: string,
    ownerId: string,
    data: Prisma.PipelineStageUncheckedUpdateManyInput,
  ): Promise<PipelineStage>;
  delete(id: string, ownerId: string): Promise<void>;
  /** Maior `order` atual do owner (ou -1 se não houver estágios). */
  maxOrder(ownerId: string): Promise<number>;
  /** Quantos deals do owner apontam para este estágio (guard de exclusão). */
  countDeals(stageId: string, ownerId: string): Promise<number>;
  /** Reatribui `order` sequencial na ordem dos ids, na transação do request. */
  reorder(ownerId: string, ids: string[]): Promise<void>;
}
```

#### 1.4 Implementação Prisma

**Modify**: `apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts`

Reescrever o arquivo inteiro. Notas: `findByName` usa a unique composta
(`where: { ownerId_name: { ownerId, name } }` — mesma forma de `seed.ts:71` e
`users.service.ts:68`); `update`/`delete`/`reorder` usam `updateMany`/`deleteMany` para carregar o
filtro de `ownerId` (padrão de `PrismaClientRepository.update`).

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

@Injectable()
export class PrismaPipelineStageRepository implements PipelineStageRepository {
  constructor(private prisma: PrismaService) {}

  findAllOrdered(ownerId: string) {
    return this.prisma.db.pipelineStage.findMany({
      where: { ownerId },
      orderBy: { order: 'asc' },
    });
  }

  async findAllIds(ownerId: string) {
    const rows = await this.prisma.db.pipelineStage.findMany({
      where: { ownerId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  findById(id: string, ownerId: string) {
    // findFirst (não findUnique): o filtro por ownerId faz parte da busca.
    return this.prisma.db.pipelineStage.findFirst({ where: { id, ownerId } });
  }

  findByName(ownerId: string, name: string) {
    return this.prisma.db.pipelineStage.findUnique({
      where: { ownerId_name: { ownerId, name } },
    });
  }

  create(data: Prisma.PipelineStageUncheckedCreateInput) {
    return this.prisma.db.pipelineStage.create({ data });
  }

  update(
    id: string,
    ownerId: string,
    data: Prisma.PipelineStageUncheckedUpdateManyInput,
  ) {
    // updateMany garante o filtro por ownerId; devolve o registro atualizado.
    return this.prisma.db.pipelineStage
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.db.pipelineStage.findFirstOrThrow({
          where: { id, ownerId },
        }),
      );
  }

  async delete(id: string, ownerId: string) {
    await this.prisma.db.pipelineStage.deleteMany({ where: { id, ownerId } });
  }

  async maxOrder(ownerId: string) {
    const r = await this.prisma.db.pipelineStage.aggregate({
      where: { ownerId },
      _max: { order: true },
    });
    return r._max.order ?? -1;
  }

  countDeals(stageId: string, ownerId: string) {
    return this.prisma.db.deal.count({ where: { stageId, ownerId } });
  }

  async reorder(ownerId: string, ids: string[]) {
    // Atômico via transação do request; sem $transaction aninhado.
    const db = this.prisma.db;
    await Promise.all(
      ids.map((id, index) =>
        db.pipelineStage.updateMany({
          where: { id, ownerId },
          data: { order: index },
        }),
      ),
    );
  }
}
```

#### 1.5 Service

**Modify**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts`

Todo use case recebe `ownerId` como primeiro parâmetro (convenção da camada `application`:
`ClientsService.findOne(ownerId, id)`, `DealsService.move(ownerId, id, dto)`). A validação de
`reorder` entra na Fase 3 — aqui só a assinatura muda.

```ts
  list(ownerId: string): Promise<PipelineStage[]> {
    return this.repo.findAllOrdered(ownerId);
  }

  async findOne(ownerId: string, id: string): Promise<PipelineStage> {
    const stage = await this.repo.findById(id, ownerId);
    if (!stage) throw new NotFoundException('Estágio não encontrado.');
    return stage;
  }

  /** Primeiro estágio do owner (menor `order`); destino padrão de novos deals. */
  async firstStage(ownerId: string): Promise<PipelineStage> {
    const [first] = await this.repo.findAllOrdered(ownerId);
    if (!first) throw new NotFoundException('Nenhum estágio configurado.');
    return first;
  }

  /** Primeiro estágio do owner marcado como "Ganhou" (isWon), ou null. */
  async wonStage(ownerId: string): Promise<PipelineStage | null> {
    const stages = await this.repo.findAllOrdered(ownerId);
    return stages.find((s) => s.isWon) ?? null;
  }

  async create(
    ownerId: string,
    dto: CreatePipelineStageDto,
  ): Promise<PipelineStage> {
    if (await this.repo.findByName(ownerId, dto.name)) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    const order = (await this.repo.maxOrder(ownerId)) + 1;
    return this.repo.create({
      ownerId,
      name: dto.name,
      order,
      isWon: dto.isWon ?? false,
      isLost: dto.isLost ?? false,
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdatePipelineStageDto,
  ): Promise<PipelineStage> {
    const stage = await this.findOne(ownerId, id);
    if (
      dto.name &&
      dto.name !== stage.name &&
      (await this.repo.findByName(ownerId, dto.name))
    ) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    return this.repo.update(id, ownerId, dto);
  }

  async reorder(ownerId: string, ids: string[]): Promise<PipelineStage[]> {
    await this.repo.reorder(ownerId, ids);
    return this.repo.findAllOrdered(ownerId);
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.findOne(ownerId, id);
    if ((await this.repo.countDeals(id, ownerId)) > 0) {
      throw new ConflictException(
        'Não é possível excluir um estágio que possui oportunidades.',
      );
    }
    await this.repo.delete(id, ownerId);
  }
```

#### 1.6 Controller

**Modify**: `apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts`

Substituir o doc-comment (que declara "catálogo **global** da instância") e injetar
`@CurrentOwnerId()` em todos os handlers. O `@RequirePermission` do `GET` entra na Fase 3.

```ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post,
} from '@nestjs/common';
import { PipelineStagesService } from '../application/pipeline-stages.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreatePipelineStageDto } from './dto/create-pipeline-stage.dto';
import { UpdatePipelineStageDto } from './dto/update-pipeline-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

/**
 * O funil é **do owner**: cada workspace tem os seus estágios (`ownerId` + RLS),
 * criados junto com a conta e configuráveis sem afetar ninguém. Configurar o
 * funil é gerir o pipeline, então as escritas exigem `oportunidade:gerenciar`.
 */
@Controller('pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly stages: PipelineStagesService) {}

  @Get() list(@CurrentOwnerId() ownerId: string) {
    return this.stages.list(ownerId);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post()
  create(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: CreatePipelineStageDto,
  ) {
    return this.stages.create(ownerId, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch('reorder')
  reorder(@CurrentOwnerId() ownerId: string, @Body() dto: ReorderStagesDto) {
    return this.stages.reorder(ownerId, dto.ids);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePipelineStageDto,
  ) {
    return this.stages.update(ownerId, id, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Delete(':id')
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.stages.delete(ownerId, id);
  }
}
```

#### 1.7 Consumidor: `DealsService`

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts`

Duas chamadas em `create` (linhas 54-56) e uma em `move` (linha 102):

```ts
    // create():
    const stage = dto.stageId
      ? await this.stages.findOne(ownerId, dto.stageId)
      : await this.stages.firstStage(ownerId);
```

```ts
    // move():
    const targetStage = await this.stages.findOne(ownerId, dto.stageId);
```

> A trava contra apontar para o estágio de outro owner continua sendo esta chamada: a FK
> `Deal_stageId_fkey` **bypassa RLS** por ser checagem de integridade referencial (docs do
> PostgreSQL 16), e a policy de `Deal` só valida o `ownerId` do próprio deal. Sob RLS,
> `findOne(ownerId, stageId)` devolve `null` para estágio alheio → `404 Estágio não encontrado.`

#### 1.8 Consumidor: `ProposalsService`

**Modify**: `apps/api/src/modules/proposals/application/proposals.service.ts` (linha 249)

```ts
  /** Encontra o estágio isWon do owner e move o deal via DealsService. */
  private async moveDealToWon(ownerId: string, dealId: string): Promise<void> {
    const wonStage = await this.stages.wonStage(ownerId);
```

#### 1.9 Consumidor: dashboard

**Modify**: `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts` (linhas 19-22)

O comentário "Estágios são globais" deixa de valer; com RLS a leitura já vem escopada, e o `where`
explícito é a mesma defesa em profundidade do resto do arquivo:

```ts
  async funnel(ownerId: string): Promise<FunnelStageRow[]> {
    // Estágios e agregados, ambos do owner (RLS + filtro explícito).
    const [stages, grouped] = await Promise.all([
      this.prisma.db.pipelineStage.findMany({
        where: { ownerId },
        orderBy: { order: 'asc' },
      }),
      this.prisma.db.deal.groupBy({
        by: ['stageId'],
        where: { client: { ownerId } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
```

#### 1.10 Testes de unidade

**Modify**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.spec.ts`

Adicionar `findAllIds: jest.fn()` ao mock do repo e passar `ownerId` em todas as chamadas. Os quatro
casos existentes viram:

```ts
    repo = {
      findAllOrdered: jest.fn(),
      findAllIds: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxOrder: jest.fn(),
      countDeals: jest.fn(),
      reorder: jest.fn(),
    };
```

```ts
  it('cria estágio no fim da ordem do owner', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.maxOrder.mockResolvedValue(4);
    repo.create.mockResolvedValue({ id: 's1' } as never);
    await service.create('owner', { name: 'Qualificação' });
    expect(repo.maxOrder).toHaveBeenCalledWith('owner');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner',
        name: 'Qualificação',
        order: 5,
        isWon: false,
        isLost: false,
      }),
    );
  });

  it('rejeita nome duplicado no mesmo owner com ConflictException', async () => {
    repo.findByName.mockResolvedValue({ id: 's9' } as never);
    await expect(
      service.create('owner', { name: 'Ganhou' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.findByName).toHaveBeenCalledWith('owner', 'Ganhou');
  });

  it('lança NotFoundException ao buscar estágio inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findById).toHaveBeenCalledWith('nope', 'owner');
  });

  it('impede excluir estágio com oportunidades', async () => {
    repo.findById.mockResolvedValue({ id: 's1' } as never);
    repo.countDeals.mockResolvedValue(3);
    await expect(service.delete('owner', 's1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });
```

Adicionar um caso novo, que o funil global tornava impossível:

```ts
  it('não vê estágio de outro owner (findById escopado)', async () => {
    repo.findById.mockResolvedValue(null); // RLS/where devolvem null p/ outro owner
    await expect(
      service.findOne('owner-a', 'stage-do-owner-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
```

**Sem mudança**: `deals.service.spec.ts` e `proposals.service.spec.ts`. Os dois usam mocks de objeto
solto (`stages = { findOne: jest.fn(), firstStage: jest.fn() }` / `{ wonStage: jest.fn() }`) e não
asseveram os argumentos das chamadas de estágio, então continuam passando. Vale **apertar** duas
asserções, para o `ownerId` novo ficar coberto:

```ts
// deals.service.spec.ts, no caso "cria deal no fim do estágio padrão":
    expect(stages.firstStage).toHaveBeenCalledWith('owner');

// proposals.service.spec.ts, no caso de aceitar proposta:
    expect(stages.wonStage).toHaveBeenCalledWith('owner');
```

### Success Criteria

#### Automated Verification

- [x] `pnpm db:up && pnpm --filter api exec prisma migrate reset --force` — aplica todas as
      migrations do zero e roda o seed sem erro (o seed ainda usa `upsert({ where: { name } })` neste
      ponto e **vai falhar** — ver nota abaixo).
- [x] `pnpm --filter api exec prisma validate` — schema válido.
- [x] `pnpm --filter api build` — compila (o `prisma generate` do postinstall/`migrate` já regenerou
      o client com `ownerId` obrigatório).
- [x] `pnpm --filter api test` — suíte de unidade verde, incluindo o caso novo de isolamento.
- [x] `pnpm --filter api lint` — sem erro.
- [x] Nenhuma linha órfã:
      `docker compose exec -T postgres psql -U crm_user -d crm_db -c 'SELECT count(*) FROM "PipelineStage" WHERE "ownerId" IS NULL;'`
      → `0`.
- [x] Nenhum deal apontando para estágio de outro owner:
      ```bash
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        'SELECT count(*) FROM "Deal" d JOIN "PipelineStage" s ON s."id" = d."stageId" WHERE s."ownerId" <> d."ownerId";'
      ```
      → `0`.
- [x] Policy e FORCE ativos:
      ```bash
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'PipelineStage';"
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        "SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = '\"PipelineStage\"'::regclass;"
      ```
      → `t | t` e a policy `owner_isolation`.
- [x] Fail-closed pela role da aplicação (sem `app.owner_id` setado, zero linhas):
      ```bash
      docker compose exec -T postgres psql "postgresql://crm_app:crm_app_password@localhost:5432/crm_db" \
        -c 'SELECT count(*) FROM "PipelineStage";'
      ```
      → `0`.
- [x] Índices esperados:
      `docker compose exec -T postgres psql -U crm_user -d crm_db -c '\d "PipelineStage"'`
      → contém `PipelineStage_ownerId_name_key` e `PipelineStage_ownerId_idx`, **não** contém
      `PipelineStage_name_key`.

> **Nota sobre o `migrate reset` nesta fase:** o `prisma/seed.ts` só é ajustado na Fase 2, então o
> `upsert({ where: { name } })` de `seed.ts:112` deixa de compilar/rodar assim que o client é
> regenerado. Duas opções, ambas aceitáveis: (a) rodar
> `pnpm --filter api exec prisma migrate reset --force --skip-seed` nesta fase e validar o seed na
> Fase 2; ou (b) antecipar o ajuste de `seed.ts` (item 2.4) para cá. Prefira (a) — mantém as fases
> limpas.

#### Manual Verification

- [ ] Com dois owners no banco (`admin@crm.local` e `demo@crm.local` do seed, cada um com sessão
      própria): logar como `admin`, renomear "Negociação" para "Negociação ativa" no
      `StageConfigDialog`, e confirmar que a sessão de `demo` continua vendo "Negociação".
- [ ] Criar um estágio chamado "Negociação" na conta `demo` → `201`, sem `409` (a unique agora é
      composta).
- [ ] Abrir `/pipeline` como `admin`: o Kanban renderiza as colunas dele e as oportunidades estão nas
      colunas corretas (as mesmas de antes da migration — o religamento preservou `name`/`order`).
- [ ] Excluir na conta `demo` um estágio sem oportunidades → sucesso; tentar excluir um com
      oportunidades → `409 Não é possível excluir um estágio que possui oportunidades.`
- [ ] Mover uma oportunidade para o estágio "Ganhou" → o projeto é criado (criar-ao-ganhar continua
      funcionando com o estágio por owner).
- [ ] Aceitar uma proposta vinculada a um deal → o deal vai para o "Ganhou" **daquele owner**.
- [ ] Dashboard (`/`): o bloco "Funil de oportunidades" lista os estágios do owner logado, com as
      contagens e valores corretos.

**⏸ PAUSE**: após a verificação automatizada passar, pare para confirmação manual antes da Fase 2.

---

## Fase 2: Provisionamento dos estágios na criação da conta

### Goal

Conta nova (senha ou OAuth) nasce com o próprio funil padrão, a partir de uma constante única — e o
seed de desenvolvimento passa a semear por owner.

> **Dependência dura da Fase 1:** depois dela, uma conta criada em produção teria zero estágios e a
> primeira oportunidade responderia `404 Nenhum estágio configurado.` As duas fases saem no mesmo
> release.

### Changes

#### 2.1 Constante compartilhada

**Create**: `apps/api/src/shared/default-pipeline-stages.ts`

Fica em `shared/` (não em `modules/pipeline/`) para o `UsersModule` não precisar importar o
`PipelineModule` — que importa `ClientsModule` e `ProjectsModule` e criaria um acoplamento indevido
entre cadastro e pipeline. É também o único lugar de onde o `prisma/seed.ts` pode consumir sem
atravessar a fronteira de um módulo de negócio.

```ts
/**
 * Funil padrão de uma conta nova. **Não** é um catálogo global: é o ponto de
 * partida copiado para cada owner na criação da conta (ver `UsersService`), que
 * depois renomeia, reordena, acrescenta e exclui livremente.
 *
 * Fonte única — consumida pelo provisionamento da conta e pelo `prisma/seed.ts`.
 * A migration 20260726120000_pipeline_stages_per_owner replicou esta mesma lista
 * (via o template global que existia) para os owners anteriores ao deploy.
 */
export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Novo lead', isWon: false, isLost: false },
  { name: 'Contato feito', isWon: false, isLost: false },
  { name: 'Reunião/Diagnóstico', isWon: false, isLost: false },
  { name: 'Proposta enviada', isWon: false, isLost: false },
  { name: 'Negociação', isWon: false, isLost: false },
  { name: 'Ganhou', isWon: true, isLost: false },
  { name: 'Perdeu', isWon: false, isLost: true },
] as const;

/** A mesma lista com `order` sequencial — pronta para um nested create. */
export function defaultPipelineStages(): {
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}[] {
  return DEFAULT_PIPELINE_STAGES.map((stage, order) => ({ ...stage, order }));
}
```

#### 2.2 `UsersService`

**Modify**: `apps/api/src/modules/users/users.service.ts`

Adicionar o import, o `Logger` e um terceiro helper privado ao lado de `trialSubscription()` e
`systemRole()`; depois plugar o nested create nos **dois** caminhos de provisionamento.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminService } from '../../prisma/prisma-admin.service';
import {
  DEFAULT_PIPELINE_STAGES,
  defaultPipelineStages,
} from '../../shared/default-pipeline-stages';
```

```ts
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
  ) {}
```

```ts
  /**
   * Funil padrão da workspace, criado junto com a conta do owner. `PipelineStage`
   * tem RLS e o cadastro não tem contexto de owner — entra pelo client admin, no
   * mesmo nested create do `User` (atômico, sem $transaction explícito), pela
   * mesma razão de `Subscription` e `Role`.
   */
  private defaultStages() {
    return defaultPipelineStages();
  }

  /** Log do provisionamento — vale para os dois caminhos de cadastro. */
  private logStagesProvisioned(ownerId: string) {
    this.logger.log({
      evento: 'funil.estagios_provisionados',
      msg: 'Funil padrão criado para a conta nova.',
      ownerId,
      quantidade: DEFAULT_PIPELINE_STAGES.length,
    });
  }
```

`create` deixa de retornar a promise crua para poder logar depois do sucesso (o único chamador,
`AuthService.register`, já dá `await`):

```ts
  async create(data: { name: string; email: string; passwordHash: string }) {
    const user = await this.admin.user.create({
      data: {
        ...data,
        // Owner: `ownerId` nulo (é a própria workspace) e conta já ativa.
        acceptedAt: new Date(),
        subscription: { create: this.trialSubscription() },
        ownedRoles: { create: this.systemRole() },
        pipelineStages: { create: this.defaultStages() },
      },
    });
    this.logStagesProvisioned(user.id);
    return user;
  }
```

Idem em `createWithOAuth` (linhas 86-107):

```ts
  async createWithOAuth(data: {
    name: string;
    email: string;
    provider: OAuthProvider;
    providerAccountId: string;
  }) {
    const user = await this.admin.user.create({
      data: {
        name: data.name,
        email: data.email,
        acceptedAt: new Date(),
        oauthAccounts: {
          create: {
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        },
        subscription: { create: this.trialSubscription() },
        ownedRoles: { create: this.systemRole() },
        pipelineStages: { create: this.defaultStages() },
      },
    });
    this.logStagesProvisioned(user.id);
    return user;
  }
```

#### 2.3 Registrar o evento novo na doc de observabilidade

**Modify**: `docs/observabilidade.md` (tabela "Eventos que a API emite")

```markdown
| `funil.estagios_provisionados` | conta nova criada (senha ou OAuth) | `info` |
```

#### 2.4 Seed de desenvolvimento

**Modify**: `apps/api/prisma/seed.ts`

Trocar as linhas 101-118 (lista duplicada + `upsert({ where: { name } })`) por semeadura **por
owner**, usando a constante compartilhada e a unique composta. Import no topo do arquivo:

```ts
import { defaultPipelineStages } from '../src/shared/default-pipeline-stages';
```

```ts
  // --- estágios do pipeline (por owner) ---------------------------------
  // O funil é do owner (RLS por ownerId). Em produção estes estágios nascem no
  // cadastro (ver UsersService); aqui o seed replica para os dois owners de
  // desenvolvimento, o que também exercita o isolamento.
  for (const owner of [admin, demo]) {
    for (const s of defaultPipelineStages()) {
      await prisma.pipelineStage.upsert({
        where: { ownerId_name: { ownerId: owner.id, name: s.name } },
        update: { order: s.order, isWon: s.isWon, isLost: s.isLost },
        create: { ownerId: owner.id, ...s },
      });
    }
  }
  const stages = await prisma.pipelineStage.findMany({ where: { ownerId } });
```

O helper `stage(name)` (linhas 119-123) **não muda** — passa a resolver só entre os estágios do
owner `admin`, que é o dono de todo o dataset de demonstração.

> Se o `ts-node` do script de seed reclamar do import fora de `prisma/` (o `tsconfig.json` da API não
> tem `include`/`paths` restritivos, então não deve), o fallback é mover a constante para
> `apps/api/src/shared/default-pipeline-stages.ts` e reexportá-la — não duplicá-la.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api build` — compila.
- [x] `pnpm --filter api exec prisma migrate reset --force` — agora **com** seed, sem erro.
- [x] `pnpm --filter api test` e `pnpm --filter api lint` — verdes.
- [x] Cada owner do seed tem exatamente 7 estágios:
      ```bash
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        'SELECT "ownerId", count(*) FROM "PipelineStage" GROUP BY 1 ORDER BY 2;'
      ```
      → duas linhas, ambas com `7`.
- [x] Nenhum `console.log` novo:
      `grep -rn 'console\.log' apps/api/src` → só o que já existia (nenhum em `src`).

#### Manual Verification

- [ ] `POST /auth/register` com um e-mail novo (ou a tela `/registrar`, já que
      `REGISTRATION_ENABLED=true`), depois logar e abrir `/pipeline`: o Kanban aparece com as 7
      colunas padrão, não vazio.
- [ ] Na conta nova, criar uma oportunidade sem escolher estágio → entra em "Novo lead" (sem
      `404 Nenhum estágio configurado.`).
- [ ] Login social (Google ou GitHub, se configurado no ambiente) com conta inédita → mesmas 7
      colunas.
- [ ] `docker compose logs` (ou o stdout do `start:dev`) mostra uma linha JSON com
      `"evento":"funil.estagios_provisionados"` e `"quantidade":7`, **sem** nenhum campo de segredo.
- [ ] A conta nova não vê nem altera os estágios de `admin@crm.local`.

**⏸ PAUSE**: pare para confirmação manual antes da Fase 3.

---

## Fase 3: Endurecimento e documentação

### Goal

Fechar os dois buracos que o funil por owner transforma de vazamento em erro cru, e deixar a
documentação obrigatória em dia (`ENDPOINTS.md` é Definition of Done).

### Changes

#### 3.1 `reorder` valida o conjunto de ids

**Modify**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts`

Hoje `reorder(ids)` não valida nada: um id inexistente faz o `update` do Prisma lançar `P2025` dentro
de um `Promise.all` → `500`. Com o escopo por owner, um id **de outro owner** cai no mesmo caminho — o
que antes era vazamento silencioso passa a ser erro não tratado. Como `reorder` reatribui `order`
sequencial a partir da posição na lista, a única entrada coerente é uma **permutação exata** do
conjunto do owner.

Adicionar `UnprocessableEntityException` ao import de `@nestjs/common` e substituir o método:

```ts
  /**
   * Reordena o funil. A lista tem de ser uma permutação exata dos estágios do
   * owner: `order` é atribuído pela posição, então uma lista parcial deixaria o
   * funil com `order` duplicado, e um id alheio (ou inexistente) viraria um
   * `P2025` não tratado dentro do `Promise.all` do repositório.
   */
  async reorder(ownerId: string, ids: string[]): Promise<PipelineStage[]> {
    const owned = await this.repo.findAllIds(ownerId);
    const unique = new Set(ids);
    const isPermutation =
      unique.size === ids.length &&
      unique.size === owned.length &&
      owned.every((id) => unique.has(id));
    if (!isPermutation) {
      throw new UnprocessableEntityException(
        'A lista de estágios não corresponde aos estágios do funil.',
      );
    }
    await this.repo.reorder(ownerId, ids);
    return this.repo.findAllOrdered(ownerId);
  }
```

**Modify**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.spec.ts` — dois casos
novos:

```ts
  it('reordena quando a lista é permutação exata dos estágios do owner', async () => {
    repo.findAllIds.mockResolvedValue(['a', 'b', 'c']);
    repo.findAllOrdered.mockResolvedValue([] as never);
    await service.reorder('owner', ['c', 'a', 'b']);
    expect(repo.reorder).toHaveBeenCalledWith('owner', ['c', 'a', 'b']);
  });

  it('rejeita reorder com id fora do funil do owner', async () => {
    repo.findAllIds.mockResolvedValue(['a', 'b', 'c']);
    await expect(
      service.reorder('owner', ['a', 'b', 'de-outro-owner']),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.reorder).not.toHaveBeenCalled();
  });
```

#### 3.2 Permissão na leitura de estágios

**Modify**: `apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts`

O `GET` era livre "porque o quadro não renderiza sem os estágios" — premissa de catálogo global.
Agora é dado do owner, e a leitura merece a mesma chave da leitura de oportunidades. Os dois
consumidores web já estão atrás do `PermissionRoute` de pipeline, então nenhuma tela regride.

```ts
  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get() list(@CurrentOwnerId() ownerId: string) {
    return this.stages.list(ownerId);
  }
```

#### 3.3 `ENDPOINTS.md`

**Modify**: `apps/api/ENDPOINTS.md` (seção "Pipeline stages", linhas 282-322)

Os cinco endpoints mudam Propósito/Auth/Erros. Substituir a seção por:

```markdown
## Pipeline stages

> O funil é **do owner**: cada workspace tem os seus estágios (`ownerId`, com RLS). Colaborador lê e
> escreve os estágios do owner que o convidou, limitado pelas permissões do papel.

### GET /pipeline-stages
- **Propósito:** Listar os estágios do funil **do owner**, ordenados por `order`.
- **Auth:** Bearer (access token). Permissão: `oportunidade:ver` ou `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200 PipelineStage[]` (cada item inclui `ownerId`).
- **Erros:** `403 Você não tem permissão para ver pipeline.`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.list`

### POST /pipeline-stages
- **Propósito:** Criar um estágio no fim da ordem atual do funil do owner.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** `{ name: string (mín. 2), isWon?: boolean, isLost?: boolean }`
- **Resposta:** `201 PipelineStage`.
- **Erros:** `400` (validação), `409 Já existe um estágio com este nome.` (nome único **por owner**), `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.create`

### PATCH /pipeline-stages/reorder
- **Propósito:** Reatribuir a ordem (`order`) sequencial dos estágios do owner conforme a lista de ids. A lista tem de ser uma permutação exata do funil do owner.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** `{ ids: uuid[] }`
- **Resposta:** `200 PipelineStage[]` (já reordenados).
- **Erros:** `400` (validação), `422 A lista de estágios não corresponde aos estágios do funil.` (id repetido, faltando, inexistente ou de outro owner), `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.reorder`

### PATCH /pipeline-stages/:id
- **Propósito:** Atualizar parcialmente um estágio do owner (nome, `isWon`, `isLost`).
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** Campos parciais de `POST /pipeline-stages`.
- **Resposta:** `200 PipelineStage`.
- **Erros:** `400` (validação), `404 Estágio não encontrado.` (inexistente ou de outro owner), `409 Já existe um estágio com este nome.`, `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.update`

### DELETE /pipeline-stages/:id
- **Propósito:** Excluir um estágio do owner, desde que não possua oportunidades vinculadas.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Estágio não encontrado.` (inexistente ou de outro owner), `409 Não é possível excluir um estágio que possui oportunidades.`, `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.remove`
```

Ajustar também as duas menções ao estágio em **Deals** (linhas 345-350 e 369-374): onde se lê
"primeiro estágio", explicitar "primeiro estágio **do owner**", e manter
`404 Estágio não encontrado.` cobrindo o caso "estágio de outro owner".

#### 3.4 Comentário da migration de RLS

**Modify**: `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql` (linha 2)

Migration aplicada não se reescreve, mas o comentário afirma algo que deixou de ser verdade e engana
quem lê o histórico. Trocar apenas o texto do comentário:

```sql
-- Ativa Row-Level Security por ownerId nas 10 tabelas de dados.
-- User fica de fora (auth por email). PipelineStage também ficou de fora aqui,
-- por ser catálogo global na época — passou a ter ownerId + policy própria em
-- 20260726120000_pipeline_stages_per_owner.
```

#### 3.5 `SPEC.md`

**Modify**: `SPEC.md`

- **§1.3 Premissas, linha 28** — a premissa de single-user é falsa desde os colaboradores:
  ```markdown
  - **Multi-owner**: uma instância atende vários owners, isolados por `ownerId` (RLS no banco). Cada owner é dono dos seus dados e da sua assinatura, convida colaboradores e configura o próprio funil.
  ```
- **§4, modelo `PipelineStage` (linhas 251-258)** — refletir o schema real:
  ```prisma
  model PipelineStage {
    id        String  @id @default(uuid())
    ownerId   String
    name      String
    order     Int
    isWon     Boolean @default(false)
    isLost    Boolean @default(false)
    deals     Deal[]

    @@unique([ownerId, name])
  }
  ```
- **§6.4, linha 477** — o seed não planta mais estágios "da instância":
  ```markdown
  - Seed inicial: usuários de demonstração + funil padrão **por owner** (em produção o funil nasce na criação da conta)
  ```
- **§7, linha 407 (tabela de endpoints)** — completar a linha `Stages`:
  ```markdown
  | Stages | `GET/POST /pipeline-stages` · `PATCH /pipeline-stages/reorder` · `PATCH/DELETE /pipeline-stages/:id` (escopo: owner) |
  ```

#### 3.6 `ROADMAP.md`

**Modify**: `ROADMAP.md` (Fase 7, linhas 207-212)

Marcar os cinco itens de "Isolamento do funil" e apontar o plano. Os itens de "Responsável por
registro" (linhas 217-222) ficam **abertos** — são a Frente B.

```markdown
**Isolamento do funil** — entregue (ver `specs/plans/2026-07-26-fase-7a-funil-por-owner.md`)
- [x] `PipelineStage` recebe `ownerId`
- [x] RLS em `PipelineStage` (`20260726120000_pipeline_stages_per_owner`)
- [x] Trocar `name @unique` global por `@@unique([ownerId, name])`
- [x] Migration de dados: replicar os estágios por owner existente e religar os `Deal`
- [x] Seed dos estágios padrão passa a rodar na criação da conta, não na instância
```

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api build`, `pnpm --filter api test`, `pnpm --filter api lint` — verdes,
      incluindo os dois casos novos de `reorder`.
- [x] `pnpm --filter web build` — compila (confirma que o frontend não precisou mudar).
- [x] Nenhuma menção obsoleta a funil global no código:
      ```bash
      grep -rn -i 'global' apps/api/src/modules/pipeline apps/api/src/modules/dashboard
      ```
      → nenhum resultado sobre estágios.
- [x] Cobertura de doc: todo handler de `pipeline-stages.controller.ts` aparece em `ENDPOINTS.md`:
      ```bash
      grep -c 'PipelineStagesController\.' apps/api/ENDPOINTS.md
      ```
      → `5`.

#### Manual Verification

- [ ] `PATCH /pipeline-stages/reorder` com um id inventado → `422 A lista de estágios não
      corresponde aos estágios do funil.` (não `500`).
- [ ] `PATCH /pipeline-stages/reorder` com a lista completa correta (o que o `StageConfigDialog`
      envia ao arrastar) → `200` e a nova ordem persiste ao reabrir o diálogo.
- [ ] `PATCH /pipeline-stages/reorder` com um id de estágio de outro owner → `422`, sem vazar que o
      estágio existe.
- [ ] Colaborador com papel que **não** tem `oportunidade:ver` nem `oportunidade:gerenciar`:
      `GET /pipeline-stages` → `403`; a navegação já não mostra "Pipeline" (comportamento atual).
- [ ] Colaborador com apenas `oportunidade:ver`: abre `/pipeline`, o quadro renderiza, e "Configurar
      estágios" falha com `403` nas escritas (comportamento atual do backend — o botão segue visível,
      o que é escopo de outra fase).
- [ ] Ler `SPEC.md` §1.3, §4 e §7 e `ROADMAP.md` Fase 7 e confirmar que descrevem o sistema real.

**⏸ PAUSE**: confirmação final antes de commitar/deployar.

---

## Testing Strategy

### Unit Tests

- `pipeline-stages.service.spec.ts` — todos os casos existentes com `ownerId`, mais:
  - estágio de outro owner → `NotFoundException` (`findById` escopado devolve `null`);
  - conflito de nome consultado **por owner** (`findByName('owner', nome)`);
  - `reorder` com permutação exata → chama o repositório;
  - `reorder` com id faltando / repetido / alheio → `UnprocessableEntityException` e o repositório
    **não** é chamado.
- `deals.service.spec.ts` / `proposals.service.spec.ts` — asserções apertadas para cobrir o `ownerId`
  repassado a `firstStage`/`findOne`/`wonStage`.
- Não há testes de repositório Prisma no projeto (os repos são verificados na integração manual e
  pelas consultas SQL das fases) — não introduza a camada aqui.

### Integration Tests

O projeto não tem suíte de e2e ativa (`test/jest-e2e.json` existe, sem casos de pipeline). A
verificação de integração desta fase é feita pelas consultas SQL das seções de verificação
automatizada — que são o que realmente importa aqui, porque o risco está no banco:

1. `PipelineStage` sem linha órfã, com policy + `FORCE`, e fail-closed por `crm_app`.
2. Nenhum `Deal` apontando para estágio de outro owner.
3. Um estágio por (owner, nome) — a unique composta em pé, a global removida.
4. Fluxos cross-módulo, manualmente: criar-ao-ganhar (deal → projeto) e aceite de proposta
   (proposta → deal no "Ganhou" do owner).

### Migration & Rollback

**Aplicação** (produção, `crm.programeai.com.br`):

1. **Backup obrigatório antes**: `pg_dump` completo. A migration apaga linhas de `PipelineStage` e
   reescreve `Deal.stageId` — não é reversível por `DOWN` script (o Prisma não gera nem executa
   `down`).
2. Conferir de antemão, contra o banco de produção, que o guard do passo 0 não vai disparar:
   ```sql
   SELECT count(*) FROM "Deal" d
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = d."ownerId" AND u."ownerId" IS NULL);
   ```
   → tem de ser `0`.
3. Registrar o estado de partida, para comparar depois:
   ```sql
   SELECT "id", "name", "order", "isWon", "isLost" FROM "PipelineStage" ORDER BY "order";
   SELECT s."name", count(d."id") FROM "PipelineStage" s
     LEFT JOIN "Deal" d ON d."stageId" = s."id" GROUP BY 1 ORDER BY 1;
   ```
4. `prisma migrate deploy` (o deploy da API já roda isso). A migration é rápida: a replicação é
   `n_owners × n_estágios` linhas e o `UPDATE "Deal"` toca cada deal uma vez.
5. Repetir a consulta de contagem por nome do passo 3, **agrupada por owner**, e conferir que a soma
   por nome bate com o antes:
   ```sql
   SELECT s."ownerId", s."name", count(d."id") FROM "PipelineStage" s
     LEFT JOIN "Deal" d ON d."stageId" = s."id" GROUP BY 1,2 ORDER BY 1,2;
   ```
6. Rodar as consultas de verificação da Fase 1 (órfãos, cross-owner, policy, índices).

**Rollback**: restaurar o backup. Não há caminho de rollback incremental — reverter só o schema
deixaria `Deal.stageId` apontando para ids que não existem mais. Por isso a Fase 1 tem de ser
aplicada com a janela de manutenção mínima e o backup fresco.

**Ordem no release**: Fases 1, 2 e 3 saem **juntas**. A Fase 1 sem a Fase 2 deixa conta nova sem
funil; a Fase 3 sem a Fase 1 não tem o que endurecer.

## Environment Considerations

- **CI/CD**: nenhum passo novo. O deploy da API já executa `prisma migrate deploy`. Se o guard do
  passo 0 disparar, a migration falha e o deploy aborta — que é o comportamento desejado (dado
  inconsistente não deve ser corrigido silenciosamente por uma migration).
- **Migrations**: uma nova, escrita à mão, `20260726120000_pipeline_stages_per_owner`. Idempotência:
  a migration **não** é reentrante (o `ADD COLUMN` falha na segunda execução) — o que está correto, é
  o comportamento padrão do `_prisma_migrations`.
- **Config/Secrets**: nenhuma variável nova. `crm_app` já tem `GRANT` por
  `ALTER DEFAULT PRIVILEGES`, e a migration repete o `GRANT` explícito por autossuficiência.
- **Multi-environment**: em desenvolvimento, `prisma migrate reset --force` cobre tudo (banco novo →
  a migration termina com a tabela vazia → o seed popula por owner). Em produção há dados e owners
  reais — o caminho é o da seção anterior. Autohospedagem: idêntico à produção; quem tiver um único
  owner simplesmente ganha uma cópia dos próprios estágios.
- **Downtime**: a migration pega lock em `PipelineStage` (`ALTER TABLE`) e escreve em `Deal`. Com o
  volume atual é questão de milissegundos, mas o `DROP INDEX`/`ADD CONSTRAINT` exige `ACCESS
  EXCLUSIVE` — aplicar fora do horário de pico.

## Dependencies & Risks

- **Nenhuma dependência nova.** Prisma, `nestjs-cls`, class-validator e o `Logger` do Nest já estão
  no projeto.
- **Risco alto — a migration de dados sobre produção.** É irreversível sem backup e reescreve
  `Deal.stageId`. Mitigado por: guard de integridade no passo 0, ordem obrigatória (criar cópias →
  religar → apagar) ditada pela FK `ON DELETE RESTRICT`, casamento por `name` garantido pelo índice
  único global que ainda existe naquele ponto, e as consultas de conferência antes/depois.
- **Risco médio — funil já customizado por quem chegou primeiro.** A replicação parte das linhas
  reais da tabela, não dos 7 padrões presumidos, então renomeações e estágios extras são preservados.
  Efeito colateral aceito e esperado: **todos** os owners herdam a customização de quem a fez — não
  há como atribuir uma personalização retroativamente ao owner "certo", porque a tabela nunca soube
  de quem era.
- **Risco baixo — `Deal.ownerId` sem FK.** A invariante é verificada pelo guard, não garantida pelo
  banco. Corrigir isso é escopo de outra fase.
- **Bug latente resolvido de graça**: hoje `countDeals(stageId)` conta só os deals do owner do request
  (porque `Deal` tem RLS e `PipelineStage` não), então um estágio com deals de **outro** owner passa a
  validação da aplicação e estoura na FK `ON DELETE RESTRICT` como `500`. Com estágios por owner o
  cenário desaparece.
- **Ordenação/`order` duplicado entre owners** é esperado e correto: `order` é sequencial *dentro* do
  funil de cada owner. Nenhuma consulta agrega `order` cross-owner.
- **Contrato para a Frente B**: nada aqui pré-decide `assigneeId`. A Frente A é pré-requisito da
  Fase 15 do ROADMAP ("roteamento do lead novo para um responsável") apenas por já entregar o funil
  isolado.

## Decisões registradas para a Frente B

Tomadas nesta sessão de planejamento, para o plano seguinte não reabri-las:

1. **Permissões de escopo por registro**: chaves `:ver_todos` por recurso
   (`cliente:ver_todos`, `oportunidade:ver_todas`, `demanda:ver_todas`; `Activity` cavalga em
   `cliente:*`). Sem a chave, a listagem é forçada a `assigneeId = userId`.
   **Ponto de atenção obrigatório no plano da Frente B**: `AccessService.permissionsOf`
   ([access.service.ts:67-73](../../apps/api/src/modules/access/application/access.service.ts#L67-L73))
   concede `ALL_PERMISSION_KEYS` ao owner e ao papel `system`, mas **papéis customizados existentes
   não recebem a chave nova** — o "Comercial" do seed, e qualquer papel real em produção, passariam a
   ver só os próprios registros no deploy. O plano precisa incluir uma migration de dados que
   acrescente as chaves novas aos papéis não-`system` já existentes.
2. **Default dos boards**: quem tem a permissão ampla abre pipeline e "Minhas demandas" com **tudo**
   (como hoje) e liga "Atribuídos a mim" pela toolbar, persistido na URL via `useUrlFilters`. Quem
   não tem a permissão ampla vê só os próprios — aí não é filtro, é escopo. Evita o board vazio no
   dia do deploy (todo registro legado tem `assigneeId` nulo).
3. **`Activity.assigneeId`** é **responsável escolhido**, simétrico a `Deal`/`Task`/`Client`, com
   default = usuário logado no form inline do `TimelineTab`.
4. **Endpoint do seletor de responsável**: rota nova `GET /workspace/members` (owner + colaboradores
   ativos, shape mínimo `{ id, name, isOwner }`, sem `@RequirePermission`, no molde de
   `GET /permissions`). `GET /collaborators` não serve: exige `colaborador:gerenciar` no nível da
   classe e não inclui o owner (`where: { ownerId }`, e owner tem `ownerId = null`). Lookup no front
   em `apps/web/src/lib/members-lookup.ts`, espelhando `clients-lookup.ts` — não pode sair de
   `features/organizacao` (a regra de `apps/web/CLAUDE.md` proíbe uma feature importar o interior de
   outra).
5. **Colaborador desativado ou pendente**: só `ACTIVE` pode ser **atribuído**; registros já
   atribuídos a alguém desativado **continuam** exibindo o nome, e a desativação **não** faz
   reatribuição automática.
6. **Registro sem responsável (`assigneeId = null`)** é visível para quem só vê os próprios (senão o
   lead novo fica invisível e o roteamento da Fase 15 não tem de onde partir).

## References

- PRD: [`specs/research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md`](../research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md)
- Decisão original do funil global: [`specs/plans/2026-07-21-fase-2-pipeline.md`](2026-07-21-fase-2-pipeline.md) (`:66`, `:182-201`)
- Decisão de deixar `PipelineStage` fora do RLS: [`specs/research/2026-07-23-rls-por-ownerid.md`](../research/2026-07-23-rls-por-ownerid.md) (`:202`) e o template da policy em [`specs/plans/2026-07-23-rls-por-ownerid.md`](2026-07-23-rls-por-ownerid.md) (`:339-348`)
- Multiusuário real sobre o funil compartilhado: [`specs/plans/2026-07-25-colaboradores-e-papeis.md`](2026-07-25-colaboradores-e-papeis.md) (`:66`)
- Molde de tabela com `ownerId` + RLS + backfill por owner: `apps/api/prisma/migrations/20260725120000_add_collaborators_and_roles/migration.sql:75-118`
- Molde de coluna nova em tabela com dados: `apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql`
- Regras de log estruturado: [`docs/observabilidade.md`](../../docs/observabilidade.md)
- PostgreSQL 16 — Row Security Policies: <https://www.postgresql.org/docs/16/ddl-rowsecurity.html>
  (checagens de integridade referencial e `BYPASSRLS`/`FORCE`)
