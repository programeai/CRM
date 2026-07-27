---
date: 2026-07-27T18:40:00-03:00
author: claude
source_prd: specs/research/2026-07-27-fase-13a-dominio-configuravel-por-owner.md
git_commit: 255843302c860bd2ddc6cbf51eb3d7fceb029673
branch: main
status: implemented
tags: [spec, catalogos, pipeline, clients, activities, proposals, projects, rls, migration]
---

# Spec: Fase 13-A — Domínio configurável pelo owner

## Overview

Quatro listas fechadas em código viram catálogos editáveis **por owner**: os enums `ServiceType`,
`LeadSource` e `ActivityType` saem do `schema.prisma` e o texto livre `Deal.lostReason` vira FK. Cada
um passa a ser uma tabela com `ownerId` + RLS `owner_isolation`, provisionada na criação da conta e
gerenciada por uma tela nova em `/catalogos`.

A estratégia é replicar a receita da Fase 7A (`20260726120000_pipeline_stages_per_owner`) quatro
vezes no banco, mas **consolidar a superfície de aplicação num único módulo** `catalogos` com um
registry `kind → delegate`. São 4 rotas em `/catalogos/:kind` em vez de 20, uma tela com quatro abas
e um conjunto de hooks. O filtro por `ownerId` fica num lugar só — mais fácil de auditar, e é onde a
revisão deve concentrar atenção.

As quatro migrations são **separadas e independentes**, aplicadas em ordem crescente de risco:
`LeadSourceCatalog` (1 coluna nulável, zero branch) → `LostReasonCatalog` (texto livre → linhas) →
`ServiceCatalog` (3 tabelas NOT NULL) → `ActivityTypeCatalog` (regra `FOLLOW_UP` em cron
cross-owner). A primeira serve de veículo para toda a fundação; as três seguintes só acrescentam
tabela, backfill e os pontos de consumo.

## Current State

Resumo — detalhes completos no PRD.

- Os quatro valores viajam como literal de enum (ou string livre) do `POST`/`PATCH` até a resposta,
  sem tabela, sem FK, sem join e **sem nenhuma agregação** no projeto.
- No web, `Object.keys(LABELS)` de [labels.ts](../../apps/web/src/lib/labels.ts) **é o catálogo de
  fato**: três `Select` derivam suas opções de um módulo de compile-time, cada um com um `z.enum([…])`
  duplicado, e `ServiceType` ainda tem default `'SOFTWARE'` hardcoded em três formulários.
