---
date: 2026-07-23T00:00:00-03:00
author: claude
source_prd: specs/research/2026-07-23-rls-por-ownerid.md
git_commit: 1c52945c063bb23f8bed23f9cbed63a945d3fcd8
branch: main
status: implemented
tags: [spec, rls, prisma, postgres, seguranca, auth]
---

# Spec: RLS por ownerId no Postgres (defesa em profundidade)

## Overview

Adicionar Row-Level Security por `ownerId` em 10 tabelas de dados (`Client` + 9 filhas), como **defesa em profundidade** — os filtros de aplicação atuais permanecem, e o Postgres passa a barrar qualquer acesso cross-owner que escape de um filtro esquecido (os ~25 pontos de IDOR por `id` mapeados no PRD).

A estratégia tem três fases independentes e testáveis: (1) **denormalizar** `ownerId` em todas as tabelas filhas e popular via backfill + escrita; (2) montar a **plumbing de contexto por request** (`nestjs-cls` + transação interativa por request que faz `set_config('app.owner_id', …)`) e trocar a conexão da app para a role `crm_app`, **sem** ativar policies ainda; (3) **ativar** `ENABLE`+`FORCE RLS` + policies. Ativar o enforcement por último evita se trancar para fora durante a construção.

O enforcement usa **uma transação interativa por request** (não a extension `$allOperations`, incompatível com os `$transaction` interativos já existentes). Um interceptor global abre `prisma.$transaction`, executa `set_config` como primeira statement e guarda o `tx` no CLS; os repositórios passam a acessar o client via `this.prisma.db` (retorna o `tx` do CLS quando há request, senão o client base).

## Current State

- Só `Client` tem `ownerId` (`schema.prisma:24`); as 9 filhas escopam por join até `Client.ownerId` na aplicação.
- App conecta como `crm_user` (superuser + dono → ignoraria RLS hoje). Conexão única via `DATABASE_URL`.
- `PrismaService` é singleton puro, sem `$extends` (`prisma.service.ts:4-15`); `PrismaModule` é `@Global()`.
- `req.user.sub` (= `ownerId`) só existe após o `JwtAuthGuard` (`jwt-auth.guard.ts:34`); `@CurrentUserId()` retorna esse valor. Rotas `@Public()`: `POST /auth/login`, `POST /auth/refresh`.
- Sem CLS/AsyncLocalStorage. 2 crons: `proposals-expiration.job.ts` (updateMany) e `finance-billing.job.ts` (**cria pagamentos cross-owner**, `:52`).
- Prisma 6.19.3, NestJS 11, Postgres 16-alpine. Comandos via `pnpm --filter api …`; DB via `pnpm db:up`.

Detalhes completos no PRD: `specs/research/2026-07-23-rls-por-ownerid.md`.

## Desired End State

- As 10 tabelas de dados têm coluna `ownerId` NOT NULL, com `ENABLE`+`FORCE ROW LEVEL SECURITY` e policy `owner_isolation` (`USING` e `WITH CHECK` idênticos: `ownerId = current_setting('app.owner_id', true)`).
- `User` e `PipelineStage` **sem RLS**.
- A app conecta como **`crm_app`** (role `LOGIN NOSUPERUSER NOBYPASSRLS`, só DML). Toda requisição HTTP roda dentro de uma transação que setou `app.owner_id` = usuário autenticado (ou vazio em rotas públicas → fail-closed nas tabelas de dados, que rotas públicas não tocam).
- `prisma migrate`, `seed` e os 2 crons usam **`crm_user`** (superuser → bypassa RLS), via `DATABASE_URL` (CLI/seed) e um `PrismaAdminService` dedicado (crons).
- Acesso cross-owner por `id` retorna vazio/404 mesmo que um filtro de aplicação seja esquecido.

## What We're NOT Doing

