---
date: 2026-07-26T17:14:31-03:00
researcher: claude
git_commit: 7bcd8df2b37bc9f9d5362835c8e327a863ba364d
branch: main
topic: "Fase 7 — Base: funil por owner e responsável por registro (assigneeId)"
tags: [research, pipeline, rls, prisma, permissoes, colaboradores, dashboard, demandas]
status: complete
---

# Research: Fase 7 — Funil por owner e responsável por registro

## Research Question

Fase 7 do [ROADMAP.md](../../ROADMAP.md) (P0), duas frentes independentes no escopo mas
acopladas no mesmo release:

**Frente A — Isolamento do funil**
1. `PipelineStage` recebe `ownerId` (é o único modelo de negócio sem ele).
2. RLS em `PipelineStage` (hoje ausente da migration `enable_rls`; o repositório lê sem filtro).
3. Trocar `name @unique` global por `@@unique([ownerId, name])`.
4. Migration de dados: replicar os estágios por owner existente e religar os `Deal`.
5. Seed dos estágios padrão passa a rodar na criação da conta, não na instância.

**Frente B — Responsável por registro**
6. `assigneeId` (FK → `User`, opcional) em `Deal`, `Task`, `Activity` e `Client`.
7. Atribuição na criação e edição, com troca de responsável; filtro `?assigneeId=` nas listagens.
8. "Minhas demandas" e o board do pipeline filtram pelo usuário logado.
9. Permissões novas: ver/gerenciar só os próprios registros × os de todos.
10. Dashboard com corte por responsável.

## Summary

