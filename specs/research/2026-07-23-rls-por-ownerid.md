---
date: 2026-07-23T00:00:00-03:00
researcher: claude
git_commit: 1c52945c063bb23f8bed23f9cbed63a945d3fcd8
branch: main
topic: "RLS (Row-Level Security) por ownerId no Postgres como defesa em profundidade"
tags: [research, rls, prisma, postgres, seguranca, multi-tenancy, auth]
status: complete
---

# Research: RLS por ownerId no Postgres (defesa em profundidade)

## Research Question

Implementar Row-Level Security por `ownerId` no Postgres como **defesa em profundidade**, mantendo os filtros `ownerId` que já existem no código da aplicação. Escopo: **só RLS agora** (sem cadastro/reset de senha). Decisões já tomadas:
1. Manter os filtros `ownerId` no código E adicionar RLS por baixo (belt-and-suspenders).
2. Denormalizar `ownerId` em todas as tabelas que hoje escopam por join.
3. Role de aplicação Postgres sem `BYPASSRLS` + role privilegiada para migrations/login.
4. `SET LOCAL app.owner_id` por transação.

## Summary

Hoje o CRM é single-tenant com auth JWT funcional. Apenas o modelo **`Client`** possui coluna `ownerId` (String, texto); todos os outros modelos de negócio (Contact, Deal, Proposal, ProposalItem, Project, Task, Contract, Payment, Activity) são escopados **por join transitivo** até `Client.ownerId` na camada de aplicação — ex.: `where: { client: { ownerId } }`. O `PipelineStage` é **totalmente global** (sem `ownerId`, sem escopo em nenhuma query). O app conecta no Postgres como `crm_user`, que é **superuser e dono das tabelas** — ou seja, hoje qualquer RLS seria ignorado por padrão.

Existe um risco de IDOR sistêmico: dezenas de métodos de repositório buscam/atualizam/deletam **por `id` sem qualquer restrição de dono** (`findUnique({ where: { id } })`), confiando 100% na camada de service para validar o dono antes. É exatamente esse tipo de furo que o RLS deve fechar no banco.

A pesquisa externa confirma o padrão canônico (Prisma oficial + docs Postgres): usar `set_config('app.owner_id', $1, TRUE)` **dentro de uma transação** (nunca `SET` de sessão, que vaza no pool), `ENABLE` + `FORCE ROW LEVEL SECURITY` por tabela, policy com `USING` **e** `WITH CHECK` idênticos, `current_setting(..., true)` (fail-closed = zero linhas quando o contexto não está setado), e uma role de app **não-superuser, não-dona, sem BYPASSRLS** com apenas DML. Não há CLS/AsyncLocalStorage no projeto hoje — a propagação do `ownerId` por request é plumbing nova.

## Codebase Map

### Arquivos afetados

| Arquivo | Papel | Relevância |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Fonte de verdade do modelo | Adicionar `ownerId` em 9 modelos + índices; nenhum `@@map` (tabelas = nome do model, PascalCase, case-sensitive) |
| `apps/api/prisma/migrations/` | Migrations SQL | Nova migration: `ADD COLUMN ownerId` + backfill + `ENABLE`/`FORCE RLS` + policies + role. 4 migrations existentes; estilo Prisma-padrão (identificadores entre aspas duplas) |
| `apps/api/prisma/seed.ts` | Seed | `new PrismaClient()` próprio. **Não** amarra `ownerId` ao user admin; `PipelineStage` semeado sem owner. Precisa semear owner + estágios por owner |
| `apps/api/src/prisma/prisma.service.ts` | PrismaClient singleton | Precisa de extension `$extends` (query override) que faz `set_config` por transação; hoje é singleton puro sem `$extends`/`$use` |
| `apps/api/src/prisma/prisma.module.ts` | `@Global()` | Provavelmente ganha provider RLS-scoped (request-scoped ou via CLS) + provider privilegiado |
| `apps/api/src/modules/auth/jwt-auth.guard.ts` | Guard global | Ponto onde `req.user.sub` passa a existir (`jwt-auth.guard.ts:34`) — fonte do `ownerId` |
| `apps/api/src/shared/current-user.decorator.ts` | `@CurrentUserId()` | Lê `req.user.sub` (`:10`) — o mesmo valor precisa ir para o contexto do Prisma |
| `apps/api/src/app.module.ts` | Bootstrap DI | Registrar CLS module / interceptor / middleware novo; guards globais em `:38-41` |
| `apps/api/src/main.ts` | Bootstrap HTTP | Só `cookieParser` + `ValidationPipe`; sem interceptor global hoje |
| `apps/api/src/config/env.validation.ts` | Joi env | Só valida `DATABASE_URL`. Precisa de nova var para a URL privilegiada (migrations/login) |
| `docker-compose.yml` | Postgres 16-alpine | `crm_user`/`crm_password`/`crm_db`, porta `5435:5432`. **Sem** init-script mount — criar role de app exige migration SQL ou init script novo |
| `apps/api/.env` / `.env.example` | Conexão | `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db?schema=public` — user é superuser/dono |
| Todos os `infra/prisma-*.repository.ts` (11) | Repositórios | Não mudam a lógica de filtro (defesa em profundidade), mas os `$transaction` interativos precisam rodar sob o contexto RLS |