- **Cadastro, reset de senha, entidade Organization/tenant** — fora de escopo (decisão do usuário: só RLS agora).
- **`ownerId` no `PipelineStage`** — permanece global/compartilhado, sem policy (decisão de produto).
- **Remover os filtros `ownerId` de aplicação** — é defesa em profundidade; os filtros ficam.
- **PgBouncer / pooler externo** — não há; o padrão transaction-scoped já é compatível se entrar depois.
- **Mudança de contrato de rotas/`ENDPOINTS.md`** — comportamento de erro (404) permanece; nenhuma rota muda de shape.

---

## Phase 1: Denormalizar `ownerId` nas tabelas filhas

### Goal
Toda tabela de dados passa a ter `ownerId` NOT NULL, populado para linhas existentes (backfill) e para linhas novas (escrita), **sem** nenhum enforcement ainda. App segue conectando como `crm_user`.

### Changes

#### Schema Prisma

**Modify**: `apps/api/prisma/schema.prisma`

Adicionar `ownerId String` + `@@index([ownerId])` em cada um dos 9 modelos: `Contact`, `Deal`, `Proposal`, `ProposalItem`, `Project`, `Task`, `Contract`, `Payment`, `Activity`. Não adicionar relação FK para `User` (o app trata `ownerId` como texto = `User.id`, consistente com `Client.ownerId` atual). Exemplo para `Deal`:

```prisma
model Deal {
  id       String @id @default(uuid())
  ownerId  String            // denormalizado p/ RLS (== Client.ownerId)
  clientId String
  client   Client @relation(fields: [clientId], references: [id])
  // ...campos existentes...
  @@index([stageId, position])
  @@index([ownerId])
}
```

Repetir o par (`ownerId String` + `@@index([ownerId])`) nos outros 8 modelos. `Client` já tem `ownerId` — não mexer.

#### Migration: coluna nullable + backfill + NOT NULL

**Create**: `apps/api/prisma/migrations/<timestamp>_denormalize_owner_id/migration.sql`

Gerar com `prisma migrate dev --create-only --name denormalize_owner_id` e **editar** o SQL para: (1) adicionar coluna nullable, (2) backfill, (3) `SET NOT NULL`, (4) índices. O Prisma por padrão gera `ADD COLUMN "ownerId" TEXT NOT NULL` — trocar para o fluxo abaixo (senão a migration falha em bancos com dados):

```sql
-- 1. AddColumn (nullable primeiro)
ALTER TABLE "Contact"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Deal"         ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Proposal"     ADD COLUMN "ownerId" TEXT;
ALTER TABLE "ProposalItem" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Project"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Task"         ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Contract"     ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Payment"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Activity"     ADD COLUMN "ownerId" TEXT;

-- 2. Backfill 1-hop (via clientId -> Client.ownerId)
UPDATE "Contact"  x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Deal"     x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Proposal" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Project"  x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Contract" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Activity" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";

-- 3. Backfill 2-hop
UPDATE "ProposalItem" x SET "ownerId" = p."ownerId" FROM "Proposal" p WHERE x."proposalId" = p."id";
UPDATE "Task"         x SET "ownerId" = pr."ownerId" FROM "Project" pr WHERE x."projectId" = pr."id";
UPDATE "Payment"      x SET "ownerId" = ct."ownerId" FROM "Contract" ct WHERE x."contractId" = ct."id";

-- 4. NOT NULL
ALTER TABLE "Contact"      ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Deal"         ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Proposal"     ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "ProposalItem" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Project"      ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Task"         ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Contract"     ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Payment"      ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Activity"     ALTER COLUMN "ownerId" SET NOT NULL;

-- 5. CreateIndex
CREATE INDEX "Contact_ownerId_idx"      ON "Contact"("ownerId");
CREATE INDEX "Deal_ownerId_idx"         ON "Deal"("ownerId");
CREATE INDEX "Proposal_ownerId_idx"     ON "Proposal"("ownerId");
CREATE INDEX "ProposalItem_ownerId_idx" ON "ProposalItem"("ownerId");
CREATE INDEX "Project_ownerId_idx"      ON "Project"("ownerId");
CREATE INDEX "Task_ownerId_idx"         ON "Task"("ownerId");
CREATE INDEX "Contract_ownerId_idx"     ON "Contract"("ownerId");
CREATE INDEX "Payment_ownerId_idx"      ON "Payment"("ownerId");
CREATE INDEX "Activity_ownerId_idx"     ON "Activity"("ownerId");
```