- `FOLLOW_UP` não é rótulo, é **regra**: filtrado literalmente em
  [prisma-notification-triggers.repository.ts:34](../../apps/api/src/modules/notifications/infra/prisma-notification-triggers.repository.ts#L34)
  (cron cross-owner pelo client admin, que bypassa RLS) e em
  [prisma-dashboard.repository.ts:180](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L180).
  A UI usa um **terceiro** predicado divergente em
  [TimelineTab.tsx:151-152](../../apps/web/src/features/clientes/tabs/TimelineTab.tsx#L151).
- `Deal.lostReason` é write-only: nenhum componente do web renderiza o campo.
- A fixture do portão [banco-populado.sql:57-63](../../apps/api/prisma/fixtures/banco-populado.sql#L57)
  tem 3 `Deal` com `"serviceType"` literal em **dois owners diferentes** — exatamente o cenário que
  faltou na 7A.

## Desired End State

**Banco.** Quatro tabelas novas — `ServiceCatalog`, `LeadSourceCatalog`, `ActivityTypeCatalog`,
`LostReasonCatalog` — cada uma com `id`, `ownerId` (FK `ON DELETE CASCADE` para `User`), `name`,
`active`, `@@unique([ownerId, name])`, `@@index([ownerId])` e RLS habilitado + forçado + policy
`owner_isolation`. `ActivityTypeCatalog` tem além disso `isFollowUp Boolean`. Os enums
`ServiceType`, `LeadSource` e `ActivityType` não existem mais no schema nem como tipo no Postgres.
Seis colunas passam a ser FK: `Client.sourceId` (nulável), `Deal.serviceTypeId`,
`Proposal.serviceTypeId`, `Project.serviceTypeId`, `Activity.typeId` (NOT NULL) e
`Deal.lostReasonId` (nulável, substituindo a coluna texto). `pg_policies` no schema `public` conta
**22**.

**API.** Módulo `catalogos` expondo `GET/POST/PATCH/DELETE /catalogos/:kind` com
`kind ∈ {servicos, fontes-de-lead, tipos-de-atividade, motivos-de-perda}`. Leitura só exige sessão
válida; escrita exige `catalogo:gerenciar` (chave nova na categoria Organização). Exclusão é
hard-delete com `409` quando há registros usando o item, e a mensagem instrui a desativar. Toda
resposta que carrega um desses campos inclui a linha do catálogo (`{ serviceTypeId, serviceType: { id,
name, active } }`), para que a UI não precise de um segundo request. Os dois pontos de cópia de valor
entre registros (`projects.createFromDeal`, `proposals.newVersion`) validam explicitamente que o item
copiado pertence ao owner de destino.

**Provisionamento.** `shared/default-catalogs.ts` é fonte única dos quatro catálogos padrão,
consumida pelos dois caminhos de cadastro de `users.service.ts` e pelo `prisma/seed.ts`. Os nomes
padrão **são** os rótulos pt-BR que hoje vivem em `labels.ts`.

**Web.** `/catalogos` com quatro abas, gated por `catalogo:gerenciar` na nav e na rota.
`LEAD_SOURCE_LABELS`, `SERVICE_TYPE_LABELS` e `ACTIVITY_TYPE_LABELS` (e seus tradutores) não existem
mais em `labels.ts`. Os cinco `Select` afetados leem do catálogo em runtime, sem default hardcoded, e
um item desativado continua rotulando o registro antigo que o usa. O filtro de origem da listagem de
clientes usa um codec de id (validação passa a ser do servidor). O predicado de follow-up pendente é
um só, derivado de `activity.type.isFollowUp`.

## What We're NOT Doing

- **Campos customizados** (Frente B da Fase 13) — adiada no ROADMAP, depende desta fase.
- **Coluna `order` e rota `reorder`** — catálogo não é ordenado por natureza como estágio de funil;
  a ordem é alfabética por `name`. Corta 4 endpoints e toda a UI de dnd-kit.
- **Auditoria dos catálogos** — segue o precedente do `PipelineStage`, que não chama `AuditService`.
  Evita acrescentar valores ao enum `AuditEntity`. A cobertura é o log estruturado.
- **Lixeira / soft delete dos itens** — `active` é desativação de catálogo, não arquivamento;
  `TrashType` não muda.
- **Migrar `PipelineStage` para o módulo `catalogos`** — ele tem `order`, `reorder`, `isWon`/`isLost`
  e permissão própria. Fica onde está; o registry não o absorve.
- **Agregações por catálogo** (ex.: "receita por serviço" no dashboard) — não existem hoje e não
  entram agora.
- **Default por owner (`isDefault`)** — os formulários nascem sem valor selecionado; o campo já é
  obrigatório e exibe asterisco.

---

## Phase 1: Fundação do módulo `catalogos` + `LeadSourceCatalog`

### Goal

Entregar a máquina inteira — tabela, RLS, registry, permissão, provisionamento, tela, nav — usando o
catálogo mais barato (1 coluna, já nulável, zero branch server-side) como veículo de validação.

### Changes

#### Schema

**Modify**: `apps/api/prisma/schema.prisma`

Acrescentar o model. Colocar junto de `PipelineStage` (após a linha 246), para os catálogos por owner
ficarem vizinhos no arquivo:

```prisma
// --- catálogos por owner (Fase 13-A) ---------------------------------------
// Quatro tabelas irmãs (ServiceCatalog, LeadSourceCatalog, ActivityTypeCatalog,
// LostReasonCatalog) substituem enums fechados e um texto livre. Todas seguem o
// molde de PipelineStage: `ownerId` + RLS, `@@unique([ownerId, name])` (dois
// owners podem ter um "Indicação" cada) e provisionamento na criação da conta
// a partir de `shared/default-catalogs.ts`.
//
// `active` é desativação de catálogo, não arquivamento: item desativado sai dos
// Select de cadastro mas continua rotulando os registros antigos que o usam.
// Exclusão de verdade só quando não há nenhum registro apontando (FK RESTRICT).

/// Fontes de lead do owner. Substitui o enum fechado `LeadSource`.
model LeadSourceCatalog {
  id      String   @id @default(uuid())
  ownerId String
  owner   User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name    String
  active  Boolean  @default(true)
  clients Client[]

  @@unique([ownerId, name])
  @@index([ownerId])
}
```

Trocar o campo em `Client` (linha 180):

```prisma
  // ANTES: source     LeadSource? // REFERRAL | PAID_TRAFFIC | ORGANIC | OUTBOUND | OTHER
  sourceId   String?
  source     LeadSourceCatalog? @relation(fields: [sourceId], references: [id])
```

Acrescentar `@@index([sourceId])` ao `Client` (o filtro da listagem usa a coluna) e remover o
`enum LeadSource` (linhas 503-509).

Back-relation no `User`:

```prisma
  leadSourceCatalog LeadSourceCatalog[]
```

**Create**: `apps/api/prisma/migrations/20260804100000_lead_source_catalog/migration.sql`

Gerar com `pnpm --filter api exec prisma migrate dev --create-only --name lead_source_catalog` e
**substituir o conteúdo pelo abaixo** — o SQL do Prisma emite `DROP COLUMN`/`ADD COLUMN` sem
backfill. A ordem é a da 7A: tabela → semeia por owner → coluna FK nulável → backfill → guard →
drop da coluna antiga e do tipo → constraints → RLS.

```sql
-- Fontes de lead deixam de ser um enum fechado e passam a ser catálogo por
-- owner, com RLS. Primeira das quatro migrations da Fase 13-A.
--
-- Notas de projeto (idênticas às de 20260726120000_pipeline_stages_per_owner):
--  * ownerId é TEXT → comparação texto=texto, SEM cast ::uuid.
--  * ids são TEXT (@default(uuid())) → gen_random_uuid()::text.
--  * `WHERE u."ownerId" IS NULL` é o predicado canônico de "é owner".
--  * Roda como crm_user (superuser), que bypassa RLS — sem set_config aqui.
--
-- Por que a coluna antiga só cai no passo 5: o backfill do passo 4 lê
-- `Client."source"`. E `DROP TYPE "LeadSource"` só depois do DROP COLUMN,
-- porque a coluna ainda depende do tipo.

-- ===========================================================================
-- 0. Guard de integridade
-- ===========================================================================
-- Client.ownerId é coluna sem FK: nada no banco garante que aponta para um
-- owner real. A semeadura abaixo parte de `User WHERE "ownerId" IS NULL`, então
-- um Client com ownerId fora desse conjunto ficaria sem catálogo para onde
-- apontar e perderia silenciosamente a origem no backfill.
DO $$
DECLARE orfaos INT;
BEGIN
  SELECT count(*) INTO orfaos
    FROM "Client" c
   WHERE NOT EXISTS (
     SELECT 1 FROM "User" u WHERE u."id" = c."ownerId" AND u."ownerId" IS NULL
   );
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % cliente(s) com "ownerId" que não corresponde a um owner em "User". Corrija os dados antes de aplicar.',
      orfaos;
  END IF;
END $$;

-- ===========================================================================
-- 1. Tabela do catálogo
-- ===========================================================================
CREATE TABLE "LeadSourceCatalog" (
  "id"      TEXT    NOT NULL,
  "ownerId" TEXT    NOT NULL,
  "name"    TEXT    NOT NULL,
  "active"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "LeadSourceCatalog_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- 2. Semeia o catálogo padrão por owner
-- ===========================================================================
-- Os nomes são os rótulos pt-BR que hoje vivem em apps/web/src/lib/labels.ts —
-- é o mesmo conteúdo, saindo de compile-time para dado. Fonte a manter em
-- sincronia: apps/api/src/shared/default-catalogs.ts.
INSERT INTO "LeadSourceCatalog" ("id", "ownerId", "name")
SELECT gen_random_uuid()::text, u."id", v.name
  FROM "User" u
 CROSS JOIN (VALUES
   ('Indicação'),
   ('Tráfego pago'),
   ('Orgânico'),
   ('Prospecção ativa'),
   ('Outro')
 ) AS v(name)
 WHERE u."ownerId" IS NULL;

-- ===========================================================================
-- 3. Coluna FK nulável
-- ===========================================================================
ALTER TABLE "Client" ADD COLUMN "sourceId" TEXT;

-- ===========================================================================
-- 4. Backfill: literal do enum → linha do catálogo DO PRÓPRIO OWNER
-- ===========================================================================
-- `cat."ownerId" = c."ownerId"` é o que impede o vazamento entre workspaces que
-- o casamento por nome poderia causar (a invariante conferida em
-- prisma/fixtures/invariantes.sql).
UPDATE "Client" c
   SET "sourceId" = cat."id"
  FROM (VALUES
    ('REFERRAL',     'Indicação'),
    ('PAID_TRAFFIC', 'Tráfego pago'),
    ('ORGANIC',      'Orgânico'),
    ('OUTBOUND',     'Prospecção ativa'),
    ('OTHER',        'Outro')
  ) AS m(enum_value, name)
  JOIN "LeadSourceCatalog" cat ON cat."name" = m.name
 WHERE c."source"::text  = m.enum_value
   AND cat."ownerId"     = c."ownerId";

-- ===========================================================================
-- 5. Guard pós-backfill, e só então derrubar a coluna e o tipo
-- ===========================================================================
-- Cliente que TINHA origem e ficou sem FK é backfill silenciosamente incompleto:
-- a coluna é nulável, então nada no banco reclamaria depois do DROP.
DO $$
DECLARE perdidos INT;
BEGIN
  SELECT count(*) INTO perdidos
    FROM "Client"
   WHERE "source" IS NOT NULL AND "sourceId" IS NULL;
  IF perdidos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % cliente(s) com origem preenchida não encontraram linha no catálogo do próprio owner.',
      perdidos;
  END IF;
END $$;

ALTER TABLE "Client" DROP COLUMN "source";
DROP TYPE "LeadSource";

-- ===========================================================================
-- 6. Índices e FKs
-- ===========================================================================
CREATE UNIQUE INDEX "LeadSourceCatalog_ownerId_name_key" ON "LeadSourceCatalog"("ownerId", "name");
CREATE INDEX "LeadSourceCatalog_ownerId_idx" ON "LeadSourceCatalog"("ownerId");
ALTER TABLE "LeadSourceCatalog" ADD CONSTRAINT "LeadSourceCatalog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Client_sourceId_idx" ON "Client"("sourceId");
-- RESTRICT: excluir uma fonte em uso responde 409 no service, não apaga dado.
ALTER TABLE "Client" ADD CONSTRAINT "Client_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "LeadSourceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- 7. RLS por ownerId (molde de 20260724050000_enable_rls)
-- ===========================================================================
ALTER TABLE "LeadSourceCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadSourceCatalog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "LeadSourceCatalog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadSourceCatalog" TO crm_app;
```

#### Módulo `catalogos` (API)

**Create**: `apps/api/src/shared/default-catalogs.ts`

Fonte única dos quatro catálogos padrão. Já nasce com os quatro, embora só o de fontes seja usado
nesta fase — as fases seguintes só acrescentam o consumo.

```ts
/**
 * Catálogos padrão de uma conta nova. **Não** são catálogo global: são o ponto
 * de partida copiado para cada owner na criação da conta (ver `UsersService`),
 * que depois renomeia, desativa, acrescenta e exclui livremente.
 *
 * Os nomes SÃO os rótulos pt-BR que viviam em `apps/web/src/lib/labels.ts` até a
 * Fase 13-A — o mesmo conteúdo, saindo de compile-time para dado.
 *
 * Fonte única — consumida pelo provisionamento da conta e pelo `prisma/seed.ts`.
 * As migrations 20260804100000…20260807100000 replicaram estas mesmas listas
 * para os owners anteriores ao deploy; mudar um nome aqui NÃO reescreve o
 * passado.
 */
export const DEFAULT_SERVICE_CATALOG = ['Software', 'Website', 'Tráfego pago'] as const;

export const DEFAULT_LEAD_SOURCE_CATALOG = [
  'Indicação',
  'Tráfego pago',
  'Orgânico',
  'Prospecção ativa',
  'Outro',
] as const;

/**
 * `isFollowUp` é REGRA, não rótulo: o cron de lembretes e o dashboard filtram por
 * ela. Exatamente um item nasce marcado.
 */
export const DEFAULT_ACTIVITY_TYPE_CATALOG = [
  { name: 'Anotação', isFollowUp: false },
  { name: 'Ligação', isFollowUp: false },
  { name: 'Reunião', isFollowUp: false },
  { name: 'E-mail', isFollowUp: false },
  { name: 'WhatsApp', isFollowUp: false },
  { name: 'Follow-up', isFollowUp: true },
] as const;

export const DEFAULT_LOST_REASON_CATALOG = [
  'Preço',
  'Prazo',
  'Sem resposta',
  'Escolheu concorrente',
  'Sem verba',
  'Fora do perfil',
  'Outro',
] as const;

/** Listas prontas para `create` aninhado (o `ownerId` vem do nested create). */
export function defaultLeadSourceCatalog(): { name: string }[] {
  return DEFAULT_LEAD_SOURCE_CATALOG.map((name) => ({ name }));
}
export function defaultServiceCatalog(): { name: string }[] {
  return DEFAULT_SERVICE_CATALOG.map((name) => ({ name }));
}
export function defaultActivityTypeCatalog(): {
  name: string;
  isFollowUp: boolean;
}[] {
  return DEFAULT_ACTIVITY_TYPE_CATALOG.map((item) => ({ ...item }));
}
export function defaultLostReasonCatalog(): { name: string }[] {
  return DEFAULT_LOST_REASON_CATALOG.map((name) => ({ name }));
}
```

**Create**: `apps/api/src/modules/catalogos/domain/catalog-kind.ts`

```ts
/**
 * As quatro listas configuráveis pelo owner. O valor é o segmento de rota
 * (`/catalogos/servicos`) — em pt-BR, como o resto da fronteira HTTP do projeto.
 *
 * `kind` NÃO é dado: é código. A lista fechada aqui é intencional — o owner
 * configura os *itens* de cada catálogo, não quais catálogos existem.
 */
export const CATALOG_KINDS = [
  'servicos',
  'fontes-de-lead',
  'tipos-de-atividade',
  'motivos-de-perda',
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export function isCatalogKind(value: string): value is CatalogKind {
  return (CATALOG_KINDS as readonly string[]).includes(value);
}

/** Rótulo do item no singular — entra nas mensagens de erro em pt-BR. */
export const CATALOG_LABELS: Record<CatalogKind, string> = {
  servicos: 'tipo de serviço',
  'fontes-de-lead': 'fonte de lead',
  'tipos-de-atividade': 'tipo de atividade',
  'motivos-de-perda': 'motivo de perda',
};

/** Só este catálogo aceita `isFollowUp` (ver `ActivityTypeCatalog.isFollowUp`). */
export const KIND_COM_FOLLOW_UP: CatalogKind = 'tipos-de-atividade';
```

**Create**: `apps/api/src/modules/catalogos/domain/catalog.repository.ts`

```ts
import type { CatalogKind } from './catalog-kind';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

/**
 * Forma comum das quatro tabelas de catálogo. `isFollowUp` só existe em
 * `ActivityTypeCatalog` — o service garante que ele não vaze para os outros.
 */
export interface CatalogItem {
  id: string;
  ownerId: string;
  name: string;
  active: boolean;
  isFollowUp?: boolean;
}

/**
 * Catálogos são dado do owner (RLS por ownerId). O filtro explícito em toda
 * assinatura é defesa em profundidade: a policy já fecha, mas o repositório não
 * depende de o contexto da transação ter sido setado.
 */
export interface CatalogRepository {
  /** Ordenado por `name`; `incluirInativos: false` devolve só `active`. */
  findAll(
    kind: CatalogKind,
    ownerId: string,
    incluirInativos: boolean,
  ): Promise<CatalogItem[]>;
  findById(
    kind: CatalogKind,
    id: string,
    ownerId: string,
  ): Promise<CatalogItem | null>;
  findByName(
    kind: CatalogKind,
    ownerId: string,
    name: string,
  ): Promise<CatalogItem | null>;
  create(
    kind: CatalogKind,
    data: { ownerId: string; name: string; isFollowUp?: boolean },
  ): Promise<CatalogItem>;
  update(
    kind: CatalogKind,
    id: string,
    ownerId: string,
    data: { name?: string; active?: boolean; isFollowUp?: boolean },
  ): Promise<CatalogItem>;
  delete(kind: CatalogKind, id: string, ownerId: string): Promise<void>;
  /**
   * Quantos registros do owner apontam para este item — guard de exclusão. Conta
   * INCLUSIVE arquivados: as FKs são RESTRICT e um filho na lixeira faria o
   * DELETE responder 500. `servicos` soma três tabelas.
   */
  contarUsos(kind: CatalogKind, id: string, ownerId: string): Promise<number>;
  /** Desmarca `isFollowUp` dos outros itens do owner (só `tipos-de-atividade`). */
  desmarcarOutrosFollowUp(ownerId: string, exceto: string): Promise<void>;
}
```

**Create**: `apps/api/src/modules/catalogos/infra/prisma-catalog.repository.ts`

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CatalogKind } from '../domain/catalog-kind';
import type {
  CatalogItem,
  CatalogRepository,
} from '../domain/catalog.repository';

/**
 * Forma estrutural mínima compartilhada pelos quatro delegates do Prisma. O
 * `any` é deliberado e está confinado a este arquivo: os delegates gerados são
 * quatro tipos distintos e a união deles rejeitaria qualquer chamada. A tipagem
 * forte volta na fronteira, em `CatalogItem`. Mesmo padrão documentado em
 * apps/web/src/hooks/use-url-filters.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface CatalogDelegate {
  findMany(args: any): Promise<any[]>;
  findFirst(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  deleteMany(args: any): Promise<{ count: number }>;
  findFirstOrThrow(args: any): Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * O registry. É o único ponto que conhece a correspondência kind → tabela;
   * acrescentar um catálogo é acrescentar uma entrada aqui, uma em
   * `CATALOG_KINDS` e um `case` em `contarUsos`.
   */
  private delegate(kind: CatalogKind): CatalogDelegate {
    const db = this.prisma.db;
    switch (kind) {
      case 'servicos':
        return db.serviceCatalog as unknown as CatalogDelegate;
      case 'fontes-de-lead':
        return db.leadSourceCatalog as unknown as CatalogDelegate;
      case 'tipos-de-atividade':
        return db.activityTypeCatalog as unknown as CatalogDelegate;
      case 'motivos-de-perda':
        return db.lostReasonCatalog as unknown as CatalogDelegate;
    }
  }

  findAll(kind: CatalogKind, ownerId: string, incluirInativos: boolean) {
    return this.delegate(kind).findMany({
      where: { ownerId, ...(incluirInativos ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    }) as Promise<CatalogItem[]>;
  }

  findById(kind: CatalogKind, id: string, ownerId: string) {
    // findFirst (não findUnique): o filtro por ownerId faz parte da busca.
    return this.delegate(kind).findFirst({
      where: { id, ownerId },
    }) as Promise<CatalogItem | null>;
  }

  findByName(kind: CatalogKind, ownerId: string, name: string) {
    return this.delegate(kind).findFirst({
      where: { ownerId, name },
    }) as Promise<CatalogItem | null>;
  }

  create(
    kind: CatalogKind,
    data: { ownerId: string; name: string; isFollowUp?: boolean },
  ) {
    return this.delegate(kind).create({ data }) as Promise<CatalogItem>;
  }

  update(
    kind: CatalogKind,
    id: string,
    ownerId: string,
    data: { name?: string; active?: boolean; isFollowUp?: boolean },
  ) {
    // updateMany garante o filtro por ownerId; devolve o registro atualizado.
    const delegate = this.delegate(kind);
    return delegate
      .updateMany({ where: { id, ownerId }, data })
      .then(
        () => delegate.findFirstOrThrow({ where: { id, ownerId } }),
      ) as Promise<CatalogItem>;
  }

  async delete(kind: CatalogKind, id: string, ownerId: string) {
    await this.delegate(kind).deleteMany({ where: { id, ownerId } });
  }

  /**
   * `servicos` soma três tabelas porque `ServiceType` era NOT NULL em `Deal`,
   * `Proposal` e `Project`. Todas as contagens incluem arquivados: as FKs são
   * RESTRICT e um filho na lixeira faria o DELETE responder 500.
   */
  async contarUsos(kind: CatalogKind, id: string, ownerId: string) {
    const db = this.prisma.db;
    switch (kind) {
      case 'servicos': {
        const [deals, proposals, projects] = await Promise.all([
          db.deal.count({ where: { serviceTypeId: id, ownerId } }),
          db.proposal.count({ where: { serviceTypeId: id, ownerId } }),
          db.project.count({ where: { serviceTypeId: id, ownerId } }),
        ]);
        return deals + proposals + projects;
      }
      case 'fontes-de-lead':
        return db.client.count({ where: { sourceId: id, ownerId } });
      case 'tipos-de-atividade':
        return db.activity.count({ where: { typeId: id, ownerId } });
      case 'motivos-de-perda':
        return db.deal.count({ where: { lostReasonId: id, ownerId } });
    }
  }

  async desmarcarOutrosFollowUp(ownerId: string, exceto: string) {
    await this.prisma.db.activityTypeCatalog.updateMany({
      where: { ownerId, isFollowUp: true, id: { not: exceto } },
      data: { isFollowUp: false },
    });
  }
}
```

> **Nota para o /code**: `contarUsos` e `desmarcarOutrosFollowUp` referenciam colunas que só existem
> a partir das fases 3 e 4. Na Fase 1, implemente apenas o `case 'fontes-de-lead'` e deixe os outros
> `case` com `return 0` e um `// TODO Fase N` explícito; `desmarcarOutrosFollowUp` entra vazia na
> Fase 1 e ganha corpo na Fase 4. O mesmo vale para os `case` do `delegate()`: só `fontes-de-lead`
> na Fase 1.

**Create**: `apps/api/src/modules/catalogos/application/catalogos.service.ts`

```ts
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CATALOG_LABELS,
  KIND_COM_FOLLOW_UP,
  type CatalogKind,
} from '../domain/catalog-kind';
import {
  CATALOG_REPOSITORY,
  type CatalogItem,
  type CatalogRepository,
} from '../domain/catalog.repository';
import type { CreateCatalogItemDto } from '../api/dto/create-catalog-item.dto';
import type { UpdateCatalogItemDto } from '../api/dto/update-catalog-item.dto';

@Injectable()
export class CatalogosService {
  private readonly logger = new Logger(CatalogosService.name);

  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly repo: CatalogRepository,
  ) {}

  list(
    ownerId: string,
    kind: CatalogKind,
    incluirInativos = false,
  ): Promise<CatalogItem[]> {
    return this.repo.findAll(kind, ownerId, incluirInativos);
  }

  /**
   * Item do owner ou 404. É o `stages.findOne` desta fase: os módulos de negócio
   * chamam este método antes de gravar a FK, para que id de outro owner (ou
   * inexistente) responda 404 em vez de estourar na FK como 500.
   */
  async findOne(
    ownerId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<CatalogItem> {
    const item = await this.repo.findById(kind, id, ownerId);
    if (!item) {
      throw new NotFoundException(
        `${maiuscula(CATALOG_LABELS[kind])} não encontrado no catálogo.`,
      );
    }
    return item;
  }

  /**
   * Valida que o item pertence ao owner **e** está utilizável para uma escrita
   * nova. Item desativado continua rotulando registro antigo, mas não pode ser
   * escolhido num cadastro novo — senão a desativação não significaria nada.
   */
  async assertUtilizavel(
    ownerId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<CatalogItem> {
    const item = await this.findOne(ownerId, kind, id);
    if (!item.active) {
      throw new UnprocessableEntityException(
        `Este ${CATALOG_LABELS[kind]} está desativado. Reative-o no catálogo ou escolha outro.`,
      );
    }
    return item;
  }

  async create(
    ownerId: string,
    kind: CatalogKind,
    dto: CreateCatalogItemDto,
  ): Promise<CatalogItem> {
    const name = dto.name.trim();
    if (await this.repo.findByName(kind, ownerId, name)) {
      throw new ConflictException(
        `Já existe um ${CATALOG_LABELS[kind]} com este nome.`,
      );
    }
    this.assertFollowUpPermitido(kind, dto.isFollowUp);
    const criado = await this.repo.create(kind, {
      ownerId,
      name,
      ...(dto.isFollowUp !== undefined ? { isFollowUp: dto.isFollowUp } : {}),
    });
    if (dto.isFollowUp) {
      await this.repo.desmarcarOutrosFollowUp(ownerId, criado.id);
    }
    this.logger.log({
      evento: 'catalogo.item_criado',
      msg: 'Item de catálogo criado.',
      catalogo: kind,
      itemId: criado.id,
    });
    return criado;
  }

  async update(
    ownerId: string,
    kind: CatalogKind,
    id: string,
    dto: UpdateCatalogItemDto,
  ): Promise<CatalogItem> {
    const item = await this.findOne(ownerId, kind, id);
    const name = dto.name?.trim();
    if (name && name !== item.name) {
      if (await this.repo.findByName(kind, ownerId, name)) {
        throw new ConflictException(
          `Já existe um ${CATALOG_LABELS[kind]} com este nome.`,
        );
      }
    }
    this.assertFollowUpPermitido(kind, dto.isFollowUp);
    const atualizado = await this.repo.update(kind, id, ownerId, {
      ...(name ? { name } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.isFollowUp !== undefined ? { isFollowUp: dto.isFollowUp } : {}),
    });
    if (dto.isFollowUp) {
      await this.repo.desmarcarOutrosFollowUp(ownerId, id);
    }
    this.logger.log({
      evento: 'catalogo.item_atualizado',
      msg: 'Item de catálogo atualizado.',
      catalogo: kind,
      itemId: id,
    });
    return atualizado;
  }

  /**
   * Hard delete com guard: item em uso não é apagado. A mensagem instrui a
   * desativar — é a saída para o owner que já usou o item e não pode apagá-lo.
   */
  async delete(ownerId: string, kind: CatalogKind, id: string): Promise<void> {
    await this.findOne(ownerId, kind, id);
    const usos = await this.repo.contarUsos(kind, id, ownerId);
    if (usos > 0) {
      throw new ConflictException(
        `Não é possível excluir um ${CATALOG_LABELS[kind]} em uso por ${usos} registro(s), inclusive arquivados. Desative-o para tirá-lo dos formulários sem perder o histórico.`,
      );
    }
    await this.repo.delete(kind, id, ownerId);
    this.logger.log({
      evento: 'catalogo.item_excluido',
      msg: 'Item de catálogo excluído.',
      catalogo: kind,
      itemId: id,
    });
  }

  /**
   * `isFollowUp` é regra de um catálogo só. Aceitar o campo nos outros gravaria
   * uma coluna que não existe (500 do Prisma) — 422 é a resposta honesta.
   */
  private assertFollowUpPermitido(kind: CatalogKind, valor?: boolean): void {
    if (valor !== undefined && kind !== KIND_COM_FOLLOW_UP) {
      throw new UnprocessableEntityException(
        'Marcar follow-up só vale para tipos de atividade.',
      );
    }
  }
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
```

**Create**: `apps/api/src/modules/catalogos/api/dto/create-catalog-item.dto.ts`

```ts
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCatalogItemDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(60, { message: 'O nome deve ter no máximo 60 caracteres.' })
  name: string;

  /** Só aceito em `tipos-de-atividade`; nos outros o service responde 422. */
  @IsOptional() @IsBoolean() isFollowUp?: boolean;
}
```

**Create**: `apps/api/src/modules/catalogos/api/dto/update-catalog-item.dto.ts`

```ts
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCatalogItemDto } from './create-catalog-item.dto';

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {
  /** Desativa/reativa o item. Só o PATCH mexe nisso — o POST nasce ativo. */
  @IsOptional() @IsBoolean() active?: boolean;
}
```

**Create**: `apps/api/src/modules/catalogos/api/catalog-kind.pipe.ts`

```ts
import { Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';
import { isCatalogKind, type CatalogKind } from '../domain/catalog-kind';

/**
 * Valida o segmento `:kind` da rota. Kind desconhecido é **404** (a rota não
 * existe), não 400 — `/catalogos/inventado` não é um corpo mal formado.
 */
@Injectable()
export class CatalogKindPipe implements PipeTransform<string, CatalogKind> {
  transform(value: string): CatalogKind {
    if (!isCatalogKind(value)) throw new NotFoundException('Catálogo não encontrado.');
    return value;
  }
}
```

**Create**: `apps/api/src/modules/catalogos/api/catalogos.controller.ts`

```ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { CatalogosService } from '../application/catalogos.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CatalogKindPipe } from './catalog-kind.pipe';
import type { CatalogKind } from '../domain/catalog-kind';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';

/**
 * Os catálogos são **do owner**: cada workspace tem os seus (`ownerId` + RLS),
 * criados junto com a conta e configuráveis sem afetar ninguém.
 *
 * A **leitura não exige permissão de módulo**, de propósito: o `Select` de tipo
 * de serviço aparece no formulário de oportunidade, de proposta E de projeto —
 * quem tem `proposta:gerenciar` precisa ler o catálogo sem necessariamente ter
 * `oportunidade:ver`. Mesma escolha de `GET /permissions`. A escrita é uma só
 * chave, `catalogo:gerenciar`, porque a tela de configuração é uma só.
 */
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get(':kind')
  list(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Query('incluirInativos') incluirInativos?: string,
  ) {
    return this.catalogos.list(ownerId, kind, incluirInativos === 'true');
  }

  @RequirePermission('catalogo:gerenciar')
  @Post(':kind')
  create(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Body() dto: CreateCatalogItemDto,
  ) {
    return this.catalogos.create(ownerId, kind, dto);
  }

  @RequirePermission('catalogo:gerenciar')
  @Patch(':kind/:id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.catalogos.update(ownerId, kind, id, dto);
  }

  @RequirePermission('catalogo:gerenciar')
  @Delete(':kind/:id')
  remove(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Param('id') id: string,
  ) {
    return this.catalogos.delete(ownerId, kind, id);
  }
}
```

**Create**: `apps/api/src/modules/catalogos/catalogos.module.ts`

```ts
import { Module } from '@nestjs/common';
import { CatalogosController } from './api/catalogos.controller';
import { CatalogosService } from './application/catalogos.service';
import { CATALOG_REPOSITORY } from './domain/catalog.repository';
import { PrismaCatalogRepository } from './infra/prisma-catalog.repository';

/**
 * Não importa nenhum módulo de negócio — `contarUsos` fala com o Prisma direto.
 * É o que mantém o grafo acíclico: clients, pipeline, proposals, projects e
 * activities importam ESTE módulo, nunca o contrário.
 */
@Module({
  controllers: [CatalogosController],
  providers: [
    CatalogosService,
    { provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
  ],
  exports: [CatalogosService],
})
export class CatalogosModule {}
```

**Modify**: `apps/api/src/app.module.ts` — registrar `CatalogosModule` na lista de `imports`, junto
dos outros módulos de negócio.

#### Permissão

**Modify**: `apps/api/src/shared/permissions.ts`

Acrescentar ao array `PERMISSIONS`, na categoria `Organização` (depois de `papel:gerenciar`).
`ALL_PERMISSION_KEYS`, `GET /permissions` e o papel `system` são derivados — nada mais a mudar.

```ts
  {
    key: 'catalogo:gerenciar',
    label: 'Gerenciar catálogos',
    description:
      'Editar as listas do domínio da workspace: tipos de serviço, fontes de lead, tipos de atividade e motivos de perda',
    category: 'Organização',
  },
```

#### Provisionamento e seed

**Modify**: `apps/api/src/modules/users/users.service.ts`

Nos **dois** caminhos (`create:108-124` e `createWithOAuth:153-178`), acrescentar os nested creates
ao mesmo `admin.user.create` que já semeia assinatura, papel e estágios. Na Fase 1, só
`leadSourceCatalog`; as fases seguintes acrescentam as outras três linhas.

```ts
        pipelineStages: { create: this.defaultStages() },
        leadSourceCatalog: { create: defaultLeadSourceCatalog() },
        // Fase 3: serviceCatalog        · Fase 4: activityTypeCatalog
        // Fase 2: lostReasonCatalog
```

E o log, ao lado de `logStagesProvisioned`:

```ts
  /**
   * Log do provisionamento dos catálogos — vale para os dois caminhos de
   * cadastro. Um só evento para as quatro listas: elas nascem juntas.
   */
  private logCatalogsProvisioned(ownerId: string, quantidade: number) {
    this.logger.log({
      evento: 'catalogo.itens_provisionados',
      msg: 'Catálogos padrão criados para a conta nova.',
      ownerId,
      quantidade,
    });
  }
```

Chamar em ambos os caminhos, ao lado de `this.logStagesProvisioned(user.id)`.

**Modify**: `apps/api/prisma/seed.ts`

Criar os catálogos por owner **antes** dos clientes e substituir os 12 literais `source: 'ORGANIC'`
etc. pelos ids. Padrão: um `Map<string, string>` nome→id por catálogo, montado após o create do
owner, e um helper `fonte('Orgânico')`. Os literais de enum antigos mapeiam para os nomes padrão pela
mesma tabela da migration (`REFERRAL → Indicação`, `PAID_TRAFFIC → Tráfego pago`,
`ORGANIC → Orgânico`, `OUTBOUND → Prospecção ativa`, `OTHER → Outro`).

#### Portão de migration

**Modify**: `apps/api/prisma/fixtures/invariantes.sql`

Acrescentar ao fim do arquivo:

```sql
-- ---------------------------------------------------------------------------
-- Catálogo de fontes de lead (20260804100000_lead_source_catalog)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cruzados  INT;
  por_owner TEXT;
BEGIN
  -- Nenhum cliente pode apontar para a fonte de OUTRO owner. É o vazamento
  -- entre workspaces que o casamento por nome no backfill poderia causar.
  SELECT count(*) INTO cruzados
    FROM "Client" c
    JOIN "LeadSourceCatalog" s ON s."id" = c."sourceId"
   WHERE s."ownerId" <> c."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % cliente(s) apontando para fonte de lead de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;

  -- Cada owner da fixture tem de ter recebido as cinco fontes padrão.
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO por_owner
    FROM (SELECT "ownerId", count(*) AS n FROM "LeadSourceCatalog" GROUP BY "ownerId") t
   WHERE t.n <> 5;
  IF por_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de fontes de lead (esperado 5): %', por_owner;
  END IF;
END $$;

-- RLS de pé na tabela nova (mesma razão do bloco de PipelineStage acima).
DO $$
DECLARE sem_rls TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO sem_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('LeadSourceCatalog')
     AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE);
  IF sem_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela(s) de catálogo sem RLS habilitado e forçado: %', sem_rls;
  END IF;
END $$;
```

> Nas fases 2-4, **estender a lista** `IN ('LeadSourceCatalog', …)` deste segundo bloco em vez de
> duplicá-lo, e acrescentar um bloco de invariante próprio por migration.

**Modify**: `apps/api/test/rls.e2e-spec.ts:89` — `expect(Number(total)).toBe(18)` → `19`, com o
comentário-âncora já existente preservado.

#### Consumo: clientes

**Modify**: `apps/api/src/modules/clients/api/dto/create-client.dto.ts`

```ts
// ANTES:
//   @IsEnum(LeadSource, { message: 'Origem inválida.' })
//   source?: LeadSource;
  @IsOptional()
  @IsUUID('4', { message: 'Origem inválida.' })
  sourceId?: string | null;
```

Remover `LeadSource` do import de `@prisma/client`.

**Modify**: `apps/api/src/modules/clients/api/dto/list-clients-query.dto.ts` — o mesmo: `source?:
LeadSource` → `sourceId?: string` com `@IsUUID('4', { message: 'Origem inválida.' })`.

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts:47`

O `create` faz `{ ...dto }` — `sourceId` entra por spread sem validação, como o `assigneeId` já
entrava. Acrescentar a validação de pertencimento na mesma vizinhança do `assertMember`:

```ts
    await this.members.assertMember(ownerId, dto.assigneeId);
    // `sourceId` entra pelo spread do DTO. Sem esta linha, um id de outro owner
    // iria ao banco e estouraria na FK como 500 em vez de 404.
    if (dto.sourceId) {
      await this.catalogos.assertUtilizavel(ownerId, 'fontes-de-lead', dto.sourceId);
    }
```

Fazer o mesmo em `update`. Injetar `CatalogosService` no construtor e importar `CatalogosModule` em
`clients.module.ts`.

**Modify**: `apps/api/src/modules/clients/infra/prisma-client.repository.ts`

Incluir a linha do catálogo em todas as leituras (o objeto de `include` compartilhado do arquivo,
análogo ao `withClient` de `prisma-deal.repository.ts`):

```ts
  source: { select: { id: true, name: true, active: true } },
```

E o filtro da listagem passa de `source` para `sourceId`.

**Modify**: `apps/api/ENDPOINTS.md`

Nova seção `## Catálogos`, antes de `## Pipeline stages`, com os 4 endpoints no formato fixo de 6
rótulos. Espelhar a seção `Pipeline stages` (`:336-383`). E atualizar as seções de `Clients` onde
`source` aparece no Body/Resposta/query.

**Modify**: `docs/observabilidade.md` — acrescentar à tabela de eventos:

```
| `catalogo.item_criado` / `catalogo.item_atualizado` / `catalogo.item_excluido` | manutenção dos catálogos do owner | `info` |
| `catalogo.itens_provisionados` | conta nova criada (senha ou OAuth) | `info` |
```

#### Web

**Create**: `apps/web/src/features/catalogos/api/types.ts`

```ts
/** Os quatro catálogos configuráveis. O valor é o segmento de rota da API. */
export const CATALOG_KINDS = [
  'servicos',
  'fontes-de-lead',
  'tipos-de-atividade',
  'motivos-de-perda',
] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/**
 * Um item de catálogo. É este shape que as respostas de negócio embutem no
 * campo de relação (`deal.serviceType`, `client.source`, `activity.type`), e é
 * dele que a UI tira o rótulo — não há mais tradutor de compile-time.
 */
export interface CatalogItem {
  id: string;
  name: string;
  active: boolean;
  /** Só em `tipos-de-atividade`. */
  isFollowUp?: boolean;
}

export interface CreateCatalogItemBody {
  name: string;
  isFollowUp?: boolean;
}
export interface UpdateCatalogItemBody {
  name?: string;
  active?: boolean;
  isFollowUp?: boolean;
}
```

**Create**: `apps/web/src/features/catalogos/api/client.ts` — as 4 chamadas contra `/catalogos/:kind`,
seguindo o padrão de `features/pipeline/api/client.ts`.

**Create**: `apps/web/src/features/catalogos/api/hooks.ts`

```ts
/**
 * Invalidação: renomear ou desativar um item muda o rótulo **embutido** em todo
 * registro que o usa, então a mutação precisa derrubar também as listas de
 * negócio daquele catálogo. Sem isso a tela de clientes continuaria exibindo o
 * nome antigo até um refetch por outro motivo.
 */
const DEPENDENTES: Record<CatalogKind, readonly unknown[][]> = {
  servicos: [['deals', 'board'], ['proposals'], ['projects']],
  'fontes-de-lead': [['clients']],
  'tipos-de-atividade': [['activities'], ['dashboard']],
  'motivos-de-perda': [['deals', 'board']],
};
```

`useCatalogo(kind, { incluirInativos })` com `queryKey: ['catalogos', kind, incluirInativos]`, e
`useCreateCatalogItem` / `useUpdateCatalogItem` / `useDeleteCatalogItem` invalidando
`['catalogos', kind]` (por prefixo) + os dependentes. Nenhuma mutação otimista — não há reorder.

> Confirmar as chaves reais de `DEPENDENTES` contra `lib/query-keys.ts` (ou o equivalente do
> projeto) no momento da implementação; as acima são o formato esperado, não uma leitura verificada.

**Create**: `apps/web/src/features/catalogos/lib/options.ts`

```ts
import type { CatalogItem } from '../api/types';

/**
 * Opções de um Select de catálogo: os itens ativos MAIS o item atual do
 * registro, mesmo desativado. Sem isso, editar uma oportunidade cujo tipo de
 * serviço foi desativado apagaria o valor ao abrir o formulário.
 */
export function comItemAtual(
  itens: CatalogItem[] | undefined,
  atual?: CatalogItem | null,
): CatalogItem[] {
  const lista = itens ?? [];
  if (!atual || lista.some((i) => i.id === atual.id)) return lista;
  return [...lista, atual].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
```

**Create**: `apps/web/src/features/catalogos/CatalogTab.tsx`

Lista reusável parametrizada por `kind`. Molde: `StageConfigDialog.tsx`, **sem** dnd-kit.
- rename inline salvo no `onBlur` (com rollback e `toast.error(extractApiMessage(...))`);
- `Switch` de `active` ("Ativo");
- `Checkbox` de `isFollowUp` renderizado **apenas** quando `kind === 'tipos-de-atividade'`, com
  texto explicando que é a marca usada pelos lembretes;
- botão de lixeira → `ConfirmDialog` (a mensagem do 409 do servidor é o que o toast exibe);
- campo "Novo item" + botão Adicionar, com `Enter` submetendo;
- `Empty` quando não há item;
- lista carregada com `incluirInativos: true` (é a tela de configuração), item inativo com
  `text-muted-foreground` e badge "Desativado".

**Create**: `apps/web/src/features/catalogos/CatalogosLayout.tsx`

```tsx
/**
 * Catálogos são da **workspace**, não da conta — por isso ficam aqui e não em
 * `/configuracoes`, que é a tela da própria pessoa. A seção inteira exige
 * `catalogo:gerenciar` (ver a rota e `app/nav.ts`), então as abas não declaram
 * `permission` individual.
 */
const TABS: SectionTabItem[] = [
  { label: 'Serviços', to: '/catalogos', end: true },
  { label: 'Fontes de lead', to: '/catalogos/fontes-de-lead' },
  { label: 'Tipos de atividade', to: '/catalogos/tipos-de-atividade' },
  { label: 'Motivos de perda', to: '/catalogos/motivos-de-perda' },
];
```

Cabeçalho + `SectionTabs` + `Outlet`, no molde de `ConfiguracoesLayout.tsx`. Na Fase 1 só a aba
"Fontes de lead" existe; as outras entram na fase que cria a tabela correspondente.

**Modify**: `apps/web/src/routes/router.tsx`

```tsx
          {
            element: <PermissionRoute permission={['catalogo:gerenciar']} />,
            children: [
              {
                path: '/catalogos',
                element: <CatalogosLayout />,
                children: [
                  { index: true, element: <CatalogTab kind="servicos" /> },
                  { path: 'fontes-de-lead', element: <CatalogTab kind="fontes-de-lead" /> },
                  { path: 'tipos-de-atividade', element: <CatalogTab kind="tipos-de-atividade" /> },
                  { path: 'motivos-de-perda', element: <CatalogTab kind="motivos-de-perda" /> },
                ],
              },
            ],
          },
```

Na Fase 1, só a rota `fontes-de-lead` (e o `index` apontando para ela).

**Modify**: `apps/web/src/app/nav.ts` — item novo no grupo `Organização`, antes de `Auditoria`:

```ts
      { to: "/catalogos", label: "Catálogos", icon: BookMarked, permission: ["catalogo:gerenciar"] },
```

**Modify**: `apps/web/src/lib/labels.ts` — remover `LEAD_SOURCE_LABELS` e `translateLeadSource`
(linhas 20-27) e ajustar o comentário do topo:

```ts
/**
 * Tradução pt-BR dos enums de domínio (fonte: apps/api/prisma/schema.prisma).
 *
 * Regra: nenhum identificador técnico de enum aparece cru na UI — sempre passe
 * pelo tradutor correspondente. Ao adicionar um valor novo ao schema, inclua a
 * tradução aqui no mesmo PR (ver apps/web/CLAUDE.md).
 *
 * O que NÃO vive aqui: as quatro listas configuráveis pelo owner (tipos de
 * serviço, fontes de lead, tipos de atividade e motivos de perda). Elas vêm de
 * `GET /catalogos/:kind` já em pt-BR — o rótulo é o dado. Ver
 * `features/catalogos`.
 */
```

**Modify**: `apps/web/src/features/clientes/api/types.ts`
- remover `export type LeadSource = …`
- `source?: LeadSource | null` → `sourceId?: string | null` **e** `source?: CatalogItem | null`

**Modify**: `apps/web/src/features/clientes/ClientFormDialog.tsx`
- `source` no Zod passa a `z.string().uuid().optional()` sobre o **id**
- o `Select` carrega de `useCatalogo('fontes-de-lead')` + `comItemAtual(itens, client?.source)`,
  mantendo o item `''` "Não informada"
- `translateLeadSource(s)` → `item.name`

**Modify**: `apps/web/src/features/clientes/ClientesListPage.tsx`
- `source: enumFilter(Object.keys(LEAD_SOURCE_LABELS) …)` → `source: idFilter()`
- as `options` do `ColumnRadioFilter` vêm de `useCatalogo('fontes-de-lead')`; `translate` passa a ser
  uma função `(id) => nomePorId.get(id) ?? '—'`
- a célula da tabela (`:229`) usa `client.source?.name ?? '—'`

**Modify**: `apps/web/src/hooks/use-url-filters.ts` — codec novo:

```ts
/**
 * Id de item de catálogo (lista de runtime), com sentinela de "sem filtro".
 * Diferente de `enumFilter`, **não** há allowlist compilada para validar contra:
 * o catálogo é dado do owner. A proteção contra URL adulterada passa a ser do
 * servidor — o DTO exige `@IsUUID`, e um uuid de outro owner não casa a policy
 * de RLS e devolve lista vazia.
 */
export function idFilter(fallback = 'ALL' as const): FilterCodec<string> {
  return {
    decode: (raw) => raw ?? fallback,
    encode: (value) => (value === fallback ? null : value),
  };
}
```

**Modify**: `apps/web/src/features/clientes/tabs/DadosTab.tsx:86` — `translateLeadSource(client.source)`
→ `client.source?.name ?? ''`.

### Success Criteria

#### Automated Verification
- [x] `docker compose up -d` e depois `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — a migration roda sobre a fixture de dois owners e as invariantes novas passam
- [x] `pnpm --filter api exec prisma validate` — schema sem o enum `LeadSource` e com o model novo
- [x] Drift zero — com `DATABASE_URL` apontando para o banco local já migrado: `pnpm --filter api exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` (compara o banco real com o `schema.prisma`; sai 2 se divergirem). É o que prova que a migration escrita à mão bate com o schema, sem precisar de shadow database.
- [x] `pnpm --filter api test` — inclui o `catalogos.service.spec.ts` novo (50 suites, 444 testes)
- [x] `pnpm --filter api test:e2e` — `rls.e2e-spec.ts` com a contagem em 19 e nenhuma tabela desprotegida
- [x] `pnpm --filter api lint` e `pnpm --filter api build` — lint limpo (os 2 erros restantes em `main.ts` são pré-existentes, de trabalho não relacionado a esta fase — ver nota ao final)
- [x] `pnpm --filter web build` — `tsc -b` prova que nenhum `LeadSource` sobrou no web
- [x] `pnpm --filter web lint`
- [x] `grep -rn "LEAD_SOURCE_LABELS\|translateLeadSource" apps/web/src` — sem resultado
- [x] `grep -rn "LeadSource" apps/api/src` — só ocorrências de `LeadSourceCatalog`/`defaultLeadSourceCatalog`/`leadSourceCatalog` (o catálogo novo); o enum e o import de `@prisma/client` não existem mais

#### Manual Verification
- [ ] `pnpm --filter api exec prisma migrate reset --force` + seed: `/catalogos/fontes-de-lead` lista as 5 fontes padrão; criar, renomear e desativar funcionam
- [ ] Criar uma fonte com nome já existente → toast com "Já existe uma fonte de lead com este nome."
- [ ] Tentar excluir uma fonte usada por cliente → toast com o 409 instruindo a desativar; excluir uma fonte sem uso funciona
- [ ] Fonte desativada não aparece no `Select` do cadastro de cliente, mas o cliente que já a usava continua exibindo o nome dela na listagem e na aba Dados
- [ ] Filtro de Origem na listagem de clientes filtra corretamente e sobrevive a ida/volta para a tela de detalhe (o id fica na URL)
- [ ] Cadastrar uma conta nova (autocadastro) → a conta nasce com as 5 fontes; o log `catalogo.itens_provisionados` aparece no stdout como uma linha JSON
- [ ] Logar como colaborador **sem** `catalogo:gerenciar` → o item "Catálogos" não aparece na nav, `/catalogos` redireciona ao Dashboard, mas o `Select` de origem no cadastro de cliente **continua populado**

**⏸ PAUSE**: Após a verificação automatizada passar, parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Phase 2: `LostReasonCatalog`

### Goal

Motivo de perda passa de texto livre para lista configurável, preservando integralmente o histórico
já gravado (importado como itens desativados) e mantendo a regra do 422 condicional no `move`.

### Changes

#### Schema

**Modify**: `apps/api/prisma/schema.prisma`

```prisma
/// Motivos de perda do owner. Substitui o texto livre `Deal.lostReason`.
model LostReasonCatalog {
  id      String  @id @default(uuid())
  ownerId String
  owner   User    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name    String
  active  Boolean @default(true)
  deals   Deal[]

  @@unique([ownerId, name])
  @@index([ownerId])
}
```

Em `Deal` (linha 260): `lostReason String?` → `lostReasonId String?` +
`lostReason LostReasonCatalog? @relation(fields: [lostReasonId], references: [id])`, e
`@@index([lostReasonId])`. Back-relation `lostReasonCatalog LostReasonCatalog[]` no `User`.

**Create**: `apps/api/prisma/migrations/20260805100000_lost_reason_catalog/migration.sql`

Mesma espinha da Fase 1. As duas diferenças estão nos passos 2b e 4.

```sql
-- Motivos de perda deixam de ser texto livre e passam a ser catálogo por owner.
-- Segunda das quatro migrations da Fase 13-A.
--
-- Diferente das outras três, aqui NÃO há enum de origem: cada owner tem strings
-- próprias, digitadas à mão. A estratégia:
--   * semeia o catálogo padrão ATIVO (passo 2);
--   * importa cada string distinta já gravada como item DESATIVADO (passo 2b);
--   * religa os deals por nome, casefolded (passo 4).
-- Assim o histórico fica 100% preservado e legível, e o Select do produto mostra
-- só a lista padrão — o owner reativa o que quiser. Um motivo digitado que
-- coincida com um nome padrão (ex.: "preço") cai no item padrão ativo, e é isso
-- que se quer.

-- 0. Guard de integridade: Deal.ownerId tem de apontar para um owner real.
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
      'Migration abortada: % oportunidade(s) com "ownerId" que não corresponde a um owner em "User".',
      orfaos;
  END IF;
END $$;

-- 1. Tabela
CREATE TABLE "LostReasonCatalog" (
  "id"      TEXT    NOT NULL,
  "ownerId" TEXT    NOT NULL,
  "name"    TEXT    NOT NULL,
  "active"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "LostReasonCatalog_pkey" PRIMARY KEY ("id")
);

-- 2. Catálogo padrão, ATIVO, por owner (fonte: shared/default-catalogs.ts)
INSERT INTO "LostReasonCatalog" ("id", "ownerId", "name")
SELECT gen_random_uuid()::text, u."id", v.name
  FROM "User" u
 CROSS JOIN (VALUES
   ('Preço'), ('Prazo'), ('Sem resposta'), ('Escolheu concorrente'),
   ('Sem verba'), ('Fora do perfil'), ('Outro')
 ) AS v(name)
 WHERE u."ownerId" IS NULL;

-- 2b. Importa o histórico como itens DESATIVADOS
-- O GROUP BY lower(btrim(...)) dedupe por owner ignorando caixa e espaço nas
-- pontas; min() escolhe uma grafia determinística entre as variantes. O NOT
-- EXISTS evita duplicar um motivo que já é um dos padrões (aí o deal cai no
-- item ativo, no passo 4).
INSERT INTO "LostReasonCatalog" ("id", "ownerId", "name", "active")
SELECT gen_random_uuid()::text, t."ownerId", t.name, false
  FROM (
    SELECT d."ownerId", min(btrim(d."lostReason")) AS name
      FROM "Deal" d
     WHERE d."lostReason" IS NOT NULL AND btrim(d."lostReason") <> ''
     GROUP BY d."ownerId", lower(btrim(d."lostReason"))
  ) t
 WHERE NOT EXISTS (
   SELECT 1 FROM "LostReasonCatalog" c
    WHERE c."ownerId" = t."ownerId" AND lower(c."name") = lower(t.name)
 );

-- 3. Coluna FK nulável
ALTER TABLE "Deal" ADD COLUMN "lostReasonId" TEXT;

-- 4. Backfill por nome casefolded, dentro do próprio owner
UPDATE "Deal" d
   SET "lostReasonId" = c."id"
  FROM "LostReasonCatalog" c
 WHERE c."ownerId"    = d."ownerId"
   AND lower(c."name") = lower(btrim(d."lostReason"))
   AND d."lostReason" IS NOT NULL
   AND btrim(d."lostReason") <> '';

-- 5. Guard pós-backfill e drop da coluna de texto
DO $$
DECLARE perdidos INT;
BEGIN
  SELECT count(*) INTO perdidos
    FROM "Deal"
   WHERE "lostReason" IS NOT NULL
     AND btrim("lostReason") <> ''
     AND "lostReasonId" IS NULL;
  IF perdidos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % oportunidade(s) com motivo de perda não encontraram linha no catálogo do próprio owner.',
      perdidos;
  END IF;
END $$;

ALTER TABLE "Deal" DROP COLUMN "lostReason";

-- 6. Índices e FKs (molde da Fase 1)
CREATE UNIQUE INDEX "LostReasonCatalog_ownerId_name_key" ON "LostReasonCatalog"("ownerId", "name");
CREATE INDEX "LostReasonCatalog_ownerId_idx" ON "LostReasonCatalog"("ownerId");
ALTER TABLE "LostReasonCatalog" ADD CONSTRAINT "LostReasonCatalog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Deal_lostReasonId_idx" ON "Deal"("lostReasonId");
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_lostReasonId_fkey"
  FOREIGN KEY ("lostReasonId") REFERENCES "LostReasonCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. RLS (molde de 20260724050000_enable_rls)
ALTER TABLE "LostReasonCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LostReasonCatalog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "LostReasonCatalog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "LostReasonCatalog" TO crm_app;
```

#### API

**Modify**: `apps/api/src/modules/pipeline/api/dto/move-deal.dto.ts`

```ts
  // ANTES: @IsOptional() @IsString() lostReason?: string;
  /**
   * Obrigatoriedade é **condicional** (só quando o estágio destino é `isLost`),
   * então fica no service e responde 422 — não 400. Ver `DealsService.move`.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Motivo de perda inválido.' })
  lostReasonId?: string;
```

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts:159-168`

A regra se preserva integralmente; só a validação do valor entra:

```ts
    const patch: { stageMovedAt?: Date; lostReasonId?: string | null } = {};
    if (stageChanged) patch.stageMovedAt = new Date();
    if (targetStage.isLost) {
      if (!dto.lostReasonId)
        throw new UnprocessableEntityException('Informe o motivo da perda.');
      // Motivo de outro owner (ou desativado) não pode entrar na FK.
      await this.catalogos.assertUtilizavel(
        ownerId,
        'motivos-de-perda',
        dto.lostReasonId,
      );
      patch.lostReasonId = dto.lostReasonId;
    } else if (stageChanged) {
      patch.lostReasonId = null; // saiu de "Perdeu" → limpa o motivo
    }
```

Injetar `CatalogosService`; importar `CatalogosModule` em `pipeline.module.ts`.

**Modify**: `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:17` — acrescentar ao
`withClient`:

```ts
  lostReason: { select: { id: true, name: true, active: true } },
```

**Modify**: `apps/api/prisma/fixtures/invariantes.sql` — bloco novo: nenhum deal aponta para motivo
de outro owner; cada owner da fixture tem ao menos os 7 padrões; e `LostReasonCatalog` entra na lista
do bloco de RLS.

**Modify**: `apps/api/test/rls.e2e-spec.ts` — `19` → `20`.

**Modify**: `apps/api/src/shared/default-catalogs.ts` — já contém a lista; só o consumo entra agora.

**Modify**: `apps/api/src/modules/users/users.service.ts` — `lostReasonCatalog: { create:
defaultLostReasonCatalog() }` nos dois caminhos; ajustar a `quantidade` do log.

**Modify**: `apps/api/prisma/seed.ts` — o `lostReason` da linha 715 vira `lostReasonId` apontando
para o item "Escolheu concorrente" do owner.

**Modify**: `apps/api/src/modules/catalogos/infra/prisma-catalog.repository.ts` — habilitar o
`case 'motivos-de-perda'` no `delegate()` e no `contarUsos()`.

**Modify**: `apps/api/ENDPOINTS.md` — `PATCH /deals/:id/move`: `lostReason` → `lostReasonId`, com o
422 e o novo 404/422 de item inválido; e a Resposta de `Deal` passa a incluir `lostReason: { id, name,
active } | null`.

#### Web

**Modify**: `apps/web/src/features/pipeline/api/types.ts`
- `lostReason?: string | null` → `lostReasonId?: string | null` + `lostReason?: CatalogItem | null`
- `MoveDealBody.lostReason?: string` → `lostReasonId?: string`

**Modify**: `apps/web/src/features/pipeline/LostReasonDialog.tsx`

O `<textarea>` vira `Select` de `useCatalogo('motivos-de-perda')`. A prop
`onConfirm: (reason: string) => void` passa a `onConfirm: (lostReasonId: string) => void`; o estado
local `reason` vira `reasonId`. A validação local ("Informe o motivo da perda.") permanece — é o
espelho do 422. Acrescentar `EmptyState` inline com link para `/catalogos/motivos-de-perda` caso o
catálogo esteja vazio (owner que apagou tudo), para o diálogo não travar sem saída.

**Modify**: o chamador do `LostReasonDialog` no quadro do pipeline — passar `lostReasonId` ao `move`.

**Primeiro caminho de leitura de `lostReason`** (hoje inexistente): exibir o motivo onde a
oportunidade perdida aparece.
- **Modify** `apps/web/src/features/pipeline/components/DealCard.tsx` — quando
  `deal.lostReason`, um `Badge variant="destructive"` com `deal.lostReason.name`.
- **Modify** `apps/web/src/features/clientes/tabs/OportunidadesTab.tsx:51` — acrescentar
  `· {deal.lostReason.name}` na linha de metadados quando houver.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — verde com as invariantes novas
- [x] `pnpm --filter api exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` — sem drift
- [x] `pnpm --filter api test` — `deals.service.spec.ts` cobre o 422 com `lostReasonId` ausente e o 422 de motivo desativado
- [x] `pnpm --filter api test:e2e` — contagem de policies em 20 (na época desta fase; 22 ao fim da 13-A)
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter web build && pnpm --filter web lint`
- [x] `grep -rn "lostReason\b" apps/api/src | grep -v lostReasonId` — só o `include` da relação

#### Manual Verification
- [ ] Antes de resetar o banco: criar 3 deals perdidos com motivos digitados à mão (um repetido com caixa diferente, um coincidindo com um nome padrão), aplicar a migration e confirmar que o catálogo ganhou **um** item desativado por texto distinto, que o coincidente caiu no padrão ativo, e que os três deals apontam para o item certo
- [ ] Arrastar um deal para "Perdeu" → o diálogo abre com `Select` dos motivos ativos; confirmar sem escolher → mensagem inline; escolher → o deal move e o card exibe o badge do motivo
- [ ] Mover o deal de volta para outro estágio → o motivo é limpo (o badge desaparece)
- [ ] Desativar um motivo em uso → sai do `Select` do diálogo, mas o card do deal que o usa continua exibindo o nome
- [ ] `/catalogos/motivos-de-perda` mostra os padrões ativos e os importados desativados, com o badge "Desativado"

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: `ServiceCatalog`

### Goal

Tipo de serviço vira catálogo por owner — a migration mais pesada do lote: FK nova em **três**
tabelas com dado vivo e `NOT NULL` sem default.

### Changes

#### Schema

**Modify**: `apps/api/prisma/schema.prisma`

```prisma
/// Tipos de serviço do owner. Substitui o enum fechado `ServiceType`, que era
/// NOT NULL em Deal, Proposal e Project — daí as três back-relations.
model ServiceCatalog {
  id        String     @id @default(uuid())
  ownerId   String
  owner     User       @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name      String
  active    Boolean    @default(true)
  deals     Deal[]
  proposals Proposal[]
  projects  Project[]

  @@unique([ownerId, name])
  @@index([ownerId])
}
```

`Deal.serviceType` (:256), `Proposal.serviceType` (:292) e `Project.serviceType` (:337) → cada um
`serviceTypeId String` (NOT NULL) + `serviceType ServiceCatalog @relation(fields: [serviceTypeId],
references: [id])`, com `@@index([serviceTypeId])`. Remover `enum ServiceType` (:518-522).
Back-relation `serviceCatalog ServiceCatalog[]` no `User`.

**Create**: `apps/api/prisma/migrations/20260806100000_service_catalog/migration.sql`

Espinha da Fase 1, repetida para as três tabelas. Pontos que **não** existem nas outras migrations:

```sql
-- Tipos de serviço deixam de ser enum fechado e passam a ser catálogo por owner.
-- Terceira das quatro migrations da Fase 13-A, e a única com FK NOT NULL.
--
-- Não existe caminho "nulável primeiro" para a coluna final: `ADD COLUMN NOT
-- NULL` sem default falha com dado dentro. A ordem obrigatória é a da 7A:
-- coluna nulável → backfill → guard → SET NOT NULL. E o guard aqui não é
-- opcional: um único NULL sobrevivente faria o SET NOT NULL abortar no meio da
-- migration, com a coluna antiga já derrubada em Deal mas não em Proposal.
--
-- Por isso o SET NOT NULL das TRÊS tabelas vem antes de qualquer DROP COLUMN.

-- 0. Guard de integridade nas três tabelas (mesmo molde da Fase 1, com
--    Deal / Proposal / Project no lugar de Client).

-- 1. CREATE TABLE "ServiceCatalog" (id, ownerId, name, active) — molde da Fase 1.

-- 2. Semeia por owner: ('Software'), ('Website'), ('Tráfego pago')
--    ⚠️ 'Tráfego pago' é também um nome do catálogo de fontes de lead
--    (PAID_TRAFFIC existia nos DOIS enums). São tabelas diferentes: não há
--    colisão, mas busca-e-substitui cega no literal ou no rótulo corrompe o
--    outro catálogo. Ver a nota de "Constraints" no PRD.

-- 3. Três colunas FK NULÁVEIS
ALTER TABLE "Deal"     ADD COLUMN "serviceTypeId" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "serviceTypeId" TEXT;
ALTER TABLE "Project"  ADD COLUMN "serviceTypeId" TEXT;

-- 4. Backfill das três, com o mesmo mapa enum→nome
--    (repetir o UPDATE … FROM (VALUES ('SOFTWARE','Software'),
--     ('WEBSITE','Website'), ('PAID_TRAFFIC','Tráfego pago')) para cada tabela,
--     sempre com `cat."ownerId" = <tabela>."ownerId"`)

-- 5. Guard: nenhuma das três pode ter sobrado NULL. A coluna antiga é NOT NULL,
--    então TODA linha tinha valor — qualquer NULL aqui é backfill incompleto.
DO $$
DECLARE d INT; p INT; j INT;
BEGIN
  SELECT count(*) INTO d FROM "Deal"     WHERE "serviceTypeId" IS NULL;
  SELECT count(*) INTO p FROM "Proposal" WHERE "serviceTypeId" IS NULL;
  SELECT count(*) INTO j FROM "Project"  WHERE "serviceTypeId" IS NULL;
  IF d + p + j > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % deal(s), % proposta(s) e % projeto(s) não encontraram tipo de serviço no catálogo do próprio owner.',
      d, p, j;
  END IF;
END $$;

-- 6. SET NOT NULL nas três, ANTES de qualquer DROP COLUMN
ALTER TABLE "Deal"     ALTER COLUMN "serviceTypeId" SET NOT NULL;
ALTER TABLE "Proposal" ALTER COLUMN "serviceTypeId" SET NOT NULL;
ALTER TABLE "Project"  ALTER COLUMN "serviceTypeId" SET NOT NULL;

-- 7. Só então derrubar as colunas antigas e o tipo
ALTER TABLE "Deal"     DROP COLUMN "serviceType";
ALTER TABLE "Proposal" DROP COLUMN "serviceType";
ALTER TABLE "Project"  DROP COLUMN "serviceType";
DROP TYPE "ServiceType";

-- 8. Índices e FKs (unique composta, índice de ownerId, FK para User CASCADE,
--    três índices `<tabela>_serviceTypeId_idx` e três FKs RESTRICT)

-- 9. RLS: molde literal da Fase 1, para "ServiceCatalog".
```

#### API

- **Modify** `create-deal.dto.ts:27-28`, `create-proposal.dto.ts:25-26`,
  `create-project.dto.ts:19-20` — `@IsEnum(ServiceType)` → `@IsUUID('4', { message: 'Tipo de serviço
  inválido.' }) serviceTypeId: string;` (obrigatório nos três). Remover o import de `ServiceType`.
- **Modify** `deals.service.ts`, `proposals.service.ts`, `projects.service.ts` — `assertUtilizavel(ownerId,
  'servicos', dto.serviceTypeId)` no `create` e no `update` (quando o campo vem no DTO).
- **Modify** `apps/api/src/modules/projects/application/projects.service.ts:146` — a cópia
  `serviceType: deal.serviceType` vira `serviceTypeId: deal.serviceTypeId`, com o guard explícito
  que o PRD pede:

```ts
    // Cópia de FK entre registros: o item do catálogo tem de pertencer ao MESMO
    // owner do projeto que está sendo criado. Hoje `deal.ownerId` é o owner do
    // request, então isto é redundante por construção — e é exatamente por isso
    // que fica escrito: se um dia o criar-ao-ganhar rodar fora do contexto do
    // owner, esta linha é o que impede a FK cruzada.
    await this.catalogos.findOne(deal.ownerId, 'servicos', deal.serviceTypeId);
```

- **Modify** `apps/api/src/modules/proposals/application/proposals.service.ts:246` — o mesmo no
  `newVersion`.
- **Modify** os repositórios de deal, proposal e project — `serviceType: { select: { id: true, name:
  true, active: true } }` nos `include` compartilhados.
- **Modify** `prisma-catalog.repository.ts` — habilitar `case 'servicos'` no `delegate()` e as três
  contagens do `contarUsos()`.
- **Modify** `users.service.ts` (dois caminhos), `prisma/seed.ts` (23 literais),
  `invariantes.sql` (bloco novo com as três checagens de owner cruzado + `ServiceCatalog` na lista de
  RLS), `rls.e2e-spec.ts` (`20` → `21`), `ENDPOINTS.md` (Deals, Proposals, Projects).

**⚠️ Fixture do portão**: [banco-populado.sql:57-63](../../apps/api/prisma/fixtures/banco-populado.sql#L57)
insere 3 `Deal` com `"serviceType"` literal. **Não alterar a fixture** — ela usa só colunas do
`init`, que ainda tem o enum, e é justamente esse dado que exercita o backfill nos dois owners. A
regra de `apps/api/CLAUDE.md` é explícita: se o portão ficar vermelho, o conserto é na migration.

#### Web

- **Modify** os três `api/types.ts` (`pipeline`, `propostas`, `demandas`): remover
  `export type ServiceType = …` e trocar `serviceType: ServiceType` por `serviceTypeId: string` +
  `serviceType: CatalogItem`. Importar `CatalogItem` de `@/features/catalogos/api/types`.
- **Modify** `DealFormDialog.tsx`, `ProposalFormDialog.tsx`, `ProjectFormDialog.tsx`:
  - `z.enum(['SOFTWARE','WEBSITE','PAID_TRAFFIC'])` → `z.string().uuid('Selecione o tipo de serviço.')`
    sobre `serviceTypeId`
  - **os defaults `'SOFTWARE'` saem** (`DealFormDialog:82,104`; `ProposalFormDialog:52`;
    `ProjectFormDialog:61,77`) → `serviceTypeId: ''`. O campo já é obrigatório e exibe asterisco;
    sem catálogo universal não existe default.
  - `Select` de `useCatalogo('servicos')` + `comItemAtual(itens, registro?.serviceType)`
- **Modify** os 6 sites de leitura — `translateServiceType(x.serviceType)` → `x.serviceType.name`:
  `DealCard.tsx:33`, `OportunidadesTab.tsx:51`, `PropostasListPage.tsx:191`,
  `PropostaDetalhePage.tsx:242`, `ProjetosListPage.tsx:177`, `ProjetoDetalhePage.tsx:146`
- **Modify** `labels.ts` — remover `SERVICE_TYPE_LABELS` e `translateServiceType` (:37-42)
- **Modify** `CatalogosLayout.tsx` / `router.tsx` — habilitar a aba "Serviços" (que é o `index`)

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — **portão crítico da fase**: os 3 deals da fixture, em dois owners, saíram com `serviceTypeId` do próprio owner
- [x] `pnpm --filter api exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` — sem drift
- [x] `pnpm --filter api test && pnpm --filter api test:e2e` — policies em 21 (na época desta fase)
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter web build && pnpm --filter web lint`
- [x] `grep -rn "ServiceType\|SERVICE_TYPE_LABELS\|SOFTWARE" apps/web/src apps/api/src` — só um comentário explicativo
- [x] `psql … -c '\d "Deal"'` — `serviceTypeId` é `not null` e tem FK RESTRICT para `ServiceCatalog`

#### Manual Verification
- [ ] Após `migrate reset` + seed: os 3 serviços padrão aparecem em `/catalogos`; criar "Consultoria" e usá-lo numa oportunidade nova
- [ ] O formulário de oportunidade abre **sem** tipo pré-selecionado, e submeter sem escolher mostra a mensagem de obrigatório
- [ ] Ganhar uma oportunidade → o projeto criado herda o mesmo tipo de serviço
- [ ] Criar nova versão de uma proposta → a versão herda o tipo de serviço da origem
- [ ] Tentar excluir "Website" com deals/propostas/projetos usando → 409 com a contagem somada das três tabelas
- [ ] Desativar "Website" → sai dos três formulários, mas os 6 sites de leitura continuam exibindo "Website" nos registros antigos
- [ ] Editar uma oportunidade cujo tipo foi desativado → o `Select` abre com o valor atual preservado (não zerado)

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4: `ActivityTypeCatalog` + unificação do follow-up

### Goal

Tipos de atividade viram catálogo, `FOLLOW_UP` deixa de ser literal e passa a ser a coluna
`isFollowUp`, e os **três** predicados divergentes de "follow-up pendente" convergem para um só.

### Changes

#### Schema

**Modify**: `apps/api/prisma/schema.prisma`

```prisma
/// Tipos de atividade do owner. Substitui o enum fechado `ActivityType`.
model ActivityTypeCatalog {
  id         String     @id @default(uuid())
  ownerId    String
  owner      User       @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name       String
  /// É REGRA, não rótulo: marca o tipo que representa follow-up agendado. O cron
  /// de lembretes (cross-owner, pelo client admin) e o dashboard filtram por
  /// ela — é o análogo de `PipelineStage.isWon`/`isLost`. No máximo um item por
  /// owner fica marcado (garantido no `CatalogosService`, não no banco: um
  /// unique parcial impediria desmarcar-e-remarcar numa transação).
  isFollowUp Boolean    @default(false)
  active     Boolean    @default(true)
  activities Activity[]

  @@unique([ownerId, name])
  @@index([ownerId])
  @@index([isFollowUp]) // ← o cron cross-owner filtra pela relação
}
```

`Activity.type` (:441) → `typeId String` (NOT NULL) + `type ActivityTypeCatalog @relation(fields:
[typeId], references: [id])`, com `@@index([typeId])`. Remover `enum ActivityType` (:583-590).
Back-relation `activityTypeCatalog ActivityTypeCatalog[]` no `User`.

**Create**: `apps/api/prisma/migrations/20260807100000_activity_type_catalog/migration.sql`

Espinha da Fase 3 (FK NOT NULL, uma tabela só). Detalhe próprio: a coluna `isFollowUp` é semeada
junto, e o mapa enum→nome traz o flag.

```sql
-- 2. Semeia por owner, com o flag de regra
INSERT INTO "ActivityTypeCatalog" ("id", "ownerId", "name", "isFollowUp")
SELECT gen_random_uuid()::text, u."id", v.name, v.is_follow_up
  FROM "User" u
 CROSS JOIN (VALUES
   ('Anotação',  false),
   ('Ligação',   false),
   ('Reunião',   false),
   ('E-mail',    false),
   ('WhatsApp',  false),
   ('Follow-up', true)
 ) AS v(name, is_follow_up)
 WHERE u."ownerId" IS NULL;

-- 4. Backfill: NOTE→Anotação, CALL→Ligação, MEETING→Reunião, EMAIL→E-mail,
--    WHATSAPP→WhatsApp, FOLLOW_UP→Follow-up (sempre com
--    `cat."ownerId" = a."ownerId"`).

-- 5b. Guard extra desta migration: cada owner precisa ter EXATAMENTE UM tipo
--     com isFollowUp. O cron depende disso; zero marcados apagaria os
--     lembretes em silêncio.
DO $$
DECLARE ruins TEXT;
BEGIN
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO ruins
    FROM (
      SELECT "ownerId", count(*) FILTER (WHERE "isFollowUp") AS n
        FROM "ActivityTypeCatalog" GROUP BY "ownerId"
    ) t
   WHERE t.n <> 1;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de tipos marcados como follow-up (esperado 1): %', ruins;
  END IF;
END $$;
```

#### API — os dois branches de `FOLLOW_UP`

**Modify**: `apps/api/src/modules/notifications/infra/prisma-notification-triggers.repository.ts:32-38`

```ts
  /** (a) Follow-up agendado para hoje e ainda não concluído. */
  async followUpsDoDia(de: Date, ate: Date): Promise<AlvoDeLembrete[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS),
    // e isso vale também para ActivityTypeCatalog no filtro relacional abaixo.
    //
    // `type: { isFollowUp: true }` substitui o antigo `type: 'FOLLOW_UP'`: com
    // catálogo por owner não existe mais um literal comparável entre workspaces,
    // e a regra passou para uma coluna da linha do catálogo (o análogo de
    // `PipelineStage.isWon`). A seletividade continua vindo do índice
    // [scheduledFor, completedAt]; o filtro relacional só descarta os tipos
    // errados dentro da janela do dia.
    const alvos = await this.admin.activity.findMany({
      where: {
        type: { isFollowUp: true },
        completedAt: null,
        scheduledFor: { gte: de, lte: ate },
      },
      select: { /* … sem alteração … */ },
    });
```

**Modify**: `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:177-194`

`type: 'FOLLOW_UP'` → `type: { isFollowUp: true }`, e o `select` de `type` passa a
`type: { select: { id: true, name: true, active: true } }`.

**Modify**: `apps/api/src/modules/dashboard/domain/dashboard.repository.ts:5,43` —
`type: ActivityType` → `type: { id: string; name: string; active: boolean }`; remover o import.

**Modify**: `apps/api/src/modules/activities/api/dto/create-activity.dto.ts:14-15` —
`@IsEnum(ActivityType)` → `@IsUUID('4', { message: 'Tipo de atividade inválido.' }) typeId: string;`

**Modify**: `apps/api/src/modules/activities/application/activities.service.ts` —
`assertUtilizavel(ownerId, 'tipos-de-atividade', dto.typeId)` no `create` e no `update`.

**Modify**: `apps/api/src/modules/activities/infra/prisma-activity.repository.ts` — `include` do
`type`.

**Modify**: `prisma-catalog.repository.ts` — habilitar `case 'tipos-de-atividade'` no `delegate()`, o
`contarUsos()` e dar corpo a `desmarcarOutrosFollowUp`.

**Modify**: `users.service.ts` (dois caminhos, com `defaultActivityTypeCatalog()`), `prisma/seed.ts`
(10 literais), `invariantes.sql` (owner cruzado + exatamente-um-isFollowUp + `ActivityTypeCatalog` na
lista de RLS), `rls.e2e-spec.ts` (`21` → `22`), `ENDPOINTS.md` (Activities, Dashboard, e a nota de
`isFollowUp` na seção Catálogos).

#### Web

**Modify**: `apps/web/src/features/clientes/api/types.ts` — remover `ActivityType`;
`Activity.type: ActivityType` → `typeId: string` + `type: CatalogItem`.

**Modify**: `apps/web/src/features/dashboard/api/types.ts` — remover `ActivityType` (:4-10);
`UpcomingAction.type` passa a `CatalogItem`.

**Modify**: `apps/web/src/features/clientes/tabs/TimelineTab.tsx` — três mudanças:

```tsx
// 1. Zod: o z.enum hardcoded sai
const schema = z.object({
  typeId: z.string().uuid('Selecione o tipo.'),
  content: z.string().min(1, 'O conteúdo é obrigatório.'),
  scheduledFor: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
});

// 2. O Select vem do catálogo (com o item atual preservado na edição)
const { data: tipos } = useCatalogo('tipos-de-atividade');

// 3. O predicado de follow-up pendente passa a ser UM SÓ, derivado da regra do
//    catálogo — antes esta linha divergia das duas queries do servidor, que
//    filtravam por `type === 'FOLLOW_UP'`.
const pendingFollowUp =
  !!activity.type.isFollowUp && !!activity.scheduledFor && !activity.completedAt;
```

O campo "Agendar para" (`type === 'FOLLOW_UP'`, :257) passa a depender do `isFollowUp` do tipo
selecionado; o mesmo no `onSubmit` (:109). `translateActivityType(activity.type)` → `activity.type.name`.

**Modify**: `apps/web/src/features/dashboard/DashboardPage.tsx:277` —
`translateActivityType(action.type)` → `action.type.name`.

**Modify**: `apps/web/src/lib/labels.ts` — remover `ACTIVITY_TYPE_LABELS` e
`translateActivityType` (:120-128). Com isso `labels.ts` não tem mais nenhuma das quatro listas.

**Modify**: `CatalogosLayout.tsx` / `router.tsx` — habilitar as abas "Tipos de atividade" e
"Motivos de perda" (a última desde a Fase 2), completando as quatro.

**Modify**: `apps/web/src/features/catalogos/CatalogTab.tsx` — o `Checkbox` de `isFollowUp` (já
previsto na Fase 1) ganha a semântica de rádio: marcar um item desmarca o anterior, com texto
"Usado pelos lembretes de follow-up" e aviso de que exatamente um tipo deve estar marcado.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — verde, incluindo o guard de exatamente-um-`isFollowUp` por owner
- [x] `pnpm --filter api exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` — sem drift
- [x] Spec novo do `followUpsDoDia` cobrindo dois owners com catálogos independentes — ficou em `test/follow-up-cron.e2e-spec.ts` (ver "Desvios" ao fim)
- [x] `pnpm --filter api test:e2e` — policies em **22**, 26 testes em 3 suítes
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter web build && pnpm --filter web lint`
- [x] `grep -rn "FOLLOW_UP" apps/api/src apps/web/src` — só dois comentários explicativos (o enum `NotificationType.FOLLOW_UP_DUE` é outro e permanece)
- [x] `grep -rn "ACTIVITY_TYPE_LABELS\|SERVICE_TYPE_LABELS\|LEAD_SOURCE_LABELS" apps/web/src` — sem resultado

#### Manual Verification
- [ ] **O cron**: com dois owners, cada um com uma atividade de follow-up agendada para hoje, disparar a rotina das 6h (ou chamar o service à mão) e confirmar que **os dois** owners recebem lembrete — é o caminho que roda sem `app.owner_id`
- [ ] Renomear "Follow-up" para "Retomar contato" num owner → o lembrete continua saindo (a regra é `isFollowUp`, não o nome)
- [ ] Marcar `isFollowUp` em outro tipo → o anterior é desmarcado automaticamente na mesma tela
- [ ] Dashboard: o bloco "Próximas ações" lista as atividades do tipo marcado, com o nome do catálogo
- [ ] Timeline: criar atividade do tipo marcado → o campo "Agendar para" aparece; criar de outro tipo → não aparece; o badge "Concluir" só surge no tipo marcado com data e sem conclusão
- [ ] Tentar excluir um tipo com atividades → 409 instruindo a desativar
- [ ] `PATCH /catalogos/servicos/:id` com `{ "isFollowUp": true }` → `422 Marcar follow-up só vale para tipos de atividade.`

**⏸ PAUSE**: Fase final — confirmação humana e atualização do `ROADMAP.md` (marcar os três itens da Frente A da Fase 13).

---

## Testing Strategy

### Unit Tests

- **`apps/api/src/modules/catalogos/application/catalogos.service.spec.ts`** (novo, Fase 1) — mock da
  interface `CatalogRepository`, no molde de `pipeline-stages.service.spec.ts`:
  - `409` de nome duplicado no `create` e no `update` (e **não** dispara quando o nome não mudou)
  - `404` para item de outro owner (repositório devolve `null`)
  - `409` de exclusão com `contarUsos > 0`, e a mensagem contém a contagem e a instrução de desativar
  - `422` de `isFollowUp` em kind ≠ `tipos-de-atividade`
  - `422` de `assertUtilizavel` com item `active: false`
  - `list` sem `incluirInativos` repassa `false` ao repositório
  - `create`/`update` com `isFollowUp: true` chamam `desmarcarOutrosFollowUp`
  - `name` é trimado antes da checagem de duplicidade
- **`deals.service.spec.ts`** (Fase 2) — o 422 "Informe o motivo da perda." continua quando
  `lostReasonId` falta; motivo desativado responde 422; sair de estágio `isLost` zera `lostReasonId`
- **`activities.service.spec.ts`** (Fase 4) — valida `typeId` pelo `CatalogosService`
- **`projects.service.spec.ts` / `proposals.service.spec.ts`** (Fase 3) — a cópia de `serviceTypeId`
  passa pelo `findOne` do catálogo com o `ownerId` do registro de destino
- **`prisma-notification-triggers.repository.spec.ts`** (Fase 4) — a classe fala com infraestrutura
  direto, então o spec a **instancia de verdade** (regra de `apps/api/CLAUDE.md`): dois owners, cada
  um com `ActivityTypeCatalog` próprio e um item `isFollowUp`, uma atividade agendada cada →
  `followUpsDoDia` devolve as duas

### Integration Tests

- **`test/rls.e2e-spec.ts`** — a contagem-âncora de `pg_policies` sobe 18 → 19 → 20 → 21 → 22, uma
  fase por vez, e o teste "nenhuma tabela desprotegida" cobre automaticamente cada tabela nova.
  Acrescentar um caso por fase no estilo dos existentes: `crm_app` com `app.owner_id` do owner A não
  enxerga item de catálogo do owner B.
- **Portão de migration com dado** (`scripts/validar-migrations-com-dados.sh`) — é o teste de
  integração que importa nesta fase, porque cada migration é backfill. Cada uma ganha um bloco em
  `prisma/fixtures/invariantes.sql`; "não estourou" é portão fraco.
- **Não alterar `banco-populado.sql`.** A fixture usa só colunas do `init` e é ela que dá dado real
  às quatro migrations. Portão vermelho por causa dela se conserta **na migration**.

### Migration & Rollback

**Aplicação em produção** (`crm.programeai.com.br`, N owners reais com dado vivo):

1. `pg_dump` completo antes de cada uma das quatro migrations. Obrigatório — a 7A registrou isso.
2. Aplicar **fora do pico**: `ALTER TABLE` e `DROP TYPE` pegam `ACCESS EXCLUSIVE`.
3. As quatro são deployáveis independentemente. Recomendo deploys separados, na ordem das fases —
   uma janela pequena por vez em vez de uma grande.
4. `prisma migrate deploy` roda no start do container (`app.migracao_falhou` se falhar; a API não
   sobe). Verificar o log estruturado logo após.

**Rollback.** Não há down script — nenhuma migration do projeto tem. As migrations **não são
reentrantes** (o `INSERT` do passo 2 não é idempotente). O caminho de volta é restaurar o `pg_dump` e
reverter o deploy da API. É por isso que os `RAISE EXCEPTION` dos passos 0 e 5 existem: eles abortam a
transação da migration **antes** de qualquer escrita destrutiva, deixando o banco intacto — abortar é
o rollback barato, restaurar dump é o caro.

**Dado migrado.** Nenhuma fase perde dado: `LeadSource`/`ServiceType`/`ActivityType` mapeiam 1:1 do
literal para o nome padrão, e `lostReason` importa cada string distinta como item desativado. O guard
pós-backfill de cada migration é o que prova isso antes de o `DROP COLUMN` acontecer.

## Environment Considerations

- **CI/CD** — nenhum passo novo. O portão `validar-migrations-com-dados.sh` já roda a cada push que
  toca a API e é ele que cobre as quatro migrations. `pnpm --filter web build` (`tsc -b`) é o que
  garante que nenhum literal de enum sobrou no front.
- **Migrations** — quatro, timestamps `20260804100000` a `20260807100000` (a última existente é
  `20260803100000_notification_telegram`). Escritas à mão: `prisma migrate dev --create-only`, porque
  o Prisma emite `ADD COLUMN … NOT NULL`, que falha com dado. Rodar o `prisma migrate diff
  --from-schema-datasource … --exit-code` da checklist depois de cada uma, para provar que o SQL
  manual bate com o schema.
- **Config/Secrets** — nada novo. Nenhuma variável de ambiente, nenhum segredo.
- **Multi-environment** — dev/CI nascem do zero: o `CROSS JOIN` sobre `User` não insere nada num
  banco sem owner, e o provisionamento por conta (`users.service.ts`) cobre as contas criadas depois.
  Produção é o único ambiente com o caminho de backfill percorrido.
- **Permissão nova** — `catalogo:gerenciar` entra em `ALL_PERMISSION_KEYS` automaticamente, então
  owner e papel `system` a recebem sem migration de dado. Papéis customizados existentes **não** a
  recebem: o owner precisa marcá-la no editor de papéis. Vale mencionar isso na descrição do PR.

## Dependencies & Risks

- **Cron cross-owner (Fase 4) — o risco mais alto da fase.** `followUpsDoDia` roda pelo client admin
  sem `app.owner_id`. Trocar `type: 'FOLLOW_UP'` por `type: { isFollowUp: true }` é o único ponto onde
  um erro **silencia** notificações em vez de estourar: zero item marcado num owner = zero lembrete,
  sem log de erro. Mitigações: o guard de exatamente-um-`isFollowUp` na migration, a invariante no
  portão, e o spec que instancia o repositório de verdade com dois owners.
- **`ServiceCatalog` (Fase 3) — três tabelas, uma transação.** Se o `SET NOT NULL` da segunda tabela
  falhasse depois de a primeira já ter perdido a coluna antiga, o banco ficaria num meio-estado. Por
  isso o guard de NULLs e os três `SET NOT NULL` vêm **antes** de qualquer `DROP COLUMN`, e a
  migration inteira roda numa transação implícita do Prisma.
- **`PAID_TRAFFIC` em dois enums.** `ServiceType.PAID_TRAFFIC` e `LeadSource.PAID_TRAFFIC`, ambos com
  rótulo `'Tráfego pago'`. As duas migrations semeiam esse nome em tabelas diferentes. Busca-e-troca
  cega no literal ou no rótulo corrompe o outro catálogo — a Fase 3 é a que corre esse risco, porque
  a Fase 1 já consumiu o `LeadSource`.
- **`labels.ts` deixa de ser fonte única.** O header declara a invariante "ao adicionar um valor ao
  schema, inclua a tradução aqui no mesmo PR" — que passa a não valer para estas quatro listas. O
  comentário atualizado na Fase 1 é o que evita alguém recriar os mapas por hábito.
- **Rótulo do catálogo é o dado.** Se a resposta esquecer o `include`, o `make()` de `labels.ts` não
  está mais lá para cair na chave crua — a UI exibiria `undefined` ou o UUID. O `tsc -b` do web pega
  isso, porque `serviceType` deixou de ser `string`.
- **Registry com `any` confinado.** `prisma-catalog.repository.ts` é o único arquivo com delegates
  destipados. É onde a revisão deve olhar duas vezes: um `where` sem `ownerId` ali vaza quatro
  catálogos de uma vez. A policy de RLS é a segunda linha de defesa, e o e2e por fase é a prova.
- **Ordem entre fases.** Só a Fase 1 é pré-requisito das outras (o módulo, a permissão, a tela, o
  `default-catalogs.ts`). Fases 2, 3 e 4 são independentes entre si e podem ser reordenadas se algo
  travar — a ordem escolhida é por custo crescente, não por dependência.

## References

- PRD: [`specs/research/2026-07-27-fase-13a-dominio-configuravel-por-owner.md`](../research/2026-07-27-fase-13a-dominio-configuravel-por-owner.md)
- Precedente (plano): [`specs/plans/2026-07-26-fase-7a-funil-por-owner.md`](2026-07-26-fase-7a-funil-por-owner.md) — ⚠️ **o SQL deste plano é a versão que quebrou em produção**; copiar o arquivo da migration
- Precedente (migration): [`20260726120000_pipeline_stages_per_owner/migration.sql`](../../apps/api/prisma/migrations/20260726120000_pipeline_stages_per_owner/migration.sql) — a receita, passos 0-8
- Regra do portão: [`apps/api/CLAUDE.md:113-140`](../../apps/api/CLAUDE.md#L113) — "Migration é validada com dado dentro"
- Fase seguinte que herda a colisão de `PAID_TRAFFIC`: [`specs/research/2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md`](../research/2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md)
- Escopo: [`ROADMAP.md`](../../ROADMAP.md) → "Fase 13 — Frente A"

---

## Registro de implementação (2026-07-27)

Status: **implementado**, as quatro fases. Toda a verificação automatizada de cada fase passou; a
verificação **manual** de cada fase segue pendente de quem for testar.

### Desvios em relação ao plano

1. **Timestamps das migrations deslocados em um dia.** O plano previa `20260804100000`–`20260807100000`,
   mas `20260804100000` já estava ocupado por `session_device_id` (commit `eeb7b59`). As quatro
   ficaram `20260805100000_lead_source_catalog`, `20260806100000_lost_reason_catalog`,
   `20260807100000_service_catalog` e `20260808100000_activity_type_catalog`.
2. **`onDelete: Restrict` explícito no schema.** O plano não o declarava nas relações novas; sem isso
   o Prisma assume `SetNull` para relação opcional e o `migrate diff` acusava drift contra o SQL
   escrito à mão (que usa `RESTRICT`). As seis FKs de catálogo declaram `onDelete: Restrict`.
3. **O spec do cron ficou em `test/follow-up-cron.e2e-spec.ts`, não em
   `src/…/prisma-notification-triggers.repository.spec.ts`.** O plano pedia um spec que instanciasse
   o repositório de verdade — mas a suíte unitária (`rootDir: src`) não tem bootstrap de banco, então
   um teste com Prisma real ali não rodaria. A suíte e2e tem `global-setup` com `migrate deploy`, e é
   lá que ele exercita de verdade os dois owners com catálogos independentes. A intenção do plano
   (infraestrutura real, sem mock) está preservada.
4. **`totalDeItensDeCatalogo()` em `default-catalogs.ts`** — helper não previsto no plano, para o
   `quantidade` do log `catalogo.itens_provisionados` somar as quatro listas num lugar só.
5. **Semântica de rádio do `isFollowUp` na UI** — o checkbox do tipo já marcado fica `disabled`, para
   que não exista o estado "nenhum tipo marcado" (que silenciaria o cron daquele owner).

### Fora do escopo, encontrado no caminho

- `apps/api/src/main.ts:56,59` tem 2 erros de lint (`no-unsafe-call`, `no-unsafe-member-access`)
  **pré-existentes**, de trabalho não relacionado a esta fase. Não foram tocados.
- Havia, em paralelo na árvore de trabalho, uma mudança não relacionada tocando os mesmos arquivos de
  `clients` (inferir `personType` do documento em vez de recebê-lo no corpo). O código de catálogo foi
  integrado por cima dela, sem revertê-la.