### Modelos e cadeia de posse (backfill de `ownerId`)

Fonte: `schema.prisma`. Sem `@@map` → tabela = nome do model, case-sensitive (`"Client"`, `"Deal"`…). Todos os PKs são `id String @id @default(uuid())` (texto, **não** uuid nativo) → comparações de policy são **texto = texto, sem cast `::uuid`**.

| Model | Tem `ownerId`? | Caminho até `Client.ownerId` (backfill) |
|---|---|---|
| **User** | Não (**e não deve ter** — tabela de auth, consultada por email antes de haver owner) | — |
| **Client** | **Sim** (`:24`), índices `[ownerId,status]` `[ownerId,archivedAt]` (`:55-56`) | RAIZ da posse |
| Contact | Não | `clientId` → Client (1 hop) |
| Deal | Não | `clientId` → Client (1 hop) |
| Proposal | Não | `clientId` → Client (1 hop) |
| ProposalItem | Não | `proposalId` → Proposal → Client (2 hops) |
| Project | Não | `clientId` → Client (1 hop) |
| Task | Não | `projectId` → Project → Client (2 hops) |
| Contract | Não | `clientId` → Client (1 hop) |
| Payment | Não | `contractId` → Contract → Client (2 hops) |
| Activity | Não | `clientId` → Client (1 hop) |
| **PipelineStage** | Não — **global**, sem relação com Client | **Decisão de produto pendente** (ver Open Questions) |

### Furos conhecidos de isolamento (o que o RLS fecha)

**1. `PipelineStage` é global.** `prisma-pipeline-stage.repository.ts` — `list` (`:10`, sem where), `findById` (`:13`), `findByName` (`:16`, `name` é unique global), `create/update/delete` (`:19-27`), `maxOrder` (`:28`, global), `reorder` (`:37`). O service (`pipeline-stages.service.ts`) nunca recebe `ownerId`; `create` valida unicidade de `name` globalmente e usa `maxOrder+1` global. **Dois usuários compartilhariam o mesmo conjunto de estágios.**

**2. IDOR por `id` sem dono** (confiam no service para validar posse antes):
- contacts: `findById:17`, `update:25`, `delete:29`
- deals: `findById:20`, `update:54`, `delete:62`, `move:80` (todo o tx por id/stageId)
- proposals: `findById:22`, `update:65`, `updateWithItems:73`, `delete:94`, `findVersionsByNumber:115`
- projects: `findById:22`, `update:59`, `delete:67`, `findByDealId:75`
- tasks: `findById:29`, `update:84`, `delete:92`, `move:104`
- contracts: `findById:22`, `update:57`
- payments: `findById:28`, `update:184`
- activities: `findById:30`, `update:38`, e `findManyAndCount:13` **sem piso de owner** (se `clientId` e `dealId` ausentes, lista atividades de todos os donos)

**3. `clients` está correto** — todo caminho por id restringe `ownerId` (`findFirst`, `updateMany` + `findFirstOrThrow`). É o modelo de referência.

### Transações e SQL raw (precisam rodar sob o contexto RLS)

- **`$transaction` interativo (callback `async (tx) => …`)** — precisam do `set_config` no início do mesmo `tx`:
  - `prisma-deal.repository.ts:80` (move)
  - `prisma-task.repository.ts:110` (move)
  - `prisma-proposal.repository.ts:78` (updateWithItems)
- **`$transaction` array-form** (batch): client:37, deal:33, proposal:52 e 96, project:38, task:44, contract:36, activity:18, pipeline-stage:38.
- **Raw SQL**: só `prisma-payment.repository.ts:150` (`$queryRaw`, JOIN Payment→Contract→Client, owner inlined via parâmetro). Nenhum `$executeRaw` no código de negócio.