> Após editar, rodar `prisma migrate dev` para aplicar e regenerar o client. Conferir que o `_prisma_migrations` registrou o hash editado.

#### Popular `ownerId` na escrita (creates)

Com `NOT NULL`, todo `repo.create` precisa gravar `ownerId`. Regra geral: **usar o `ownerId` que o service já recebe via `@CurrentUserId()`**; nos creates derivados de um pai, derivar do pai.

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts` (`create`, ~:52)
```ts
return this.repo.create({ ...data, ownerId }); // ownerId já é parâmetro do método
```

**Modify**: `apps/api/src/modules/activities/application/activities.service.ts` (`create`, :20-22) — idem, adicionar `ownerId` ao objeto passado ao `repo.create`.

**Modify**: `apps/api/src/modules/projects/application/tasks.service.ts` (`create`, :54-59) — adicionar `ownerId` ao `repo.create`.

**Modify**: `apps/api/src/modules/finance/application/contracts.service.ts` — os 3 `repo.create` (`:89`, `:106`, `:119`) recebem `ownerId` (parâmetro do `create`, :61).

**Modify**: `apps/api/src/modules/proposals/application/proposals.service.ts` — `create` (:65) e o create de versão (:194): adicionar `ownerId`. Em `updateWithItems`, os `ProposalItem` criados herdam o `ownerId` da proposta (ver repo abaixo).

**Modify** (derivados de pai — o service não tem `ownerId` direto, deriva da entidade pai):
- `apps/api/src/modules/contacts/application/contacts.service.ts` (`create`, :23-35): o service valida o `Client` dono; passar `client.ownerId` ao `repo.create`.
- `apps/api/src/modules/projects/application/projects.service.ts`:
  - `create` (:52-57): adicionar `ownerId` (parâmetro/validado).
  - `createFromDeal` (:102-105): derivar `ownerId = deal.ownerId` (Deal agora tem a coluna).
- `apps/api/src/modules/finance/application/finance-billing.job.ts` (`:52`): o pagamento criado pelo cron deriva `ownerId = contract.ownerId` (Contract agora tem a coluna). O contrato vem de `findActiveRecurring()`.

**Modify** repos cujo `create` recebe o registro Prisma "unchecked" (o tipo de input passa a exigir `ownerId`): ajustar o tipo de parâmetro/DTO interno em `prisma-*.repository.ts` onde necessário para aceitar `ownerId` (ex.: `prisma-pipeline-stage.repository.ts` **não** muda — stage não tem ownerId). Para `ProposalItem` em `prisma-proposal.repository.ts` `updateWithItems` (:73-92): ao recriar itens, setar `ownerId` de cada item = `ownerId` da proposta.

#### Seed (dados de teste de isolamento)

**Modify**: `apps/api/prisma/seed.ts` — adicionar um **segundo usuário** para permitir testar isolamento na Fase 3 (ex.: `demo@crm.local`). Não é necessário setar `ownerId` no seed atual (ele só cria `User` + `PipelineStage`, ambos isentos de RLS). Opcional: criar 1 `Client` para cada user (com `ownerId = user.id`) para o teste manual da Fase 3.

### Success Criteria

#### Automated Verification
- [x] `pnpm db:up` sobe o Postgres.
- [x] `pnpm --filter api exec prisma migrate reset --force` aplica todas as migrations + seed sem erro (banco limpo).
- [x] `pnpm --filter api exec prisma migrate status` mostra tudo aplicado.
- [x] `pnpm --filter api build` compila (client regenerado com `ownerId` nos tipos).
- [x] `pnpm --filter api test` passa (ajustar specs de create que agora exigem `ownerId`).
- [x] `pnpm --filter api lint` sem erros nos arquivos tocados por esta fase (2 erros pré-existentes em `auth.service.ts`, de um recurso de cadastro não commitado e fora do escopo deste spec — ver nota abaixo).

#### Manual Verification
- [ ] Criar via API (app rodando) um `Deal`, `Contact`, `Task`, `Contract`, `Payment`, `Activity` e conferir no banco (`psql`) que `ownerId` está preenchido e igual ao do `Client`/pai.
- [ ] Rodar o cron de billing (ou chamar o método) e confirmar que o `Payment` criado tem `ownerId = Contract.ownerId`.

**⏸ PAUSE**: Após a verificação automática passar, parar para confirmação manual antes da Fase 2.

---

## Phase 2: Contexto por request + role `crm_app` (sem policies)

### Goal
Montar toda a plumbing de RLS e trocar a conexão da app para `crm_app`, **sem** ativar policies — comportamento idêntico ao atual, mas com a infraestrutura validada em produção.

### Changes

#### Dependência e env

**Run**: `pnpm --filter api add nestjs-cls`

**Modify**: `apps/api/src/config/env.validation.ts` — adicionar:
```ts
APP_DATABASE_URL: Joi.string().uri().required(), // conexão da app como crm_app (sujeita a RLS)
// DATABASE_URL permanece = crm_user (migrations/seed/crons)
```

**Modify**: `apps/api/.env` e `apps/api/.env.example`:
```
DATABASE_URL="postgresql://crm_user:crm_password@localhost:5435/crm_db?schema=public"
APP_DATABASE_URL="postgresql://crm_app:crm_app_password@localhost:5435/crm_db?schema=public"
```

#### Migration: role `crm_app` + GRANTs (idempotente, sem policies)

**Create**: `apps/api/prisma/migrations/<timestamp>_create_app_role/migration.sql`

Roda como `crm_user` (dono). Idempotente porque `migrate reset` recria o banco mas roles são cluster-level:
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_password'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
```
> Nota: senha fixa é aceitável em dev. Documentar em `.env.example` que produção gerencia a role fora das migrations.