**Frente A é uma correção de dívida datada, não uma decisão nova.** O funil global foi decidido
conscientemente na Fase 2 (`specs/plans/2026-07-21-fase-2-pipeline.md:66` — "Multi-tenancy / RLS —
segue single-tenant"), **reconfirmado explicitamente** na fase de RLS
(`specs/research/2026-07-23-rls-por-ownerid.md:202` — "`PipelineStage` → global, sem policy […]
Escopar depois, se virar multiusuário real") e **nunca revisitado** quando o multiusuário real
chegou em 2026-07-25 (colaboradores e papéis). O trabalho é mecânico e o padrão a copiar existe
inteiro: a migration `20260725120000_add_collaborators_and_roles` é o molde exato — coluna
`ownerId TEXT NOT NULL` + FK `ON DELETE CASCADE`, índice, `ENABLE`+`FORCE ROW LEVEL SECURITY`,
policy `owner_isolation` com `USING == WITH CHECK`, `GRANT … TO crm_app`, tudo no mesmo arquivo, e
o backfill por owner via `INSERT … SELECT FROM "User" WHERE "ownerId" IS NULL`. O que **não** é
mecânico é a migration de dados: nove métodos do repositório de estágios são globais hoje
(`findByName` usa `findUnique({ where: { name } })`, `maxOrder()` agrega sem filtro,
`countDeals(stageId)` conta deals de um estágio compartilhado), e a migration `0e80664`
(`20260725130000_seed_default_pipeline_stages`) plantou os 7 estágios em produção com um guard
global `WHERE NOT EXISTS (SELECT 1 FROM "PipelineStage")` — que precisa virar por owner.

**Frente B é conceito inédito no código.** Grep exaustivo por
`assignee|assignedTo|responsav|responsible|createdBy|ownerUserId` em `apps/api/src`, `apps/web/src`
e `prisma/` retorna **zero**: nenhum modelo de negócio tem FK para `User`; `userId` só aparece em
tabelas de identidade (`OAuthAccount`, `PasswordResetToken`, `CollaboratorInvite`). O plano de
colaboradores declarou isso fora de escopo em `specs/plans/2026-07-25-colaboradores-e-papeis.md:66`
— "**Sem permissão por registro** […] todo colaborador vê todos os dados do owner". Três
consequências estruturais para o plano: (a) o `AccessGuard` **não** pode aplicar escopo por registro
— ele decide antes de tocar o recurso e nunca vê o `:id`, então o ponto de aplicação é a camada
`application`/`infra` recebendo `access.userId` (já disponível em `AccessContext`); (b) o RLS **não**
protege `assigneeId` — a policy só compara `ownerId`, e como `assigneeId` referencia `User` (tabela
sem RLS) nada no banco impede apontar para um usuário de outro owner, então a validação de
pertencimento à workspace é obrigatória na aplicação; (c) não existe endpoint utilizável para
popular um seletor de responsável — `GET /collaborators` exige `colaborador:gerenciar` (permissão de
Organização) e **não inclui o owner** (`where: { ownerId }` e o owner tem `ownerId = null`).

**"Minhas demandas" é hoje um nome enganoso.** `MinhasDemandasPage.tsx:73` chama `useMyBoard()` →
`GET /tasks/board` sem `projectId` → `findAllForBoardByOwner(ownerId)`: são **todas** as tarefas da
workspace, filtradas no cliente por cliente/prioridade/projeto/prazo. Mesmo problema no board do
funil, que é ainda mais cru — `PipelineBoardPage.tsx` não tem filtro nenhum e a query key
`queryKeys.deals.board` é a constante `['deals','board']`, sem params: qualquer filtro por
responsável exige parametrizar a chave, senão o cache colide entre recortes. O padrão de filtro
persistido em URL já existe e é o de `MinhasDemandasPage.tsx:39-44` (`useUrlFilters` +
`stringFilter`/`enumFilter`/`stringArrayFilter`).

**Três decisões de produto estão abertas e mudam a forma do código** (detalhadas em Open Questions):
a modelagem das permissões de escopo (chaves novas no catálogo × flag no `Role`), o comportamento
default dos boards (filtrado em "eu" × todos com filtro opcional), e a natureza do endpoint de
membros da workspace. Nenhuma delas bloqueia a Frente A, que pode ser planejada e implementada
antes.

## Codebase Map

### Affected Files & Modules

#### Frente A — Isolamento do funil (backend + banco)

| File | Role | Relevance |
|------|------|-----------|
| `apps/api/prisma/schema.prisma:183-190` | `model PipelineStage` | Alvo central: sem `ownerId`, `name String @unique` global, sem back-relation em `User` |
| `apps/api/prisma/schema.prisma:192-215` | `model Deal` | `stageId` + `@@index([stageId, position])`; já tem `ownerId` — a migration de dados religa `stageId` para a cópia do owner |
| `apps/api/prisma/schema.prisma:13-42` | `model User` | Precisa da back-relation `pipelineStages PipelineStage[]` (padrão de `ownedRoles`, `:38`) |
| `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:2` | Migration base de RLS | Comentário declara a omissão: "User e PipelineStage ficam de fora (auth por email / estágios globais)" — o texto precisa deixar de valer |
| `apps/api/prisma/migrations/20260725130000_seed_default_pipeline_stages/migration.sql:21` | Seed em produção | Guard global `WHERE NOT EXISTS (SELECT 1 FROM "PipelineStage")` — a nova migration precisa conviver com o estado que esta deixou |
| `apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts:10-47` | Repositório Prisma | **Todos os 9 métodos são globais.** `findByName` (`:19`) quebra ao virar unique composta; `maxOrder` (`:31`) e `countDeals` (`:37`) agregam sem owner |
| `apps/api/src/modules/pipeline/domain/pipeline-stage.repository.ts:6-22` | Porta + token DI | Nenhuma assinatura recebe `ownerId` — contrato inteiro muda |
| `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts:22-86` | Use cases | `list`, `findOne`, `firstStage`, `wonStage`, `create`, `update`, `reorder`, `delete` — nenhum recebe `ownerId` |
| `apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts:16-52` | Controller | Doc-comment declara "catálogo global da instância"; `GET` sem `@RequirePermission`; nenhum handler injeta `@CurrentOwnerId()` |
| `apps/api/src/modules/pipeline/application/deals.service.ts:52-69, 96-123` | Consumidor | `create` usa `stages.firstStage()`; `move` usa `stages.findOne(dto.stageId)` e decide `isWon`/`isLost` — todas as chamadas ganham `ownerId` |
| `apps/api/src/modules/proposals/application/proposals.service.ts:247-257` | Consumidor cross-módulo | `moveDealToWon` chama `this.stages.wonStage()` (sem owner) e `this.deals.board(ownerId)` |
| `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:19-42` | Consumidor | `funnel(ownerId)` faz `pipelineStage.findMany()` global (comentário `:20` — "Estágios são globais"); com RLS passa a ser owner-scoped automaticamente |
| `apps/api/src/modules/users/users.service.ts:47-57, 86-107` | Provisionamento de conta | `create` e `createWithOAuth` — os dois pontos onde os estágios padrão passam a nascer (nested create sob `admin.user.create`) |
| `apps/api/prisma/seed.ts:101-123` | Seed de dev | `upsert({ where: { name } })` dos 7 estágios + helper `stage(name)` usado em 11 deals (`:559-711`) |
| `apps/api/src/modules/pipeline/application/pipeline-stages.service.spec.ts` | Testes | 4 casos com repo mockado; assinaturas mudam |
| `apps/api/ENDPOINTS.md:282-324` | Doc obrigatória | 5 endpoints de `pipeline-stages` — Auth/Erros mudam |

#### Frente B — Responsável por registro (backend)

| File | Role | Relevance |
|------|------|-----------|
| `apps/api/prisma/schema.prisma:132-167, 192-215, 286-305, 357-374` | `Client`, `Deal`, `Task`, `Activity` | Cada um recebe `assigneeId String?` + `assignee User?` + índice `@@index([ownerId, assigneeId])`; `User` recebe 4 back-relations nomeadas |
| `apps/api/src/shared/permissions.ts:38-72` | Catálogo (fonte única) | 14 chaves em `recurso:ver` / `recurso:gerenciar`, 6 categorias; `PermissionMeta.hidden?` (`:33`) existe para "chaves que ainda não se quer expor" e nunca foi usado |
| `apps/api/src/modules/access/access.guard.ts:38-68` | Autorização de rota | Decisão **binária por rota**, sem acesso ao recurso — não é o ponto de aplicação do escopo por registro |
| `apps/api/src/modules/access/domain/access-context.ts:11-20` | Contrato do contexto | Já carrega `userId` **e** `ownerId` — escopo por usuário não exige mudança de contrato |
| `apps/api/src/modules/access/application/access.service.ts:26-60` | Resolve permissões | Usa `PrismaAdminService`; `permissionsOf` (`:66-72`) — papel `system` vale `ALL_PERMISSION_KEYS` |
| `apps/api/src/shared/current-user.decorator.ts:8-52` | Decorators | `@CurrentUserId()` (identidade), `@CurrentOwnerId()` (workspace), `@CurrentAccess()` (permissões) — o escopo por registro precisa dos dois primeiros juntos, logo `@CurrentAccess()` |
| `apps/api/src/modules/pipeline/api/dto/list-deals-query.dto.ts:4-10` | Query DTO | `clientId`, `stageId`, `search` — entra `assigneeId` |
| `apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts:15-44` | Create DTO | `UpdateDealDto` é `PartialType(OmitType(…, ['clientId','stageId']))` — herda o campo novo |
| `apps/api/src/modules/pipeline/application/deals.service.ts:52-94` | Service | `create` monta campo a campo (`:52-69`) e `update` faz patch condicional (`:71-94`) — **cada campo novo exige linha própria** |
| `apps/api/src/modules/pipeline/domain/deal.repository.ts:6-17` | Filtro + include | `DealListFilter` e `DealWithClient` (`client: { select: { id, name } }`) |
| `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:27-55` | `where` + board | `where` da listagem e `findAllForBoard(ownerId)` (`:49-55`, sem filtro além do owner) |
| `apps/api/src/modules/projects/api/dto/list-tasks-query.dto.ts:5-21` | Query DTO | `projectId`, `clientId`, `status`, `priority`, `dueBefore` — entra `assigneeId` |
| `apps/api/src/modules/projects/application/tasks.service.ts:24-47, 53-94` | Service | `list`, `board(ownerId, projectId?)` (`:40-47`, "board cross-projeto de Minhas demandas"), `create`, `update` |
| `apps/api/src/modules/projects/infra/prisma-task.repository.ts:38-87` | `where` + board | `where` (`:38-65`) e `findAllForBoardByOwner` (`:75-87`) |
| `apps/api/src/modules/activities/api/dto/list-activities-query.dto.ts:4-9` | Query DTO | Só `clientId`, `dealId` |
| `apps/api/src/modules/activities/infra/prisma-activity.repository.ts:13-28` | `where` | **Único dos quatro sem filtro de owner na aplicação** — depende só do RLS; `ActivityListFilter` não tem `ownerId` |
| `apps/api/src/modules/clients/application/clients.service.ts:27-34, 55-71` | Service | Único que faz **spread do DTO** (`{ ...dto, document, ownerId }`) — `assigneeId` chega ao Prisma sem código extra |
| `apps/api/src/modules/clients/infra/prisma-client.repository.ts:23-49` | `where` | Único que filtra pela coluna `ownerId` direta |
| `apps/api/src/modules/collaborators/api/collaborators.controller.ts:13-21` | Listagem de pessoas | `@RequirePermission('colaborador:gerenciar')` **no nível da classe** — bloqueia o seletor de responsável |
| `apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts:11-34` | Repositório | `where: { ownerId }` → **exclui o owner** (que tem `ownerId = null`); `select` sanitizado |
| `apps/api/src/modules/collaborators/application/collaborators.service.ts:20-28, 177-192` | Shape | `CollaboratorResponse { id, name, email, active, status, role, createdAt }` |
| `apps/api/src/modules/dashboard/application/dashboard.service.ts:74-135` | Recorte por permissão | Único lugar do backend que checa permissão fora do guard (`may(...)`, `:75`); blocos `funnel`/`proposals`/`demands`/`upcomingActions` |
| `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:78-165` | Agregações | `tasksInProgressCount`, `tasksOverdueCount`, `upcomingTasks`, `upcomingActions` — todas por `project: { client: { ownerId } }`, nenhuma por responsável |
| `apps/api/src/modules/dashboard/api/dashboard.controller.ts:15-30` | Controller | `GET /summary` sem `@RequirePermission`, já injeta `@CurrentAccess()` |

#### Frente B — Responsável por registro (frontend)

| File | Role | Relevance |
|------|------|-----------|
| `apps/web/src/features/pipeline/api/types.ts:6-51` | Tipos | `PipelineStage`, `Deal`, `CreateDealBody` — nenhum campo de responsável |
| `apps/web/src/features/pipeline/PipelineBoardPage.tsx:19-88` | Board do funil | **Sem filtro nenhum**; agrupa por `stageId` (`:29-38`); toolbar só com 2 botões (`:79-87`) |
| `apps/web/src/features/pipeline/api/hooks.ts:18-29` | Queries | `useBoard()` e `useStages()` sem params |
| `apps/web/src/features/pipeline/components/DealCard.tsx:13-35` | Card | Onde entra o responsável |
| `apps/web/src/features/pipeline/DealFormDialog.tsx:29-41, 56-58, 158-204` | Formulário | **Padrão canônico** de select alimentado por API (RHF + Zod + `Controller` + `Select` com `items`) |
| `apps/web/src/features/pipeline/StageConfigDialog.tsx:129-254` | Config de estágios | Dialog (não há página); DnD vertical + PATCH no blur/checkbox |
| `apps/web/src/features/demandas/MinhasDemandasPage.tsx:39-44, 73, 92-101, 158-194` | "Minhas demandas" | `DEMANDAS_FILTERS` via `useUrlFilters`; `useMyBoard()`; **filtragem client-side**; toolbar é o modelo a copiar |
| `apps/web/src/features/demandas/api/types.ts:29-44, 99-107` | Tipos | `Task` e `ListTasksParams` sem `assigneeId` |
| `apps/web/src/features/demandas/TaskFormDialog.tsx` | Formulário | **Sem Zod/RHF** — `useState<FormState>` + PATCH por campo na edição (divergente do padrão) |
| `apps/web/src/features/clientes/ClientFormDialog.tsx:44-65` | Formulário | RHF + Zod, ~20 campos; body é `Partial<Client>` → o campo novo propaga sozinho |
| `apps/web/src/features/clientes/tabs/TimelineTab.tsx:27-71, 91` | Activity | Form inline (não dialog), schema `{ type, content, scheduledFor }` |
| `apps/web/src/lib/query-keys.ts:15, 37` | Cache | `deals.board` e `tasks.myBoard` são **constantes sem params** — precisam virar funções, senão o cache colide entre recortes |
| `apps/web/src/lib/clients-lookup.ts:14-42` | Lookup transversal | Modelo exato para um `members-lookup.ts` (`buildClientItems` inclui o já-selecionado ausente da busca) |
| `apps/web/src/hooks/use-can.ts:13-32` | Permissões na UI | `can`, `canAny`, `isOwner`, `loading` — único vetor de gating |
| `apps/web/src/app/nav.ts:32-63` e `apps/web/src/routes/router.tsx:37-42` | Chaves na navegação | Constantes `CLIENTES`/`PIPELINE`/`DEMANDAS` — mudam se o catálogo ganhar chaves |
| `apps/web/src/features/dashboard/DashboardPage.tsx:117-365` | Dashboard | Único filtro é o mês (`MonthPicker`, `:199`); blocos `null`-áveis por permissão |
| `apps/web/src/lib/labels.ts:9-129` | Rótulos de enum | Só cobre enums — "Sem responsável"/"Atribuídos a mim" ficam inline em pt-BR |

### Existing Patterns to Follow

**Padrão 1 — Tabela nova/alterada com RLS por `ownerId`** (o molde para `PipelineStage`)

```sql
-- De apps/api/prisma/migrations/20260725120000_add_collaborators_and_roles/migration.sql:94-118
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Role"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- GRANTs explícitos para a role da aplicação. O ALTER DEFAULT PRIVILEGES de
-- 20260724040000_create_app_role já cobriria as tabelas novas; repetimos aqui
-- para a migration ser autossuficiente em bancos provisionados à mão.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Role", "CollaboratorInvite" TO crm_app;
```

**Por que importa**: nome da policy é sempre `owner_isolation`; `ownerId` é `TEXT` → comparação
texto=texto **sem cast** `::uuid`; `current_setting(…, true)` (missing_ok) → contexto ausente vira
`NULL` → zero linhas (**fail-closed**); `USING` e `WITH CHECK` idênticos; `FORCE` porque o dono da
tabela (`crm_user`) senão bypassaria.

**Padrão 2 — Coluna nova em tabela com dados: nullable → backfill → NOT NULL → índice**

```sql
-- De apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql
-- (o Prisma gera ADD COLUMN ... NOT NULL direto, que falha em bancos com dados)
ALTER TABLE "Contact" ADD COLUMN "ownerId" TEXT;
UPDATE "Contact" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
ALTER TABLE "Contact" ALTER COLUMN "ownerId" SET NOT NULL;
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");
```

**Padrão 3 — Backfill por owner existente com `INSERT … SELECT`**

```sql
-- De apps/api/prisma/migrations/20260725120000_add_collaborators_and_roles/migration.sql:82-91
INSERT INTO "Role" ("id","ownerId","name","description","system","permissions","createdAt","updatedAt")
SELECT gen_random_uuid(), u."id", 'Administrador',
       'Acesso total ao CRM. Papel do sistema — não pode ser editado nem excluído.',
       true, ARRAY[]::TEXT[], now(), now()
  FROM "User" u
 WHERE u."ownerId" IS NULL;   -- owners: ownerId nulo
```

**Por que importa**: `WHERE u."ownerId" IS NULL` é o predicado canônico de "é owner";
`gen_random_uuid()` (com `::text` quando a coluna é TEXT — ver
`20260725130000_seed_default_pipeline_stages/migration.sql`); `VALUES … AS v(...)` para tabela
literal; guard de idempotência via `WHERE NOT EXISTS` / `IS NULL`.

**Padrão 4 — Provisionamento atômico na criação da conta**

```ts
// De apps/api/src/modules/users/users.service.ts:38-57
private systemRole() {
  return { name: 'Administrador', description: '…', system: true };
}

create(data: { name: string; email: string; passwordHash: string }) {
  return this.admin.user.create({
    data: {
      ...data,
      acceptedAt: new Date(),
      subscription: { create: this.trialSubscription() },
      ownedRoles: { create: this.systemRole() },
    },
  });
}
```

**Por que importa**: usa `this.admin` (`PrismaAdminService`, superuser) de propósito — `Subscription`
e `Role` têm RLS e o cadastro **não tem contexto de owner** (comentário `:16-21`). Um nested create
`pipelineStages: { create: [...] }` mantém a atomicidade sem `$transaction` explícito. Há **dois**
caminhos a alterar (`create` e `createWithOAuth`, `:86-107`), e o arquivo já usa helpers privados
(`trialSubscription()`, `systemRole()`) exatamente para não duplicar — a lista dos 7 estágios seria
o terceiro helper (hoje ela é duplicada entre `seed.ts:101-118` e a migration de 2026-07-25).

**Padrão 5 — Filtro opcional no `where` do Prisma**

```ts
// De apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:27-47
const where: Prisma.DealWhereInput = {
  client: { ownerId: filter.ownerId },
  ...(filter.clientId ? { clientId: filter.clientId } : {}),
  ...(filter.stageId ? { stageId: filter.stageId } : {}),
  ...(filter.search ? { title: { contains: filter.search, mode: 'insensitive' } } : {}),
};
```

**Padrão 6 — Recorte por permissão dentro do service (não no guard)**

```ts
// De apps/api/src/modules/dashboard/application/dashboard.service.ts:74-90
async summary(ownerId: string, permissions: readonly string[]) {
  const may = (...keys: string[]) => keys.some((k) => permissions.includes(k));
  …
    mayDeals     ? this.funnelBlock(ownerId)       : null,
    mayProposals ? this.proposalsBlock(ownerId, w) : null,
    mayTasks     ? this.demandsBlock(ownerId, w)   : null,
```

**Por que importa**: é o **único** precedente no backend de decisão de permissão fora do
`AccessGuard`, e é exatamente a forma que o escopo por registro precisa ter — o guard libera a
rota, o service estreita o resultado.

**Padrão 7 — Select alimentado pela API (frontend)**

```tsx
// De apps/web/src/features/pipeline/DealFormDialog.tsx:92-97, 158-204
const clientItems = buildClientItems(clientChoices, deal?.client);
…
<Controller control={control} name="clientId" render={({ field }) => (
  <Select<string>
    items={clientItems}
    open={selectOpen} onOpenChange={setSelectOpen}
    value={field.value} onValueChange={field.onChange}
  >
    <SelectTrigger placeholder="Selecione um cliente" />
    <SelectContent>…</SelectContent>
  </Select>
)} />
```

**Por que importa**: o `Select` do base-ui precisa do prop `items` (mapa id→label) para o **trigger**
mostrar o rótulo em vez do id cru — ver `apps/web/src/lib/clients-lookup.ts:29-42`
(`buildClientItems` inclui o já-selecionado que pode não estar na busca atual). Para lista curta sem
busca, `items={roles.map((r) => ({ value: r.id, label: r.name }))}` basta
(`ConvidarColaboradorDialog.tsx:167-195`).

**Padrão 8 — Filtro persistido na URL (frontend)**

```ts
// De apps/web/src/features/demandas/MinhasDemandasPage.tsx:39-44
const DEMANDAS_FILTERS = {
  clientSearch: stringFilter(),
  priority: enumFilter(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[], 'ALL' as const),
  projectIds: stringArrayFilter(),
  dueBefore: stringFilter(),
};
```

`apps/web/src/lib/api.ts` já serializa arrays como chaves repetidas
(`paramsSerializer: { indexes: null }` → `assigneeId=a&assigneeId=b`).

### Data Flow

**Hoje — leitura de estágios (global, sem owner)**

```
GET /pipeline-stages
  → ThrottlerGuard → JwtAuthGuard (req.user) → AccessGuard (req.access) → BillingGuard
  → OwnerContextInterceptor: $transaction + set_config('app.owner_id', access.ownerId, true) + cls.set(PRISMA_TX)
  → PipelineStagesController.list()            // sem @CurrentOwnerId
  → PipelineStagesService.list()               // sem ownerId
  → repo.findAllOrdered() → prisma.db.pipelineStage.findMany({ orderBy: { order: 'asc' } })
  → PipelineStage NÃO tem policy → o app.owner_id da transação é ignorado → TODOS os estágios da instância
```

**Hoje — criação de deal (o acoplamento com o estágio global)**

```
POST /deals { clientId, serviceType, title }
  → DealsService.create (deals.service.ts:52-69)
  → clients.findOne(ownerId, clientId)                     // valida posse
  → stages.firstStage()                                    // primeiro estágio DA INSTÂNCIA
  → repo.maxPositionInStage(stage.id) + 1
  → deal.create({ ownerId, clientId, stageId: <estágio global>, position })
```

**Hoje — "Minhas demandas" (sem corte por pessoa)**

```
MinhasDemandasPage → useMyBoard() → GET /tasks/board (sem projectId)
  → TasksService.board(ownerId, undefined)                 // tasks.service.ts:40-47
  → repo.findAllForBoardByOwner(ownerId)                   // where: { project: { client: { ownerId } } }
  → TODAS as tarefas da workspace → filtragem client-side por cliente/prioridade/projeto/prazo
```

**Depois da Frente A — o mesmo caminho, agora fechado pelo banco**

```
GET /pipeline-stages
  → … OwnerContextInterceptor seta app.owner_id
  → PipelineStagesController.list(@CurrentOwnerId() ownerId)
  → PipelineStagesService.list(ownerId)
  → repo.findAllOrdered(ownerId) → where: { ownerId }      // defesa em profundidade
  → policy owner_isolation também filtra                    // fail-closed se o contexto faltar
```

## External Research

### PostgreSQL 16 — Row Security Policies

Dois trechos verbatim de <https://www.postgresql.org/docs/16/ddl-rowsecurity.html> que decidem
detalhes do plano:

> "Referential integrity checks, such as unique or primary key constraints and foreign key
> references, always bypass row security to ensure that data integrity is maintained."

**Consequência 1 (Frente A, a favor):** depois de `PipelineStage` ganhar policy, a FK
`Deal_stageId_fkey` continua sendo verificada normalmente — nenhuma migration ou insert quebra por
causa de RLS na tabela referenciada.

**Consequência 2 (Frente A, atenção):** um `INSERT` de `Deal` apontando para o `stageId` **de outro
owner** passa pela FK sem erro, e a policy de `Deal` só valida o `ownerId` do próprio deal. A trava é
de aplicação: `stages.findOne(ownerId, stageId)` retorna `null` sob RLS → `404 Estágio não
encontrado.` Ou seja, o service **precisa** continuar validando o estágio antes de gravar; a policy
não substitui isso.

**Consequência 3 (Frente B, decisiva):** `assigneeId` referencia `User`, que **não** tem RLS
(`20260724050000_enable_rls/migration.sql:2`). Nem a FK nem a policy de `Deal`/`Task`/`Activity`/
`Client` impedem apontar o responsável para um usuário de outra workspace. **A validação de
pertencimento à workspace é obrigatória na camada `application`.**

> "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when
> accessing a table. Table owners normally bypass row security as well, though a table owner can
> choose to be subject to row security with ALTER TABLE ... FORCE ROW LEVEL SECURITY."

Confirma o desenho vigente: `crm_user` (superuser, dono das tabelas, usado por migrations, seed e
`PrismaAdminService`) bypassa; `crm_app` (`NOSUPERUSER NOBYPASSRLS`, `20260724040000_create_app_role`)
é sujeito. Por isso o provisionamento de estágios na criação da conta **tem que** passar pelo
`PrismaAdminService` — igual a `Subscription` e `Role`.

### Prisma — unique composta e `findUnique`

Trocar `name String @unique` por `@@unique([ownerId, name])` renomeia o input de `findUnique`: o
argumento passa de `{ where: { name } }` para `{ where: { ownerId_name: { ownerId, name } } }`. O
projeto já usa essa forma em dois lugares — `apps/api/prisma/seed.ts:66-99`
(`upsert` na unique `ownerId_name` de `Role`) e
`apps/api/src/modules/users/users.service.ts:67-68`
(`where: { provider_providerAccountId: { provider, providerAccountId } }`). Logo
`prisma-pipeline-stage.repository.ts:19` é reescrita mecânica, sem pesquisa adicional.

### Libraries & Dependencies

**Nenhuma dependência nova.** Todo o ferramental necessário já está no projeto: Prisma
(`@prisma/client`), `nestjs-cls` (propagação da transação), `class-validator` (`@IsUUID('4')` para
`assigneeId`), TanStack Query, `@dnd-kit/*`, RHF + Zod, `useUrlFilters`.

## Historical Context

- **`specs/research/2026-07-21-fase-2-pipeline.md` / `specs/plans/…` (status: implemented)** — o
  funil global nasceu como premissa de single-tenant, não como descuido: `research:47` registra
  "`PipelineStage` […] **sem `ownerId`** (stages globais, single-tenant)" e `plans:66` lista
  "**Multi-tenancy / RLS** — segue single-tenant; posse via `client.ownerId`" em *What We're NOT
  Doing*. O `name @unique` global virou regra de negócio no service (`plans:182-201`: 409 "Já existe
  um estágio com este nome." + `maxOrder()` global). A interface do repositório
  (`plans:87-100`) foi desenhada sem `ownerId` em **nenhum** método.

- **`specs/research/2026-07-23-rls-por-ownerid.md` / `specs/plans/…` (status: implemented)** — a
  omissão foi uma decisão **explícita e datada** do usuário (`research:202`): "**`PipelineStage` →
  global, sem policy.** Mantido como 'template' único da agência: **não** ganha `ownerId`, **não**
  recebe `ENABLE/FORCE RLS`. […] **Escapar depois, se virar multiusuário real.**" O PRD já havia
  diagnosticado o efeito (`research:70`): "**Dois usuários compartilhariam o mesmo conjunto de
  estágios.**" E antecipou o trabalho da Fase 7 numa linha (`research:37`): "**Precisa semear owner
  + estágios por owner**". O plano fixou o template SQL da policy (`plans:341-348`) e registrou que
  "`prisma-pipeline-stage.repository.ts` **não** muda — stage não tem ownerId" (`plans:157`).
  **A Fase 7 é o resgate declarado desse débito.**

- **`specs/plans/2026-07-25-colaboradores-e-papeis.md` (status: implemented, commit `992b507`)** —
  entregou o multiusuário real (owner + colaborador + `Role` com `permissions String[]` +
  `AccessGuard` + `useCan()`), mas **sobre o funil compartilhado**, sem tocar `PipelineStage`. E
  declarou a Frente B fora de escopo (`:66`): "**Sem permissão por registro** (ex.: 'só os clientes
  que eu criei'). A granularidade é por módulo/ação, e **todo colaborador vê todos os dados do
  owner**." É a origem exata dos dois defeitos P0.

- **`specs/research/2026-07-23-fase-4-demandas.md` / `specs/plans/…` (status: implemented)** — "Minhas
  demandas" nasceu como lista de **todas** as tarefas com filtros (`plans:1527-1560`: "Filtros:
  Prioridade, Cliente […], Prazo"; "**Backend**: nenhum endpoint novo"), read-only ordenada por
  prazo/prioridade (`research:42`), com "RBAC/permissões — `ownerId` continua derivado; sem
  multi-tenant" (`research:47`). O nome sempre foi aspiracional.

- **Commits recentes relevantes** (`git log`):
  - `0e80664 migration(pipeline): planta os estágios padrão do funil` — a migration
    `20260725130000_seed_default_pipeline_stages`, com guard **global** `WHERE NOT EXISTS (SELECT 1
    FROM "PipelineStage")`; o comentário do SQL documenta que em produção o Kanban nascia vazio
    (`firstStage()` → "Nenhum estágio configurado"). É o estado de produção que a Fase 7 herda.
  - `0c9d1da migration(rls): ativa RLS por ownerId nas 10 tabelas de dados` — a que omitiu
    `PipelineStage`.
  - `8c12b67 refactor(rls): repositórios passam a acessar o Prisma via this.prisma.db` — deixou o
    repo de estágios usando `.db` "por uniformidade", sem filtro de owner.
  - `c592f10`, `e2acb9d`, `576e8bd`, `bba1d70` — a fase de colaboradores/papéis/permissões.
  - `bd2aa80 feat(listagens): persiste filtros na URL das listagens` — o `useUrlFilters` que os
    filtros por responsável vão usar.
  - `4d286d8 feat(kanban): mostra prévia ao vivo e assenta o card sem pulo no drop` — o
    `useKanbanDnd` compartilhado pelos dois boards.

- **`SPEC.md` e `ROADMAP.md` têm mudanças não commitadas** que criam a Fase 7 e reposicionam o
  produto: `ROADMAP.md` trocou "Single-tenant no MVP" por "**Uma instância atende vários owners,
  isolados por `ownerId` (RLS no banco)**", e `SPEC.md` §2.2 passou a apontar o ROADMAP como fonte
  única do backlog. **`SPEC.md` §4 ainda documenta `PipelineStage` sem `ownerId` (`:251-258`) e
  §1.3 ainda diz "Single-user no MVP" (`:28`)** — os dois trechos ficam falsos com a Fase 7 e
  entram no escopo de atualização de doc.

## Constraints & Considerations

- **Produção está no ar** em `crm.programeai.com.br`, com autocadastro **aberto**
  (`REGISTRATION_ENABLED=true`, commit `6847b9b`). Ou seja: pode haver mais de um owner no banco
  **agora**, todos compartilhando os mesmos 7 estágios plantados por `0e80664`. A migration de dados
  não é hipotética — ela precisa funcionar com N owners e com estágios possivelmente **já
  renomeados/reordenados/criados** por quem chegou primeiro. Consequência prática: replicar os
  estágios **existentes na tabela** por owner (preservando `name`/`order`/`isWon`/`isLost`), religar
  cada `Deal` para a cópia do seu próprio `ownerId`, e só então remover as linhas órfãs — não
  presumir que os 7 padrões estão intactos.

- **Owner sem nenhum deal também precisa de estágios.** Um owner que se cadastrou e nunca criou
  oportunidade não aparece em nenhum join por `Deal`; a replicação tem que partir de
  `"User" WHERE "ownerId" IS NULL`, não dos deals.

- **`Deal.stageId` é `NOT NULL` com FK `ON DELETE RESTRICT`** (`20260721002325_init/migration.sql:277`).
  A ordem da migration de dados é obrigatória: criar as cópias → `UPDATE "Deal"` → apagar as
  originais. Inverter a ordem viola a FK.

- **`PipelineStage.id` é `TEXT`** (`@default(uuid())`), não `uuid` — usar `gen_random_uuid()::text`,
  como já faz `20260725130000_seed_default_pipeline_stages/migration.sql`.

- **A migration de dados roda como `crm_user` (superuser), que bypassa RLS** — não é preciso setar
  `app.owner_id` no SQL. Já o `PrismaAdminService` é o único caminho para criar estágios no cadastro,
  porque ali ainda não existe contexto de owner (mesma razão de `Subscription` e `Role`).

- **`prisma migrate dev` não pode gerar essa migration sozinho.** O Prisma emitiria
  `ADD COLUMN "ownerId" TEXT NOT NULL` (falha com dados) e `DROP INDEX`/`CREATE UNIQUE INDEX`
  sem a replicação. A migration é escrita à mão, no molde de `20260724025450_denormalize_owner_id`
  (nullable → backfill → NOT NULL → índice), com `prisma migrate dev --create-only`.

- **`countDeals(stageId)` tem um bug latente hoje que a Frente A resolve de graça**: `Deal` tem RLS e
  `PipelineStage` não, então o guard de exclusão conta apenas os deals do owner do request — um
  estágio com deals de **outro** owner passa a validação da aplicação e estoura na FK
  `ON DELETE RESTRICT` como erro 500 não tratado. Com estágios por owner o cenário desaparece.

- **`GET /pipeline-stages` não tem `@RequirePermission`** por design documentado
  (`pipeline-stages.controller.ts:16-21`, "leitura livre p/ logado"). Ao virar dado por owner, a
  leitura passa a ser owner-scoped de qualquer forma; manter ou não o decorator é decisão a registrar
  no plano (o plano deve deixar explícito, não deixar implícito).

- **`reorder(ids)` não valida os ids** (`pipeline-stages.service.ts:73-76`): ids inexistentes fazem o
  `update` do Prisma lançar P2025 dentro de um `Promise.all`. Com RLS, ids **de outro owner** passam
  a cair no mesmo caminho — o que era vazamento vira erro cru. Vale endereçar junto (validar que os
  ids são exatamente o conjunto do owner).

- **`Activity` não filtra owner na aplicação** (`prisma-activity.repository.ts:13-28`) — depende só do
  RLS. Ao adicionar filtro por `assigneeId` ali, o `where` continua sem `ownerId`: manter a assimetria
  ou corrigi-la é escolha do plano, mas ela precisa ser consciente.

- **`clients.service.ts` faz spread do DTO** (`:33`, `:63-64`) — `assigneeId` chegaria ao Prisma
  **sem validação de pertencimento** se o DTO for só `@IsUUID()`. Em `Client` a validação tem que ser
  adicionada explicitamente, ao contrário de `Deal`/`Task`, onde o service monta campo a campo e o
  esquecimento é visível.

- **`TaskFormDialog.tsx` não usa RHF/Zod** (`useState<FormState>` + PATCH por campo na edição),
  divergindo do padrão de `DealFormDialog`/`ClientFormDialog`. Adicionar um select de responsável ali
  não é simétrico ao dos outros três — o plano deve dizer se migra o formulário ou adapta o campo.

- **Query keys sem params colidem**: `queryKeys.deals.board` (`query-keys.ts:15`) e
  `queryKeys.tasks.myBoard` (`:37`) são constantes. Filtrar o board por responsável **exige** virá-las
  funções de params, ou o cache de "meus deals" sobrescreve o de "todos" (e o optimistic update de
  `useMoveDeal`/`useMoveMyTask` passa a escrever no recorte errado).

- **Editar o próprio papel invalida a sessão em curso** — `useUpdateRole`/`useRemoveRolePermission`
  já invalidam `queryKeys.auth.me` (`features/organizacao/api/hooks.ts:74,86`). Permissões novas de
  escopo herdam esse comportamento sem trabalho extra.

- **Log estruturado obrigatório** (`apps/api/CLAUDE.md` → "Log estruturado", `docs/observabilidade.md`):
  eventos novos em `substantivo.acao_no_passado` pt-BR, nome estável, sem segredo. Candidatos:
  `funil.estagios_provisionados`, `registro.responsavel_alterado`.

- **`ENDPOINTS.md` é Definition of Done** (`apps/api/CLAUDE.md` → "Documentação de endpoints"): toda
  rota nova/alterada no mesmo commit, com os rótulos fixos **Propósito / Auth / Body / Resposta /
  Erros / Handler**. A Fase 7 mexe em ~15 endpoints (5 de stages, deals, tasks, activities, clients,
  dashboard) e provavelmente adiciona 1 (membros da workspace).

- **Toda mensagem em pt-BR** (`CLAUDE.md` da raiz, sem exceção): exceções da API, validações
  class-validator, textos de UI. Rótulos de enum via `apps/web/src/lib/labels.ts`; "Sem responsável"
  / "Atribuídos a mim" não são enums e ficam inline.

- **Os 7 estágios padrão estão duplicados em dois lugares hoje** (`seed.ts:101-118` e a migration
  `0e80664`). O provisionamento na criação da conta seria a **terceira** cópia — candidato natural a
  constante compartilhada em `apps/api/src/shared/` consumida pelo `UsersService` (e, se possível,
  pelo `seed.ts`).

- **A Fase 7 é dependência declarada da Fase 15** (ROADMAP: "Roteamento do lead novo para um
  responsável (depende da Fase 7)") e insumo da Fase 14 ("Resultado por responsável"). O modelo de
  `assigneeId` escolhido aqui é contrato para elas.

## Open Questions

1. **Como modelar as permissões de escopo por registro?** O ROADMAP pede "ver/gerenciar só os
   próprios registros × os de todos", e a resposta muda o catálogo, o `AccessService`, o editor de
   papéis e a assinatura de todos os métodos de listagem afetados. Três opções concretas:
   - **(a) Chave "todos" por recurso** — mantém `cliente:ver`/`oportunidade:ver`/… com o significado
     atual de acesso ao módulo, e adiciona 3 chaves novas (`cliente:ver_todos`,
     `oportunidade:ver_todas`, `demanda:ver_todas`; `Activity` cavalga em `cliente:*`). Sem a chave,
     a listagem é forçada a `assigneeId = userId`. **Recomendada**: é aditiva (papéis existentes
     ganham a chave nova no `system`/owner e nada regride), cabe no formato `recurso:acao` do
     catálogo, e o campo `PermissionMeta.hidden` (`permissions.ts:33`) permite entregar sem expor.
   - **(b) Flag de escopo no `Role`** — `Role.recordScope: 'ALL' | 'OWN'`, ortogonal às 14 chaves.
     Menos chaves, mas introduz um segundo eixo de autorização fora do catálogo — que é declarado
     "fonte única" em `permissions.ts:1-11`.
   - **(c) Par `:ver_proprios` / `:ver` por recurso** — dobra o catálogo (+8 chaves) e torna possível
     um papel incoerente (só `_proprios` de um lado, `:gerenciar` do outro).

   Sub-pergunta que (a) e (c) deixam aberta: **registro sem responsável (`assigneeId = null`) é
   visível para quem só vê os próprios?** Sugestão: sim para leitura (senão lead novo fica invisível
   e o roteamento da Fase 15 não tem de onde partir), configurável depois.

2. **Qual o comportamento default dos boards?** "Minhas demandas" e o board do funil "filtram pelo
   usuário logado" — isso é (a) filtro **default** com opção de ver todos (quem tem a permissão), ou
   (b) filtro **opcional** desligado por padrão? Muda a expectativa do owner solo, que hoje vê tudo:
   com (a) e `assigneeId` nulo em todos os registros legados, ele abriria os dois boards **vazios**
   logo depois do deploy. Sugestão: default "todos" para quem tem a permissão de ver todos, com o
   filtro "Atribuídos a mim" a um clique e persistido na URL (`useUrlFilters`); default "meus" apenas
   para quem não tem a permissão ampla — aí não é filtro, é escopo.

3. **Que endpoint alimenta o seletor de responsável?** `GET /collaborators` não serve: exige
   `colaborador:gerenciar` (`collaborators.controller.ts:14`, decorator na classe) e **não retorna o
   owner** (`where: { ownerId }`, e owner tem `ownerId = null`). Opções: (a) rota nova
   `GET /workspace/members` — owner + colaboradores ativos, shape mínimo `{ id, name, isOwner }`,
   sem `@RequirePermission` (só sessão), no molde de `GET /permissions`; (b) relaxar a permissão de
   `GET /collaborators` e incluir o owner na listagem — mas ela devolve `email`, `status` e `role`,
   dados de Organização que não deveriam vazar para quem só gerencia demandas. **Sugestão: (a)**, com
   `apps/web/src/lib/members-lookup.ts` espelhando `clients-lookup.ts` (a regra de
   `apps/web/CLAUDE.md` proíbe uma feature importar o interior de outra, então o lookup não pode sair
   de `features/organizacao`).

4. **Colaborador desativado ou com convite pendente pode ser responsável?** `CollaboratorResponse`
   deriva `status: 'PENDING' | 'ACTIVE' | 'INACTIVE'` (`collaborators.service.ts:177-192`).
   Sugestão: só `ACTIVE` pode ser **atribuído**, mas registros já atribuídos a alguém desativado
   **continuam** exibindo o nome (não zerar histórico silenciosamente) — e a desativação não faz
   reatribuição automática. Se o plano quiser reatribuição, é escopo extra a declarar.

5. **`Activity.assigneeId` é "responsável" ou "autor"?** `Activity` é registro de interação
   (`NOTE | CALL | MEETING | EMAIL | WHATSAPP | FOLLOW_UP`) com `scheduledFor`/`completedAt`. Para
   follow-up agendado, "responsável" faz sentido; para uma anotação já feita, o campo natural é
   "autor" (quem registrou, preenchido automaticamente, não escolhido). O ROADMAP pede `assigneeId`
   nos quatro modelos — vale confirmar se em `Activity` é atribuição manual (como nos outros três) ou
   autoria automática, porque muda o formulário do `TimelineTab` e o significado de
   `upcomingActions` no dashboard.

6. **A Frente A e a Frente B saem no mesmo release?** São independentes: a Frente A não depende de
   nenhuma das perguntas acima e tem risco concentrado numa migration de dados sobre banco de
   produção; a Frente B é aditiva (colunas nullable, sem backfill) mas larga (4 modelos, 4
   formulários, catálogo de permissões, 2 boards, dashboard). Sugestão: **dois planos**, Frente A
   primeiro — encurta a janela de risco da migration e destrava a Frente B sem esperar as decisões de
   produto.

## Code References Index

**Banco / migrations**
- `apps/api/prisma/schema.prisma:13-42` — `model User` (precisa de back-relations para stages e assignees)
- `apps/api/prisma/schema.prisma:47-64` — `model Role` (o molde: `ownerId` + `@@unique([ownerId, name])` + índice)
- `apps/api/prisma/schema.prisma:132-167` — `model Client`
- `apps/api/prisma/schema.prisma:183-190` — `model PipelineStage` (alvo: sem `ownerId`, `name @unique`)
- `apps/api/prisma/schema.prisma:192-215` — `model Deal` (`stageId`, `@@index([stageId, position])`)
- `apps/api/prisma/schema.prisma:286-305` — `model Task`
- `apps/api/prisma/schema.prisma:357-374` — `model Activity`
- `apps/api/prisma/migrations/20260721002325_init/migration.sql:88-95,247,250,277` — DDL de `PipelineStage`, unique de `name`, índice e FK `Deal_stageId_fkey ON DELETE RESTRICT`
- `apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql` — padrão nullable → backfill → NOT NULL → índice
- `apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql:15-21` — `crm_app` NOSUPERUSER NOBYPASSRLS + GRANTs + default privileges
- `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:2` — comentário que exclui `PipelineStage`; template da policy `owner_isolation`
- `apps/api/prisma/migrations/20260724140000_add_subscription/migration.sql:35-42` — RLS em tabela nova (versão enxuta)
- `apps/api/prisma/migrations/20260725120000_add_collaborators_and_roles/migration.sql:75-118` — backfill por owner + RLS + GRANT explícito (**o molde completo**)
- `apps/api/prisma/migrations/20260725130000_seed_default_pipeline_stages/migration.sql:21` — guard global `WHERE NOT EXISTS`
- `apps/api/prisma/seed.ts:64-123` — owner, papéis por owner, os 7 estágios e o helper `stage(name)`
- `apps/api/prisma/seed.ts:125-136` — limpeza idempotente escopada por `ownerId`

**Backend — infraestrutura de acesso**
- `apps/api/src/app.module.ts:66-77` — ordem dos guards + `OwnerContextInterceptor`
- `apps/api/src/prisma/owner-context.interceptor.ts:36-52` — `$transaction` + `set_config('app.owner_id', …, true)` + CLS
- `apps/api/src/prisma/prisma.service.ts:14-41` — conecta como `crm_app`; `get db()` devolve a tx do request
- `apps/api/src/prisma/prisma-admin.service.ts:5-19` — client superuser (cadastro, crons, seed)
- `apps/api/src/shared/permissions.ts:14-72` — categorias e as 14 chaves do catálogo
- `apps/api/src/shared/permissions.ts:33` — `PermissionMeta.hidden?` (entregar sem expor)
- `apps/api/src/shared/permissions.ts:75-189` — `ALL_PERMISSION_KEYS`, `permissionMeta`, `sanitizePermissionKeys`, `permissionCatalog`, `visiblePermissionKeys`
- `apps/api/src/modules/access/access.guard.ts:38-68` — decisão binária por rota (não vê o recurso)
- `apps/api/src/modules/access/application/access.service.ts:26-72` — resolve `req.access`; papel `system` = catálogo inteiro
- `apps/api/src/modules/access/domain/access-context.ts:11-20` — `AccessContext` já tem `userId` **e** `ownerId`
- `apps/api/src/shared/current-user.decorator.ts:8-52` — `@CurrentUserId`, `@CurrentOwnerId`, `@CurrentAccess`
- `apps/api/src/shared/dto/pagination-query.dto.ts:1-16` — base dos DTOs de listagem

**Backend — pipeline**
- `apps/api/src/modules/pipeline/domain/pipeline-stage.repository.ts:6-22` — porta sem `ownerId` em nenhum método
- `apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts:10-47` — 9 métodos globais; `findByName` (`:19`), `maxOrder` (`:31`), `countDeals` (`:37`), `reorder` (`:39`)
- `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts:22-86` — `list`/`findOne`/`firstStage`/`wonStage`/`create`/`update`/`reorder`/`delete`
- `apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts:16-52` — doc-comment "catálogo global"; `GET` sem permissão
- `apps/api/src/modules/pipeline/api/dto/create-pipeline-stage.dto.ts` / `update-…` / `reorder-stages.dto.ts` — DTOs de estágio
- `apps/api/src/modules/pipeline/application/deals.service.ts:52-69` — `create` (campo a campo, usa `firstStage()`)
- `apps/api/src/modules/pipeline/application/deals.service.ts:71-94` — `update` (patch condicional)
- `apps/api/src/modules/pipeline/application/deals.service.ts:96-123` — `move` (`isWon`/`isLost`, `stageMovedAt`, `createFromDeal`)
- `apps/api/src/modules/pipeline/domain/deal.repository.ts:6-17` — `DealWithClient`, `DealListFilter`
- `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:27-55` — `where` da listagem e `findAllForBoard`
- `apps/api/src/modules/pipeline/api/dto/list-deals-query.dto.ts:4-10` — query de deals
- `apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts:15-44` / `update-deal.dto.ts:4-6` — DTOs de deal
- `apps/api/src/modules/pipeline/application/pipeline-stages.service.spec.ts` / `deals.service.spec.ts` — testes a atualizar

**Backend — demais consumidores**
- `apps/api/src/modules/proposals/application/proposals.service.ts:247-257` — `moveDealToWon` (usa `wonStage()` sem owner)
- `apps/api/src/modules/projects/application/projects.service.ts:103-114` — `createFromDeal` (idempotente por `dealId`)
- `apps/api/src/modules/projects/api/tasks.controller.ts:24-90` — 10 rotas e suas permissões
- `apps/api/src/modules/projects/api/dto/list-tasks-query.dto.ts:5-21` — query de tasks
- `apps/api/src/modules/projects/application/tasks.service.ts:24-47` — `list` e `board` (cross-projeto)
- `apps/api/src/modules/projects/infra/prisma-task.repository.ts:38-87` — `where` e `findAllForBoardByOwner`
- `apps/api/src/modules/activities/infra/prisma-activity.repository.ts:13-28` — `where` **sem** `ownerId` (só RLS)
- `apps/api/src/modules/activities/api/dto/list-activities-query.dto.ts:4-9` — query de atividades
- `apps/api/src/modules/clients/application/clients.service.ts:27-34,55-71` — spread do DTO em `create`/`update`
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:23-49` — `where` por coluna `ownerId`
- `apps/api/src/modules/collaborators/api/collaborators.controller.ts:13-21` — `@RequirePermission('colaborador:gerenciar')` na classe
- `apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts:11-34` — `where: { ownerId }` (exclui o owner)
- `apps/api/src/modules/collaborators/application/collaborators.service.ts:20-28,177-192` — `CollaboratorResponse` e derivação de `status`
- `apps/api/src/modules/users/users.service.ts:22-45` — helpers `trialSubscription()` / `systemRole()`
- `apps/api/src/modules/users/users.service.ts:47-57,86-107` — `create` e `createWithOAuth` (os dois pontos de provisionamento)
- `apps/api/src/modules/auth/auth.service.ts:33-45,79-86` — `register` e `oauthLogin`
- `apps/api/src/modules/dashboard/api/dashboard.controller.ts:15-30` — `GET /summary` (sem permissão) e `/finance`
- `apps/api/src/modules/dashboard/application/dashboard.service.ts:74-135` — recorte por permissão e os 4 blocos
- `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:19-42` — `funnel` (único read global de stages)
- `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:78-165` — agregações de tasks e follow-ups
- `apps/api/ENDPOINTS.md:282-324` — 5 endpoints de pipeline-stages
- `apps/api/ENDPOINTS.md:326-383` — endpoints de deals
- `apps/api/ENDPOINTS.md:715` — contrato do bloco `funnel` do dashboard

**Frontend**
- `apps/web/src/lib/api.ts` — axios, `paramsSerializer: { indexes: null }`, refresh e 402
- `apps/web/src/lib/query-keys.ts:13-20,32-40` — `deals.board` e `tasks.myBoard` **sem params**
- `apps/web/src/lib/clients-lookup.ts:14-42` — modelo de lookup transversal (`buildClientItems`)
- `apps/web/src/lib/labels.ts:9-129` — `make<T>()` e os tradutores de enum
- `apps/web/src/hooks/use-can.ts:13-32` — `can`/`canAny`/`isOwner`/`loading`
- `apps/web/src/hooks/use-kanban-dnd.ts:49-223` — DnD compartilhado pelos dois boards
- `apps/web/src/app/PermissionRoute.tsx:18-30` — gate de rota
- `apps/web/src/app/AppLayout.tsx:64-68` — filtro da navegação
- `apps/web/src/app/nav.ts:20-63` — `NavItem.permission` e as chaves por item
- `apps/web/src/routes/router.tsx:37-42` — constantes de permissão das rotas
- `apps/web/src/features/pipeline/api/types.ts:6-51` — `PipelineStage`, `Deal`, bodies
- `apps/web/src/features/pipeline/api/hooks.ts:18-29,57-81,88-135` — `useBoard`/`useStages`, `useMoveDeal` (otimista), mutations de estágio
- `apps/web/src/features/pipeline/PipelineBoardPage.tsx:19-88` — board sem filtro
- `apps/web/src/features/pipeline/components/DealCard.tsx:13-35` — card do deal
- `apps/web/src/features/pipeline/DealFormDialog.tsx:29-41,92-97,158-204` — padrão canônico de form + select da API
- `apps/web/src/features/pipeline/StageConfigDialog.tsx:129-254` — config de estágios (dialog)
- `apps/web/src/features/demandas/MinhasDemandasPage.tsx:39-44,73,92-101,158-194` — filtros na URL, `useMyBoard`, filtragem client-side, toolbar
- `apps/web/src/features/demandas/api/types.ts:29-44,99-107` — `Task` e `ListTasksParams`
- `apps/web/src/features/demandas/api/hooks.ts:66-72,159-184` — `useMyBoard` e `useMoveMyTask`
- `apps/web/src/features/demandas/TaskFormDialog.tsx` — form sem RHF/Zod (divergente)
- `apps/web/src/features/clientes/ClientFormDialog.tsx:44-65` — form de cliente (RHF + Zod)
- `apps/web/src/features/clientes/tabs/TimelineTab.tsx:27-71,91` — form de atividade
- `apps/web/src/features/dashboard/DashboardPage.tsx:117-365` — cards, funil e gating por permissão
- `apps/web/src/features/dashboard/api/types.ts:58-76` — blocos `null`-áveis
- `apps/web/src/features/organizacao/api/hooks.ts:12-17,101-108` — `useCollaborators` e `usePermissionCatalog`
- `apps/web/src/features/organizacao/PapelFormDialog.tsx:49-191` — editor de papel (checkbox por categoria)
- `apps/web/src/features/perfil/api/perfil.api.ts:3-25` — tipo `Me` (`isOwner`, `role`, `permissions`)

**Docs e specs**
- `CLAUDE.md` (raiz) — pt-BR obrigatório, isolamento por `ownerId`, colaboradores e papéis
- `apps/api/CLAUDE.md:87-99` — autorização, ordem dos guards, catálogo como fonte única
- `apps/api/CLAUDE.md:54-79` — `ENDPOINTS.md` como Definition of Done e log estruturado
- `apps/web/CLAUDE.md` — "Permissões na interface", formulários (asterisco), design system, modais
- `docs/observabilidade.md:54-114` — formato de `evento` e regras de log
- `ROADMAP.md:202-226` — Fase 7 (não commitado)
- `ROADMAP.md:331` — Fase 15 depende da Fase 7
- `SPEC.md:28,251-258,407,477` — trechos que a Fase 7 torna obsoletos
- `specs/plans/2026-07-21-fase-2-pipeline.md:66,81,182-201,2217-2218` — decisão original do funil global
- `specs/research/2026-07-23-rls-por-ownerid.md:66,70,202` — diagnóstico e a decisão explícita de deixar `PipelineStage` fora
- `specs/plans/2026-07-23-rls-por-ownerid.md:35,43,157,339-348` — padrão de RLS e template da policy
- `specs/plans/2026-07-25-colaboradores-e-papeis.md:19-21,46-57,66` — modelo de colaboradores e a exclusão explícita de permissão por registro
- `specs/plans/2026-07-23-fase-4-demandas.md:1527-1560` — origem de "Minhas demandas"