### Fluxo de auth (roda sem owner conhecido)

- `req.user` é populado só no `JwtAuthGuard` (`jwt-auth.guard.ts:34`): `req.user = verifyAsync<{ sub }>(token)`. Payload do token é **`{ sub }` apenas** (`auth.service.ts:46-59`) — `sub` = `User.id`.
- `@CurrentUserId()` retorna `req.user.sub` (`current-user.decorator.ts:10`). **Este é o `ownerId`** usado hoje em todos os services.
- Rotas `@Public()` (guard bypassa, `req.user` indefinido): **`POST /auth/login`** (`auth.controller.ts:39`) e **`POST /auth/refresh`** (`:54`). `login()` busca `User` **por email** (`auth.service.ts:15`) antes de qualquer owner existir → a tabela `User` **não pode** ter RLS por ownerId, senão auth quebra.
- Guard global: `app.module.ts:39-40` (`ThrottlerGuard`, depois `JwtAuthGuard`).
- **Sem CLS/AsyncLocalStorage/nestjs-cls em lugar nenhum** (grep zero). Propagar `req.user.sub` até o PrismaService singleton é plumbing nova.

## External Research

### Padrão de injeção do owner por request (o problema do pool)

`SET app.owner_id = '...'` de sessão **vaza** para o próximo request que reusar a conexão do pool. Solução: tornar transaction-local via `set_config(..., TRUE)` e garantir que o set e a query rodem **na mesma transação**.

**(a) Prisma Client Extension com `query` override — recomendado para CRUD** (padrão oficial do repo `prisma/prisma-client-extensions/row-level-security`):
```typescript
function forOwner(ownerId: string) {
  return Prisma.defineExtension((prisma) =>
    prisma.$extends({
      query: { $allModels: { async $allOperations({ args, query }) {
        const [, result] = await prisma.$transaction([
          prisma.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, TRUE)`,
          query(args),
        ]);
        return result;
      }}},
    }));
}
const scoped = prisma.$extends(forOwner(ownerId)); // instância por request
```
**Footgun:** a extension já embrulha cada operação numa transação; **não dá para aninhar** um `scoped.$transaction()` explícito por cima e esperar que o `SET LOCAL` valha para todas as statements. Para writes multi-statement atômicos, usar (b).

**(b) `$transaction(async (tx) => …)` interativo — melhor para writes multi-statement:**
```typescript
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, TRUE)`;
  // ...todo o trabalho no mesmo tx (mesma conexão)...
});
```
Em NestJS o idiomático é **`nestjs-cls`** (AsyncLocalStorage): middleware/interceptor guarda o `ownerId` no CLS; provider Prisma lê e injeta o `set_config`. Mantém controllers/services alheios ao plumbing. Os 3 `$transaction` interativos existentes (deal/task/proposal) caem no caso (b).

### SQL das policies

```sql
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE  ROW LEVEL SECURITY;   -- dono da tabela também sujeito
CREATE POLICY owner_isolation ON "Client"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', TRUE))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', TRUE));
```
- `current_setting('app.owner_id', TRUE)` → o `TRUE` é `missing_ok`: variável não setada retorna `NULL` → **fail-closed** (zero linhas), em vez de `ERROR: unrecognized configuration parameter`. **Sempre** usar `TRUE` nas policies.
- `USING` filtra linhas existentes (SELECT + o que UPDATE/DELETE enxergam); `WITH CHECK` valida a linha nova/alterada (INSERT + pós-imagem do UPDATE). **Declarar os dois, idênticos** — só `USING` deixaria inserir linha de outro dono que depois não se consegue ler (write cross-tenant silencioso).
- `ownerId` é **texto** aqui → sem cast `::uuid`.

### Roles Postgres

Docs Postgres: **superusers e roles com `BYPASSRLS` sempre ignoram RLS**; **donos de tabela ignoram** a menos que `FORCE ROW LEVEL SECURITY`. Portanto:
- `FORCE` resolve o dono da tabela, mas **não** o superuser → o app **não pode** conectar como superuser (elimina `crm_user` atual).
- Role dedicada de app, sem posse, só DML:
```sql
CREATE ROLE crm_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
```
Nunca dar `BYPASSRLS` ao app.

### Migrations, backfill e login (precisam contornar o scoping)