#### PrismaService (app, como `crm_app`) + acessor de contexto

**Modify**: `apps/api/src/prisma/prisma.service.ts` — conectar como `crm_app` (via `APP_DATABASE_URL`) e expor `db`, que devolve a transação do CLS quando há request:
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

export const PRISMA_TX = 'PRISMA_TX';
export type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService, private readonly cls: ClsService) {
    super({ datasources: { db: { url: config.getOrThrow<string>('APP_DATABASE_URL') } } });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }

  /** Client a usar nos repositórios: a transação do request (com app.owner_id setado) ou o client base. */
  get db(): PrismaTx | PrismaClient {
    return this.cls.get<PrismaTx>(PRISMA_TX) ?? this;
  }
}
```

**Modify**: **todos os repositórios** `apps/api/src/modules/**/infra/prisma-*.repository.ts` — trocar `this.prisma.<model>` por `this.prisma.db.<model>` (mudança mecânica). Isso inclui as chamadas dentro dos `$transaction` interativos **quando não estiverem usando o `tx` local** — dentro dos callbacks `async (tx) => {…}` (deal `move` :80, task `move` :110, proposal `updateWithItems` :78) manter o uso de `tx`, pois esses rodam dentro do `tx` do request (ver interceptor).

> Os `$transaction` interativos existentes passam a rodar aninhados na transação do request. Prisma **não** suporta transação aninhada real; a solução é: o interceptor abre a transação e guarda `tx` no CLS; os repos usam `this.prisma.db` (= esse `tx`); os callbacks `$transaction(async tx => …)` internos são **substituídos** por uso direto de `this.prisma.db` (já é a transação do request), removendo o `$transaction` aninhado. Ver ajuste abaixo.

**Modify**: `prisma-deal.repository.ts` `move` (:74-127), `prisma-task.repository.ts` `move` (:104-155), `prisma-proposal.repository.ts` `updateWithItems` (:73-92) e `delete` (:94-100), e os `$transaction([...])` array-form de escrita atômica (proposal `:96`, pipeline-stage `reorder` `:37`, etc.): remover o `this.prisma.$transaction(...)` e executar as statements diretamente em `this.prisma.db` — que já é a transação única do request (atômica). Para os `$transaction([findMany, count])` de leitura (client:37, deal:33, project:38, task:44, contract:36, activity:18, proposal:52), trocar por `Promise.all([...])` sobre `this.prisma.db` (são leituras independentes; a atomicidade vem da transação do request de qualquer forma).

> Pipeline-stages: como stage **não** tem RLS, seu repo pode continuar usando `this.prisma` diretamente (sem `.db`) — mas por uniformidade e para participar da transação do request, usar `this.prisma.db` também é aceitável.

#### PrismaAdminService (privilegiado, para crons/seed)

**Create**: `apps/api/src/prisma/prisma-admin.service.ts` — client separado como `crm_user` (superuser → bypassa RLS), **sem** `.db`/CLS:
```ts
@Injectable()
export class PrismaAdminService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ datasources: { db: { url: config.getOrThrow<string>('DATABASE_URL') } } });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

**Modify**: `apps/api/src/prisma/prisma.module.ts` — prover e exportar ambos (`PrismaService`, `PrismaAdminService`); manter `@Global()`.

**Modify**: `finance-billing.job.ts` e `proposals-expiration.job.ts` — usar `PrismaAdminService` para as operações cross-owner (os crons não têm request/CLS). Como esses jobs hoje chamam services (`this.contracts`, `this.payments`) que usam `PrismaService.db`, avaliar: (a) injetar métodos que aceitem um client explícito, ou (b) mover as queries cross-owner do cron para repos que usam `PrismaAdminService`. Escolha: **(b)** — adicionar no repo os métodos usados pelos crons apontando para `PrismaAdminService` (ex.: `findActiveRecurring`, `markOverdue`, `expireOverdue`, `payment.create` do billing), já que hoje rodam sem contexto de owner. Documentar cada método cron-only que usa o client admin.

#### CLS + interceptor de transação por request

**Modify**: `apps/api/src/app.module.ts` — registrar o `ClsModule` global e o interceptor:
```ts
ClsModule.forRoot({ global: true, middleware: { mount: true } }),
// ...
{ provide: APP_INTERCEPTOR, useClass: OwnerContextInterceptor },
```

**Create**: `apps/api/src/prisma/owner-context.interceptor.ts` — abre a transação do request, seta `app.owner_id` e guarda o `tx` no CLS:
```ts
@Injectable()
export class OwnerContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly cls: ClsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ user?: { sub?: string } }>();
    const ownerId = req.user?.sub ?? ''; // rota pública -> '' (fail-closed nas tabelas com RLS)
    return from(
      this.prisma.$transaction(async (tx) => {
        // set_config seguro: valor via bound param (nunca concatenar)
        await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, true)`;
        this.cls.set(PRISMA_TX, tx);
        return lastValueFrom(next.handle());
      }),
    );
  }
}
```
> O interceptor roda **depois** dos guards (o `req.user` já existe). A transação envolve todo o handler; qualquer exceção faz rollback (comportamento aceitável — requests são curtos). Rotas públicas (login/refresh) tocam só `User`/refresh, que não têm RLS, então `ownerId=''` não atrapalha.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma migrate reset --force` cria a role `crm_app` e aplica tudo (rodando como `crm_user`).
- [x] `pnpm --filter api build` compila.
- [x] `pnpm --filter api test` passa (17 suites / 92 testes; adicionado `owner-context.interceptor.spec.ts`).
- [x] App sobe (`pnpm --filter api start`) conectando como `crm_app` sem erro de permissão.
- [x] `psql` como `crm_app`: `SELECT count(*) FROM "Deal";` retorna as linhas (ainda **sem** policy → vê tudo). Smoke test adicional: login + list + create client/deal via API funcionam pelo interceptor/transação, com `ownerId` populado corretamente.