- **Migrations/seed** rodam como **dono do schema** (privilegiado) — `prisma migrate` precisa disso.
- **Login** consulta `User` por email antes de haver owner. Opções:
  - **Opção A — duas roles / dois PrismaClients**: `PRISMA_ADMIN` (dono, migrations + auth) e `PRISMA_RLS` (`crm_app`, sempre com extension setando `app.owner_id`). Upgrade path para multi-tenant real.
  - **Opção B — cliente único + tabela `User` sem policy**: como login busca por email, **não habilitar RLS na tabela `User`** resolve; um único cliente com `SET LOCAL` serve para auth e dados. Migrations ainda exigem role dona. **Recomendado hoje** dado o estado single-tenant (RLS é defesa em profundidade pura). Existe ainda o escape-hatch oficial via 2ª GUC `app.bypass_rls` + policy permissiva `USING (current_setting('app.bypass_rls', TRUE) = 'on')`.

### `SET LOCAL` seguro

Não dá para parametrizar `SET`/`SET LOCAL` (valor tem que ser literal → placeholder é erro de sintaxe, interpolar string = SQL injection). Usar a função **`set_config(name, value, is_local)`** com `$executeRaw` tagged-template (vira prepared statement, `${ownerId}` = bound param):
```typescript
await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, TRUE)`;
```
Nunca `$executeRawUnsafe` aqui.

### PgBouncer / pooling

Em transaction pooling, estado de sessão não sobrevive → `SET` de sessão vaza/erra. `SET LOCAL`/`set_config(..., true)` é seguro porque morre no fim da transação. Se um dia entrar PgBouncer, o padrão transaction-scoped já é o correto.

## Historical Context

- `specs/plans/` e `specs/research/` têm as fases 0–5 (fundação, clientes, pipeline, propostas, demandas, financeiro) — este RLS é transversal a todas.
- `CLAUDE.md` (raiz): single-tenant, `ownerId` como "preparação p/ multiusuário", **"Não introduza multi-tenancy sem decisão explícita"** — a decisão explícita foi dada pelo usuário nesta conversa (só RLS, defesa em profundidade).
- `apps/api/CLAUDE.md`: repository pattern obrigatório (services não tocam `PrismaService`), `ENDPOINTS.md` deve refletir toda mudança de rota (este trabalho não muda rotas, mas mexe em comportamento de erro — ver Considerações), mensagens pt-BR.
- Prisma **6.19.3**, NestJS **11**, Postgres **16-alpine**. Seed via `ts-node prisma/seed.ts`; script `db:reset`.

## Constraints & Considerations

- **`Client.ownerId` é texto e assume-se == `User.id`** (o app usa `req.user.sub` como `ownerId`). O seed atual **não** amarra isso: cria user admin (`admin@crm.local`) e clientes/estágios sem ligar `ownerId` ao id do admin. Qualquer backfill/RLS precisa garantir que dados existentes tenham `ownerId` = um `User.id` válido, senão ficam invisíveis sob RLS.
- **Backfill obrigatório antes de `NOT NULL`/policies**: popular `ownerId` nas 9 tabelas via join até `Client` (`UPDATE "Deal" d SET "ownerId" = c."ownerId" FROM "Client" c WHERE d."clientId" = c.id`, e 2-hop para ProposalItem/Task/Payment) numa migration, antes de aplicar `SET NOT NULL` e as policies.
- **Consistência de `ownerId` em writes**: com `ownerId` denormalizado, criar um Deal precisa gravar o `ownerId` do Client pai (senão `WITH CHECK` rejeita ou grava dado órfão). Isso toca os `create` dos services/repos — decidir se o `ownerId` vem do contexto da request ou é derivado do pai (devem coincidir).
- **`FORCE RLS` afeta seed e crons**: o seed e os jobs `@Cron` que rodam sem request (`expireOverdue`, `markOverdue`, `findActiveRecurring`) operam **cross-owner** e rodam **sem contexto de owner** → precisam da conexão privilegiada/bypass, senão passam a enxergar zero linhas.
- **Mudança de comportamento de erro (não de rota)**: hoje um IDOR retorna 404 via checagem no service; sob RLS a linha "não existe" para o dono errado → mantém 404, mas por um caminho diferente. Como é defesa em profundidade, os 404 atuais continuam vindo do service primeiro. `ENDPOINTS.md` provavelmente não muda, mas confirmar.
- **Sem init-script no docker-compose**: criar `crm_app` exige ou adicionar mount em `/docker-entrypoint-initdb.d`, ou criar a role dentro de uma migration privilegiada (idempotente `DO $$ ... IF NOT EXISTS`).
- **Nova env var** para a URL privilegiada (ex.: `DATABASE_URL_ADMIN` ou `MIGRATE_DATABASE_URL`) em `env.validation.ts`, `.env`, `.env.example`.
- **`prisma migrate` só entende SQL** — `ENABLE/FORCE RLS`, `CREATE POLICY`, `CREATE ROLE`, `GRANT` e o backfill entram como SQL manual dentro do arquivo de migration (Prisma não gera nada disso).
- **Testes**: `clients.service.spec.ts` e `auth.service.spec.ts` existem — a plumbing de contexto (CLS/interceptor) precisa ser mockável para não quebrar unit tests que injetam repos falsos.

## Decisões (resolvidas pelo usuário em 2026-07-23)

1. **`PipelineStage` → global, sem policy.** Mantido como "template" único da agência: **não** ganha `ownerId`, **não** recebe `ENABLE/FORCE RLS`. Fica visível a todos (coerente com single-tenant). Escopar depois, se virar multiusuário real.
2. **Conexão → Opção B: cliente único + tabela `User` sem policy.** O app conecta como role `crm_app` (não-superuser, não-dona, sem `BYPASSRLS`, só DML) com `set_config('app.owner_id', …, TRUE)` por transação. `User` fica **sem policy** (login por email funciona). Migrations, seed e os `@Cron` cross-owner usam a **role privilegiada/dona** via env separada.
3. **Propagação → `nestjs-cls` (dependência aprovada).** Middleware guarda `req.user.sub` no CLS; Prisma extension lê e injeta o `set_config`. Services/repos não mudam.

## Open Questions (para o `/spec` resolver — técnicas, não de produto)

1. **Como os `@Cron` e o seed obtêm bypass** — a conexão privilegiada/dona (definida na decisão 2) roda sem policy de owner. Confirmar o wiring: um provider Prisma privilegiado separado (`PRISMA_ADMIN`) injetado nos serviços de cron, ou os crons rodam com um `set_config` de um owner "sistema". Recomendação: provider privilegiado dedicado para crons/seed.
2. **`ownerId` nos `create`**: derivar do contexto da request (CLS) ou do registro pai (`Client.ownerId`)? Precisam coincidir para o `WITH CHECK` passar. Recomendação: gravar a partir do CLS e validar contra o pai quando houver `clientId`.

## Code References Index

- `apps/api/prisma/schema.prisma:24` — único `ownerId` hoje (Client); `:55-56` índices ownerId; `:13-20` model User (sem ownerId)
- `apps/api/prisma/seed.ts:7-29` — seed do admin e 7 PipelineStages, sem amarrar ownerId
- `apps/api/src/prisma/prisma.service.ts:4-15` — PrismaClient singleton, sem `$extends`
- `apps/api/src/prisma/prisma.module.ts:4-6` — `@Global()`, exporta singleton
- `apps/api/src/modules/auth/jwt-auth.guard.ts:24-36` — `@Public()` bypass + `req.user = verify(token)`
- `apps/api/src/shared/current-user.decorator.ts:10` — `req.user.sub` = ownerId
- `apps/api/src/modules/auth/auth.service.ts:15` — login busca User por email (pré-owner); `:46-59` token payload `{ sub }`
- `apps/api/src/modules/auth/public.decorator.ts:3` — `@Public()`
- `apps/api/src/app.module.ts:38-41` — guards globais
- `apps/api/src/main.ts:11-18` — cookieParser + ValidationPipe (sem interceptor)
- `apps/api/src/config/env.validation.ts:8` — só DATABASE_URL
- `docker-compose.yml:3-15` — postgres:16-alpine, crm_user, porta 5435, sem init-script
- `apps/api/.env:3` — DATABASE_URL como crm_user (superuser/dono)
- `apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts:10-46` — stages globais, sem owner
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:17-72` — modelo de referência (owner em todo caminho por id)
- `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:20,54,62,80` — IDOR por id + tx interativo move
- `apps/api/src/modules/projects/infra/prisma-task.repository.ts:29,84,92,110` — IDOR + tx interativo move
- `apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts:22,65,73,78,94` — IDOR + tx interativo updateWithItems
- `apps/api/src/modules/activities/infra/prisma-activity.repository.ts:13,30,38` — sem piso de owner
- `apps/api/src/modules/finance/infra/prisma-payment.repository.ts:150` — único `$queryRaw` (JOIN até Client)
- `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:22` — único read global (pipelineStage), resto owner-scoped