#### Manual Verification
- [ ] Login, listagem de clientes/deals/propostas/projetos/tarefas/financeiro e o dashboard funcionam exatamente como antes (nenhuma regressão) — a app está como `crm_app` mas sem enforcement.
- [ ] Um write multi-statement (ex.: mover um deal de estágio, editar proposta com itens) funciona e é atômico.
- [ ] O cron de billing roda usando `PrismaAdminService` e cria pagamentos cross-owner.

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 3.

---

## Phase 3: Ativar RLS (enable + force + policies)

### Goal
Ativar o enforcement no Postgres. A partir daqui, `crm_app` só enxerga/escreve linhas do `ownerId` corrente.

### Changes

#### Migration: ENABLE + FORCE + policies

**Create**: `apps/api/prisma/migrations/<timestamp>_enable_rls/migration.sql` — para cada uma das 10 tabelas (`Client`, `Contact`, `Deal`, `Proposal`, `ProposalItem`, `Project`, `Task`, `Contract`, `Payment`, `Activity`). **`User` e `PipelineStage` ficam de fora.** Padrão por tabela:
```sql
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Client"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
```
Repetir para as outras 9 tabelas (mesmo bloco, trocando o nome). `ownerId` é `TEXT` → comparação texto=texto, **sem cast** `::uuid`. `current_setting(…, true)` (missing_ok) → contexto ausente vira `NULL` → policy casa zero linhas (**fail-closed**), nunca erro.

> `FORCE` garante que mesmo o dono da tabela (se um dia a app conectar como dono) fique sujeito. `crm_user` continua bypassando por ser **superuser** — é isso que mantém migrations/seed/crons funcionando cross-owner.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma migrate reset --force` aplica a migration de RLS + seed sem erro (seed roda como `crm_user`, bypassa).
- [x] `pnpm --filter api exec prisma migrate status` tudo aplicado (8 migrations).
- [x] `pnpm --filter api test` passa (17 suites / 92 testes).
- [x] `psql` como **`crm_app`**, sem setar owner: `SELECT count(*) FROM "Deal";` → **0** (fail-closed).
- [x] `psql` como `crm_app`: `BEGIN; SELECT set_config('app.owner_id','<ownerId-A>',true); SELECT count(*) FROM "Deal"; ROLLBACK;` → só os deals do owner A (owner A = 1, owner B = 0).
- [x] `psql` como `crm_user`: `SELECT count(*) FROM "Deal";` → todos (superuser bypassa).
- [x] Extra (E2E via app): admin cria client+deal; demo lista → 0; IDOR (demo `GET /clients/:id` e `/deals/:id` do admin) → 404; admin no próprio → 200; `WITH CHECK` rejeita INSERT com `ownerId` alheio; deal `move` (transação multi-statement) → 200 sob RLS.

#### Manual Verification
- [ ] Com dois usuários semeados (owner A e owner B, cada um com 1 client + dados), logar como A e confirmar que **nenhum** dado de B aparece em nenhuma tela (clientes, deals, propostas, projetos, tarefas, financeiro, dashboard).
- [ ] Tentar IDOR: pegar o `id` de um `Deal`/`Contract`/`Payment` do owner B e acessar `GET /…/:id` logado como A → 404 (barrado no banco, mesmo que o service não filtrasse).
- [ ] `POST` tentando criar registro com `ownerId` de outro dono (via manipulação) → rejeitado pelo `WITH CHECK`.
- [ ] Login/refresh/logout funcionam (User sem RLS).
- [ ] Crons (billing/expiração) rodam e afetam registros de todos os owners.
- [ ] Dashboard agrega só os dados do owner logado; `PipelineStage` (global) aparece normalmente.

**⏸ PAUSE**: Validação final de isolamento com o usuário.

---

## Testing Strategy

### Unit Tests
- Ajustar specs de service/repo que criam entidades para incluir/asserir `ownerId` (ex.: `contracts.service.spec.ts`, `finance-billing.job.spec.ts`, `clients.service.spec.ts`).
- Mockar `ClsService` e `PrismaService.db` (retornando o mock do client) nos specs de repositório.
- Novo teste do `OwnerContextInterceptor`: verifica que `set_config` é chamado com `req.user.sub` e que rota pública usa `''`.

### Integration Tests
- Teste e2e (`test/jest-e2e.json`) com dois usuários: autentica como A, cria dados; autentica como B, cria dados; assere que cada um só lê o próprio (listas e GET por id retornam 404 para o alheio).
- Teste do caminho de escrita atômica (deal move / proposal updateWithItems) sob RLS.

### Migration & Rollback
- **Aplicação**: `prisma migrate deploy` (prod) / `prisma migrate dev` (dev), rodando como `crm_user`.
- **Rollback Fase 3**: migration reversa `ALTER TABLE … DISABLE ROW LEVEL SECURITY; DROP POLICY owner_isolation ON …;` (a app volta a ver tudo; filtros de aplicação continuam protegendo).
- **Rollback Fase 2**: reverter `APP_DATABASE_URL`/PrismaService para `DATABASE_URL` (crm_user) desativa o efeito prático do RLS sem tocar no schema.
- **Rollback Fase 1**: `DROP COLUMN "ownerId"` nas 9 tabelas (só se necessário; é aditivo e inócuo manter).

## Environment Considerations
- **Migrations**: 3 novas migrations (denormalize, create_app_role, enable_rls), todas rodando como `crm_user`. A de role é idempotente (`migrate reset` recria DB mas a role persiste no cluster).
- **Config/Secrets**: nova env `APP_DATABASE_URL` (crm_app). `DATABASE_URL` permanece como `crm_user`. Atualizar `.env`, `.env.example` e o deploy.
- **Docker**: `docker-compose.yml` não muda — a role `crm_app` nasce na migration. (Alternativa futura: init-script para provisionar a role antes do primeiro `migrate`.)
- **CI/CD**: garantir que o pipeline rode `migrate deploy` como `crm_user` e que a app receba `APP_DATABASE_URL`.
- **Multi-ambiente**: em prod, criar a role `crm_app` com senha forte gerenciada fora do repositório (a migration cria com senha dev; ajustar via `ALTER ROLE` no provisionamento).

## Dependencies & Risks
- **Transação por request**: cada requisição HTTP mantém uma transação aberta durante todo o handler. Requests são curtos neste CRM; monitorar duração/locks. Chamadas externas lentas dentro de um handler prolongariam a transação — não há hoje.
- **`nestjs-cls`**: dependência nova (aprovada). Requer `middleware.mount` para popular o AsyncLocalStorage por request.
- **Ordem crítica**: Fase 1 (backfill + NOT NULL) antes de qualquer policy; Fase 2 (contexto + role) antes de ativar (Fase 3), senão a app se tranca para fora.
- **`crm_user` deve permanecer superuser** para crons/seed/migrations bypassarem via superuser. Se um dia `crm_user` deixar de ser superuser, os crons precisarão de `app.bypass_rls` (GUC + policy permissiva) — fora de escopo agora.
- **Consistência `ownerId` == `User.id`**: dados legados cujo `Client.ownerId` não seja um `User.id` válido ficariam invisíveis sob RLS. Conferir no backfill/validação da Fase 1.

## References
- PRD: `specs/research/2026-07-23-rls-por-ownerid.md`
- Prisma RLS oficial: https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security
- Postgres Row Security: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Prisma Client extensions: https://www.prisma.io/docs/orm/prisma-client/client-extensions
