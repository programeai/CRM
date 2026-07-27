---
date: 2026-07-26T21:05:00-03:00
researcher: claude
git_commit: 35421684362649ab861746eaf7c0fa8bc5932265
branch: main
topic: "Fase 8 — Governança: sessões, auditoria e lixeira"
tags: [research, auth, sessoes, auditoria, soft-delete, rls, prisma, permissoes]
status: complete
---

# Research: Fase 8 — Governança (sessões, auditoria e lixeira)

## Research Question

Escopo declarado em [ROADMAP.md:235-255](../../ROADMAP.md). Três frentes independentes:

**Frente A — Sessões**
1. Substituir `User.refreshTokenHash` (valor único, `schema.prisma:18`) por uma tabela de sessões.
2. Registrar device/IP/último uso por sessão.
3. Listar sessões ativas no perfil; revogar uma ou todas.

**Frente B — Auditoria**
4. Modelo `AuditLog` (owner, autor, entidade, ação, diff, timestamp) com RLS.
5. Registrar mudanças sensíveis: baixa/estorno/cancelamento de cobrança, edição de contrato, aceite/recusa de proposta, papéis e colaboradores, exclusões.
6. Visão de histórico por registro e tela de auditoria do owner.

**Frente C — Lixeira**
7. Soft delete (`archivedAt`) em `Deal`, `Project`, `Task` e `Contact` — hoje só `Client` tem.
8. Restauração e expurgo definitivo, com permissão própria.

A pesquisa cobre as três numa PRD só, prevendo que o `/spec` pode partir em planos independentes (como na Fase 7).

## Summary

**A Frente A é a mais autocontida das três, e o gargalo dela não é a tabela — é o payload do refresh token.** Hoje o refresh JWT carrega apenas `{ sub }` ([auth.service.ts:264-284](../../apps/api/src/modules/auth/auth.service.ts)), e o servidor descobre se ele vale comparando `argon2.verify` contra **um** hash em `User.refreshTokenHash`. Com N sessões por usuário e sem um identificador de sessão no token, validar viraria N verificações argon2 por refresh — inaceitável. A saída padrão é embutir um `sid` (id da sessão) no payload do refresh, o que torna a validação uma busca indexada + um `verify`. Além disso, a tabela de sessões nasce num ponto do sistema onde **não existe contexto de RLS**: o login é rota `@Public()`, roda fora da transação do `OwnerContextInterceptor` ([owner-context.interceptor.ts:38-41](../../apps/api/src/prisma/owner-context.interceptor.ts)) e toca hoje só tabelas sem policy (`User`, `OAuthAccount`, `PasswordResetToken`) — o mesmo grupo em que `Session` naturalmente cai. Tudo que hoje zera `refreshTokenHash` (logout, reset de senha, desativação de colaborador) passa a ser "revogar todas as sessões", e são exatamente **quatro** pontos de escrita no repo inteiro.

**A Frente B tem uma peça de sorte e um bloqueio estrutural.** A sorte: toda requisição autenticada já roda inteira dentro de **uma** transação Prisma aberta pelo `OwnerContextInterceptor`, com o `tx` no CLS — então gravar o `AuditLog` por `prisma.db` já é atômico com a escrita de negócio, sem `$transaction` explícito e sem risco de trilha órfã. O bloqueio: **o autor da ação não existe na camada `application`**. Todos os services recebem `ownerId`, nunca `userId` — a única exceção do repo é `CollaboratorsService.update`, que recebe `requesterId` só para impedir autoalteração ([collaborators.service.ts:121-127](../../apps/api/src/modules/collaborators/application/collaborators.service.ts)). Não existe um único campo `*By` no `schema.prisma`. Ou toda assinatura de service sensível ganha o autor (invasivo, ~15 métodos), ou o autor viaja pelo CLS que já está montado globalmente e já carrega `PRISMA_TX` e `requestId`. Há ainda três classes de escrita **sem ator humano** que a trilha precisa representar: os dois crons diários, o webhook do Stripe e o aceite de convite — todos rodam via `PrismaAdminService`, cross-owner, fora de CLS, e os crons sequer sabem *quais* linhas alteraram (usam `updateMany` e só leem `count`).

**A Frente C é a que mais toca superfície, apesar de parecer a mais simples.** `archivedAt` existe em exatamente um modelo ([schema.prisma:160](../../apps/api/prisma/schema.prisma)), e o filtro vive num único `where` de repositório (`includeArchived ? {} : { archivedAt: null }`). Replicar isso em `Deal`, `Project`, `Task` e `Contact` significa revisar **todas** as leituras desses modelos: listagens paginadas, os dois quadros Kanban (`/deals/board`, `/tasks/board`), o "Minhas demandas", o `_count.tasks` do projeto, as agregações do dashboard e as travas de exclusão que hoje contam filhos (`409` de projeto com tarefas, de estágio com deals). Some-se que hoje **não há como excluir uma oportunidade ou uma tarefa pela interface** — `useDeleteDeal` e `useDeleteTask` existem no data layer sem nenhum consumidor `.tsx` —, então a ação de arquivar nesses dois nasce do zero na UI. E o expurgo definitivo esbarra em FKs `ON DELETE RESTRICT` em toda a cadeia de negócio: a ordem de remoção é regra, não detalhe.

**As três frentes convergem em dois pontos de plataforma.** Primeiro, **permissões novas**: `auditoria:ver` e a chave de expurgo caem na categoria `Organização` do catálogo ([shared/permissions.ts](../../apps/api/src/shared/permissions.ts), 17 chaves hoje), e o projeto já tem o padrão obrigatório de migration que concede chave nova a papéis **customizados** já existentes — sem ela, só o owner e o papel `system` enxergam a novidade ([20260727100000_assignee_per_record/migration.sql:38-60](../../apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql)). Segundo, **RLS**: `AuditLog` é o caso típico do template `owner_isolation` (coluna `ownerId TEXT NOT NULL` denormalizada + policy `FOR ALL` com `USING`/`WITH CHECK` idênticos); `Session` é o caso atípico, que provavelmente fica fora dele.

**Nada disso existe hoje, nem parcialmente.** O grep por `auditlog|auditoria|audit|lixeira|expurgo|Session` em `*.ts`, `*.prisma`, `*.sql` retorna apenas as menções em `ROADMAP.md` e `SPEC.md:57`. O que mais se aproxima de trilha é o log estruturado no Loki (`papel.criado`, `colaborador.desativado`, …), que **não substitui** a auditoria: retenção de 30 dias, Grafana publicado na internet, sem visão por registro e sem nenhum evento para mudança em `Payment`, `Contract` ou `Proposal`.

## Codebase Map

### Affected Files & Modules

#### Frente A — Sessões

| File | Role | Relevance |
|---|---|---|
| `apps/api/prisma/schema.prisma:13-47` | Model `User` | `refreshTokenHash String?` (`:18`) é o campo a substituir; `User` está **fora do RLS** |
| `apps/api/src/modules/auth/auth.service.ts:264-284` | `issueTokens(sub)` | Assina os dois JWTs com payload `{ sub }` e grava o hash único |
| `apps/api/src/modules/auth/auth.service.ts:207-225` | `refresh(userId, token)` | `argon2.verify` contra o hash único + `assertActive` + rotação |
| `apps/api/src/modules/auth/auth.service.ts:260-262` | `logout(userId)` | Zera o hash — vira "revogar a sessão corrente" |
| `apps/api/src/modules/auth/auth.service.ts:163-191` | `resetPassword` | `:190` zera o hash — vira "revogar todas" |
| `apps/api/src/modules/auth/auth.controller.ts:105-146` | `POST /auth/refresh`, `POST /auth/logout` | Lê o cookie, verifica o JWT, seta/limpa cookie |
| `apps/api/src/modules/auth/refresh-cookie.ts:5-27` | `REFRESH_COOKIE`, `setRefreshCookie` | Ponto único do cookie (nome, path, `maxAge` 7d fixo) |
| `apps/api/src/modules/users/users.service.ts:140-148` | `findById`, `setRefreshTokenHash` | Única porta de escrita do hash hoje |
| `apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts:97-102` | `revokeSession(id, ownerId)` | Segunda porta (escreve `refreshTokenHash: null` direto) |
| `apps/api/src/modules/collaborators/application/collaborators.service.ts:141-143` | Desativação | Revoga ao desativar — passa a revogar **todas** |
| `apps/api/src/modules/collaborators/api/invites.controller.ts:51-60` | Aceite de convite | Emite sessão via `AuthService.issueSession` |
| `apps/api/src/shared/logging/request-context.middleware.ts:78-79` | Log de acesso | **Único** ponto do backend que lê `req.ip` e `user-agent` |
| `apps/api/src/main.ts:51-59` | `trust proxy` | `TRUST_PROXY_HOPS` (Traefik, 1 salto) — é o que faz `req.ip` ser o IP real |
| `apps/api/src/modules/auth/auth.service.spec.ts:175-216` | Suíte `refresh` | Testes que mudam junto |
| `apps/web/src/features/perfil/PerfilDialog.tsx` | Diálogo de perfil | Onde entra "Sessões ativas" (hoje: um único `<form>`) |
| `apps/web/src/features/perfil/api/perfil.api.ts:24-28` | `perfilApi` | Só tem `me` e `update` |
| `apps/web/src/lib/api.ts:23-62` | Interceptor 401 | Fila de refresh; 401 no refresh → zera token e vai a `/login` |

#### Frente B — Auditoria

| File | Role | Relevance |
|---|---|---|
| `apps/api/src/prisma/owner-context.interceptor.ts:30-52` | Transação por request | Faz a gravação da trilha ser atômica de graça |
| `apps/api/src/prisma/prisma.service.ts:39-41` | Getter `db` | `cls.get(PRISMA_TX) ?? this` |
| `apps/api/src/modules/access/domain/access-context.ts:13-21` | `AccessContext` | `userId`, `ownerId`, `isOwner`, `roleId`, `roleName`, `permissions` |
| `apps/api/src/app.module.ts:43-51` | `ClsModule.forRoot` | CLS global já montado; `idGenerator` usa `x-request-id` |
| `apps/api/src/modules/finance/application/payments.service.ts:80-137` | `update`/`pay`/`revert`/`cancel` | Alvos primários da trilha (dinheiro) |
| `apps/api/src/modules/finance/application/contracts.service.ts:61-176` | `create`/`update`/`pause`/`resume`/`cancel` | `cancel` cancela N cobranças num `updateMany` |
| `apps/api/src/modules/proposals/application/proposals.service.ts:65-220` | `send`/`accept`/`reject`/`new-version`/`delete` | `accept` dispara efeito cruzado em `Deal` e `Project` |
| `apps/api/src/modules/collaborators/application/collaborators.service.ts:51-161` | Convite, papel, ativar/desativar | Já emite log estruturado; falta trilha persistida |
| `apps/api/src/modules/collaborators/application/roles.service.ts:44-134` | CRUD de papéis | `papel.atualizado` hoje só loga a **contagem**, não o diff |
| `apps/api/src/modules/finance/application/finance-billing.job.ts:22-44` | Cron 3h | Cross-owner, sem ator, `updateMany` sem ids |
| `apps/api/src/modules/proposals/application/proposals-expiration.job.ts:16-24` | Cron 3h | Idem |
| `apps/api/src/modules/billing/infra/prisma-subscription.repository.ts` | Webhook Stripe | Rota pública, client admin, sem ator |
| `apps/api/src/shared/logging/log.ts:28-29` | `CHAVE_SENSIVEL` | Regex de redação — vale para log, **não** para o `diff` persistido |
| `apps/api/prisma/schema.prisma:322` | `Task.checklist Json?` | Único precedente de coluna `Json` no schema |
| `apps/web/src/app/nav.ts:56-62` | Grupo "Organização" | Onde entra o item "Auditoria" |
| `apps/web/src/routes/router.tsx:119-128` | Rotas gated | Molde exato de rota nova com `PermissionRoute` |

#### Frente C — Lixeira

| File | Role | Relevance |
|---|---|---|
| `apps/api/prisma/schema.prisma:159-160,175-177` | `Client.archivedAt` + índices | Único soft delete existente; `@@index([ownerId, archivedAt])` |
| `apps/api/src/modules/clients/infra/prisma-client.repository.ts:41,82-84` | Filtro e `archive` | `...(filter.includeArchived ? {} : { archivedAt: null })` |
| `apps/api/src/modules/clients/api/clients.controller.ts:86` | `POST /clients/:id/archive` | Molde da rota (sem rota de restaurar hoje) |
| `apps/api/src/modules/pipeline/application/deals.service.ts:146` | `delete` | Hard delete, **sem** trava |
| `apps/api/src/modules/projects/application/tasks.service.ts:134` | `delete` | Hard delete, sem trava |
| `apps/api/src/modules/projects/application/projects.service.ts:89-95` | `delete` | `409` se tiver tarefas |
| `apps/api/src/modules/contacts/application/contacts.service.ts:55` | `delete` | Hard delete |
| `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts` | Board + listagem | Todo `where` precisa excluir arquivados |
| `apps/api/src/modules/projects/infra/prisma-task.repository.ts` | Board, "minhas demandas", `_count` | Idem |
| `apps/api/src/modules/dashboard/application/dashboard.service.ts` | Agregações | Funil, demandas atrasadas, próximas entregas contam `Deal`/`Task` |
| `apps/api/src/shared/record-scope.ts:30-62` | `assigneeScopeWhere` | O `where` da lixeira compõe com este (AND, não spread) |
| `apps/web/src/features/pipeline/api/hooks.ts:56-62` | `useDeleteDeal` | Existe e **não tem consumidor** |
| `apps/web/src/features/demandas/api/hooks.ts:101-107` | `useDeleteTask` | Existe e **não tem consumidor** |
| `apps/web/src/features/clientes/ClienteDetalheLayout.tsx:181-219` | Botão + confirmação de arquivar | Único fluxo de arquivamento na UI hoje |
| `apps/web/src/features/clientes/api/types.ts:32,80-87` | `Client.archivedAt`, `ListClientsParams` | O campo existe no tipo e **nunca é lido**; não há `includeArchived` |

### Existing Patterns to Follow

**Padrão 1 — Tabela nova com RLS (`owner_isolation`)**

```sql
-- molde canônico, de 20260724050000_enable_rls/migration.sql
ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "X" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "X"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "X" TO crm_app;
```

Invariantes documentadas no cabeçalho daquela migration (`:1-13`): `ownerId` é `TEXT`, **sem cast** `::uuid`; `current_setting(…, true)` é `missing_ok` → contexto ausente casa **zero linhas** (fail-closed); `USING` e `WITH CHECK` idênticos; `FORCE` sujeita o dono da tabela, e `crm_user` continua bypassando por ser superuser (é o que mantém migrations, seed e crons).

**Por que importa**: `AuditLog` cai direto nesse molde. E o padrão do projeto é **denormalizar `ownerId`** em toda tabela filha para que a policy seja um predicado plano e indexado (`20260724025450_denormalize_owner_id`) — nenhuma policy do repo usa join ou subquery. `ownerId` nas tabelas de dados **não tem FK** para `User`, por convenção.

**Padrão 2 — Coluna nova em tabela com dados (nullable → backfill → NOT NULL → índice)**

```sql
-- 1. AddColumn (nullable primeiro)
ALTER TABLE "Deal" ADD COLUMN "ownerId" TEXT;
-- 2. Backfill via join
UPDATE "Deal" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
-- 3. NOT NULL
ALTER TABLE "Deal" ALTER COLUMN "ownerId" SET NOT NULL;
-- 4. CreateIndex
CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");
```

**Por que importa**: `archivedAt` é nullable, então a Frente C não precisa de backfill — mas precisa do **índice composto** no molde do `Client`: `@@index([ownerId, archivedAt])` ([schema.prisma:176](../../apps/api/prisma/schema.prisma)). As migrations do projeto são **SQL escrito à mão**, com comentários em pt-BR explicando as decisões, e nome `AAAAMMDDHHMMSS_descricao_em_ingles`.

**Padrão 3 — Permissão nova exige migration para papéis customizados**

```sql
-- 20260727100000_assignee_per_record/migration.sql:38-60
-- O papel `system` ("Administrador") e o owner valem ALL_PERMISSION_KEYS, resolvido
-- em tempo de execução no AccessService — as chaves novas já entram lá de graça.
-- Papéis CUSTOMIZADOS não: sem esta migration, o "Comercial" (e qualquer papel real
-- em produção) passaria a perder de vista os registros conforme fossem atribuídos.
UPDATE "Role" SET "permissions" = array_append("permissions", 'cliente:ver_todos')
 WHERE "system" = false
   AND NOT ('cliente:ver_todos' = ANY("permissions"))
   AND ("permissions" && ARRAY['cliente:ver','cliente:gerenciar']);
```

**Por que importa**: a Fase 8 cria pelo menos duas chaves (`auditoria:ver`, expurgo). Sem esta migration, papel customizado não recebe nada. O catálogo em `shared/permissions.ts` é fonte única; `GET /permissions` serve os rótulos e o front **nunca** os duplica.

**Padrão 4 — Uma transação por requisição, com `app.owner_id` e `tx` no CLS**

```ts
// apps/api/src/prisma/owner-context.interceptor.ts:44-50
return from(
  this.prisma.$transaction(async (tx) => {
    // set_config seguro: valor via bound param (nunca concatenar/interpolar).
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, true)`;
    this.cls.set(PRISMA_TX, tx);
    const result: unknown = await lastValueFrom(next.handle());
    return result;
  }),
);
```

**Por que importa**: qualquer escrita por `prisma.db` dentro de um handler HTTP **já está** na mesma transação — o registro de auditoria commita com a mudança de negócio ou não commita nenhum dos dois, sem `$transaction` extra. Também é por aqui que se conclui o oposto: crons, webhooks e rotas públicas **não** têm essa transação (nem CLS).

**Padrão 5 — `PrismaAdminService` para o que roda sem contexto de owner**

```ts
/**
 * Client privilegiado, conectado como crm_user (superuser → bypassa RLS).
 * Uso restrito a operações sem contexto de owner: crons cross-owner e seed.
 * Não expõe `.db`/CLS — nunca deve ser usado no caminho de requisição HTTP.
 */
```

Usuários atuais: `AccessService.resolve` (roda em guard, antes do interceptor), gate/webhook de billing, os dois crons, cadastro de conta e o módulo de colaboradores (`User` não tem RLS, então filtra `ownerId` explicitamente).

**Por que importa**: login e refresh são rotas públicas — a tabela `Session` será escrita por este caminho, com filtro explícito, exatamente como o repositório de colaboradores faz com `User`.

**Padrão 6 — Soft delete e sua leitura**

```ts
// apps/api/src/modules/clients/infra/prisma-client.repository.ts:41
...(filter.includeArchived ? {} : { archivedAt: null }),

// apps/api/src/modules/clients/infra/prisma-client.repository.ts:82-84
archive(id: string, ownerId: string) {
  return this.update(id, ownerId, { archivedAt: new Date() });
}
```

E a regra de composição de `where` herdada da Fase 7B ([plano 7B:688](../plans/2026-07-26-fase-7b-responsavel-por-registro.md)): *"AND (não spread): o `OR` da busca acima seria sobrescrito por um segundo `OR`."*

**Por que importa**: é o molde literal para os quatro modelos novos, incluindo o cuidado de compor com o `assigneeScopeWhere` da Fase 7.

**Padrão 7 — Log estruturado com `evento`**

```ts
this.logger.log({ evento: 'papel.atualizado', msg: 'Papel atualizado.', papelId: id, permissoes: n });
```

`evento` em `substantivo.acao_no_passado`, pt-BR, nome estável (renomear quebra a contagem histórica no Grafana). Nunca logar segredo — o `msg` **não** é redigido, só chaves que batem em `/senha|password|secret|token|authorization|cookie|api[-_]?key|credential|passwordhash/i` ([log.ts:28-29](../../apps/api/src/shared/logging/log.ts)).

**Por que importa**: a Fase 8 acrescenta eventos (`sessao.revogada`, `lixeira.*`, …) ao catálogo de `docs/observabilidade.md:57-68`, e a trilha persistida convive com o log — não o substitui.

**Padrão 8 — Listagem paginada no web**

```tsx
// filtros da listagem persistidos na URL — objeto estável, fora do componente
const CLIENTES_FILTERS = { search: stringFilter(), status: enumFilter(...), page: numberFilter(1) };
const { values, set } = useUrlFilters(CLIENTES_FILTERS);

const debounced = useDebouncedValue(search, 300);
useEffect(() => { if (debounced !== values.search) set({ search: debounced, page: 1 }); }, [debounced]);

<TableBody>
  {isError ? <TableEmpty colSpan={5}>Falha ao carregar …</TableEmpty>
   : isLoading ? /* 5 linhas de <Skeleton className="h-5 w-full" /> */
   : data && data.data.length > 0 ? data.data.map(...)
   : <TableEmpty colSpan={5}>Nenhum … encontrado.</TableEmpty>}
</TableBody>

<Pagination page={page} pageSize={LIMIT} total={data?.meta.total ?? 0}
  onPageChange={(p) => set({ page: p })} labelSingular="registro" labelPlural="registros" />
```

Complementos: `queryKeys` centralizado em `lib/query-keys.ts` (raiz `all` por domínio + `list(params)` + `detail(id)`); toast via `sonner` **no componente**, no `try/catch` do `mutateAsync`, com `extractApiMessage(error, 'Falha ao …')`; `ConfirmDialog` (`title`, `description`, `confirmLabel`, `pendingLabel`, `destructive`, `pending`) para tudo que destrói.

**Por que importa**: a tela de Auditoria e a Lixeira são listagens; seguir esse molde é o caminho mais curto e o único aceito pelo `apps/web/CLAUDE.md`.

**Padrão 9 — Rota e navegação gated**

```tsx
// routes/router.tsx:124-128
{ element: <PermissionRoute permission={['papel:gerenciar']} />,
  children: [{ path: '/papeis', element: <PapeisPage /> }] },

// app/nav.ts:56-62
{ label: "Organização", items: [
  { to: "/papeis", label: "Papéis", icon: ShieldCheck, permission: ["papel:gerenciar"] },
]},
```

`AppLayout` filtra itens por `canAny(item.permission ?? [])` e descarta grupo vazio. `PermissionRoute` não redireciona enquanto `loading`.

### Data Flow

**Refresh — hoje**

```
POST /api/v1/auth/refresh  (@Public, fora da transação de RLS)
  cookie refresh_token → jwt.verify(JWT_REFRESH_SECRET) → { sub }
  users.findById(sub)                      ← Prisma admin/base, User sem RLS
  argon2.verify(user.refreshTokenHash, token)   ← 1 hash, 1 sessão
  assertActive(user.active)
  issueTokens(sub): novo access + novo refresh → setRefreshTokenHash(sub, hash(novo))
  Set-Cookie refresh_token (path /api/v1/auth, 7d)
```

**Refresh — depois (forma esperada)**

```
POST /api/v1/auth/refresh
  cookie → jwt.verify → { sub, sid }
  session = sessions.findById(sid)          ← busca indexada, 1 linha
  valida: existe, pertence a sub, revokedAt null, expiresAt > agora
  argon2.verify(session.tokenHash, token)   ← 1 verificação, independente de N
  rotação: novo tokenHash + lastUsedAt/ip/ua na MESMA sessão (sid estável)
```

**Baixa de cobrança — hoje**

```
POST /payments/:id/pay
  ThrottlerGuard → JwtAuthGuard (req.user={sub}) → AccessGuard (req.access) → BillingGuard
  OwnerContextInterceptor: BEGIN; set_config('app.owner_id', access.ownerId, true); cls.set(PRISMA_TX)
  PaymentsController.pay(@CurrentOwnerId ownerId, id, dto)   ← userId NÃO é passado
  PaymentsService.pay(ownerId, id, dto) → repo.update(...) via prisma.db
  COMMIT
  → nenhum registro de quem deu a baixa; só a linha `http.requisicao` no Loki (30 dias)
```

**Baixa de cobrança — depois (forma esperada)**

```
  … mesma transação …
  PaymentsService.pay(...) → repo.update(...)
                          → audit.registrar({ entidade:'Payment', entidadeId:id,
                                              acao:'PAGAR', antes, depois })
      autor = CLS (access.userId) ou parâmetro explícito  ← decisão em aberto (Q4)
  COMMIT  ← trilha e mudança commitam juntas ou nenhuma das duas
```

**Exclusão de oportunidade — hoje / depois**

```
Hoje:   DELETE /deals/:id → deal.delete()  (hard, sem trava, sem UI)
Depois: POST /deals/:id/archive → archivedAt = now()
        listagens e board passam a filtrar archivedAt: null
        POST /deals/:id/restore → archivedAt = null
        DELETE /deals/:id (expurgo) → hard delete sob permissão própria,
          respeitando FKs RESTRICT dos filhos (Proposal/Activity apontam com SET NULL)
```

## External Research

### Refresh token rotation com tabela de sessões

Consenso das referências públicas (OAuth 2.0 Security BCP / OWASP OAuth2 Cheat Sheet e material derivado):

- Refresh token deve ser **stateful** — armazenado no servidor — justamente para permitir revogação e inspeção de sessões.
- **Rotação a cada uso** já é o comportamento atual do projeto (o `issueTokens` no `refresh` emite um par novo). O que falta é o complemento: **detecção de reuso** — se um refresh token já rotacionado reaparecer, trata-se como possível roubo e a sessão (ou a família de tokens) é revogada. "Rotação sem detecção de reuso traz benefício mínimo" é a formulação recorrente.
- Vincular cada refresh a um **`sid`** (id de sessão) no payload e rotacionar a cada uso é o padrão descrito para tabelas de sessão.

**Consequência 1**: sem `sid` no payload, validar N sessões exige N `argon2.verify` por refresh — argon2 é deliberadamente caro. Com `sid`, é 1 busca indexada + 1 verify, independente do número de sessões.

**Consequência 2**: detecção de reuso é *opcional* para o escopo do ROADMAP (que pede sessões múltiplas, não hardening), mas o modelo de dados precisa nascer compatível (a sessão guarda o hash do token **vigente**; um token antigo apresentado depois da rotação falha o `verify` — hoje isso já acontece e é silenciosamente tratado como 401, sem revogar a sessão).

Sources: [OAuth2 — OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) · [The Developer's Guide to Refresh Token Rotation (Descope)](https://www.descope.com/blog/post/refresh-token-rotation) · [Refresh Token Security: Best Practices (Obsidian)](https://www.obsidiansecurity.com/blog/refresh-token-security-best-practices)

### Parsing de User-Agent — restrição de licença

O CRM é distribuído sob **Apache License 2.0** (`LICENSE`, `NOTICE`). Isso elimina a biblioteca mais óbvia:

- `ua-parser-js` **v2** adotou dual-license **AGPLv3 / PRO comercial**. A AGPL exige que derivados sejam liberados sob a mesma licença e que o código seja disponibilizado a quem interage com o software **pela rede** — incompatível com o modelo do projeto (SaaS em `crm.programeai.com.br` + código Apache-2.0).
- As versões **v0.7.x / v1.0.x continuam MIT** e não serão relicenciadas, mas ficam sem evolução.
- Alternativas MIT citadas: `bowser`, `detect-browser`, `express-useragent`, e o fork MIT `my-ua-parser`.

**Consequência 3**: se a Frente A quiser "Chrome no Windows" em vez da string crua, ou entra uma dependência MIT nova (hoje `apps/api` **não tem nenhuma** lib de UA), ou o rótulo é derivado por uma heurística curta escrita no próprio repo. O `apps/api/package.json` tem 21 dependências de produção e o padrão dos planos anteriores é "**Nenhuma dependência nova**" — introduzir uma é decisão a declarar.

Sources: [ua-parser-js Drops MIT License, Adopts AGPLv3 (Socket)](https://socket.dev/blog/ua-parser-js-drops-mit-license) · [User agent detection and the ua-parser-js license change (LogRocket)](https://blog.logrocket.com/user-agent-detection-ua-parser-js-license-change/) · [Issue #680 — faisalman/ua-parser-js](https://github.com/faisalman/ua-parser-js/issues/680)

### Libraries & Dependencies

**Nenhuma dependência nova é obrigatória.** Detalhes:

- **Hash de token**: `argon2@^0.45.0` já está no projeto (senha e refresh). O token de reset usa `sha256` de `node:crypto` porque precisa de **busca indexada** ([auth.service.ts:194-196](../../apps/api/src/modules/auth/auth.service.ts)) — os dois padrões existem e são precedente.
- **Geração de id/token**: `randomUUID`/`randomBytes` de `node:crypto` (o projeto não tem `uuid`).
- **Coluna `Json`**: suportada pelo Prisma 6.19.3 e já usada uma vez (`Task.checklist Json?`, `schema.prisma:322`) — não exige nada novo para o `diff` do `AuditLog`.
- **IP do cliente**: já resolvido por `trust proxy` + `TRUST_PROXY_HOPS` ([main.ts:51-59](../../apps/api/src/main.ts)); `req.ip` é o IP real atrás do Traefik.
- **UA**: ver Consequência 3.
- **Frontend**: nenhuma lib de data (não há `date-fns`/`dayjs`); `formatDate`/`formatDateTime` usam `Intl` ([lib/format.ts:69-82](../../apps/web/src/lib/format.ts)). **Não existe helper de tempo relativo** ("há 5 minutos") — se a lista de sessões quiser isso, é código novo em `lib/`.

## Historical Context

**`specs/plans/2026-07-25-colaboradores-e-papeis.md`** (implemented) — é a origem de quase tudo que a Fase 8 encosta:
- `:67` — *"**Sem RLS na tabela `User`.** Mantém-se a decisão vigente (login por e-mail); o isolamento de colaboradores é feito por filtro explícito `ownerId` no repositório."*
- `:68` — *"**Sem exclusão de colaborador.** Segue o painel de origem: desativa/reativa."* (precedente de "desativar em vez de excluir", que a lixeira generaliza)
- `:333` — *"ao desativar, **revoga o refresh token do colaborador**"* — vira "revoga todas as sessões".
- `:343` — a extração de `setRefreshCookie` foi feita justamente para haver *"um único lugar definindo `httpOnly`/`sameSite`/`path`/`maxAge`"*.
- `:348-349` — catálogo de eventos de log criado nessa fase (`colaborador.*`, `papel.*`, `acesso.negado`), com a regra *"Sem segredo: **nunca** logar token nem link do convite"*.
- `:474` — justificativa do custo por request do `AccessGuard`: *"permite que troca de papel e desativação valham **na hora**, sem esperar o token expirar. Sem cache nesta fase."*

**`specs/research/2026-07-23-rls-por-ownerid.md`** + **plano** (implemented):
- `:203` — *"**Conexão → Opção B: cliente único + tabela `User` sem policy.** […] `User` fica **sem policy** (login por email funciona). Migrations, seed e os `@Cron` cross-owner usam a **role privilegiada/dona** via env separada."*
- `:193` — *"**`FORCE RLS` afeta seed e crons**: […] operam **cross-owner** e rodam **sem contexto de owner** → precisam da conexão privilegiada/bypass, senão passam a enxergar zero linhas."* (vale para um eventual cron de expurgo)
- `:194` — *"sob RLS a linha 'não existe' para o dono errado → mantém 404, mas por um caminho diferente."*
- `:72-80` — o inventário de hard deletes (contacts, deals, proposals, projects, tasks) que a Frente C reverte.

**`specs/plans/2026-07-21-fase-2-pipeline.md:61-62`** — a decisão que a Fase 8 **reverte explicitamente**: *"**Soft delete de deal** — `DELETE /deals/:id` é hard delete; FKs `SET NULL` já preservam `Proposal`/`Activity` vinculados."* Idem `specs/research/2026-07-21-fase-2-pipeline.md:325-327`.

**`specs/plans/2026-07-21-fase-1-clientes.md:45`** — *"**Exclusão física de cliente** — apenas arquivamento (soft delete via `archivedAt`)."* — e `specs/research/2026-07-21-fase-1-clientes.md:140` observa que todas as FKs de filhos para `Client` são `ON DELETE RESTRICT`.

**`specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md`** (implemented) — precedentes de processo e de dados:
- `:77` — *"**Reatribuição automática ao desativar colaborador** — decisão 5 registrada na Frente A: o registro mantém o nome de quem foi desativado, sem zerar histórico."* — mesma filosofia que a auditoria formaliza.
- `:186-211` — a migration de backfill de permissões em papéis customizados (Padrão 3).
- `:627`, `:876` — *"escopo por registro não governa escrita nesta fase"* — a auditoria herda: quem pode escrever é decidido por `:gerenciar`, e é isso que a trilha registra.
- `apps/api/src/shared/record-scope.ts` e `apps/web/src/lib/members-lookup.ts` já existem — uma tela que mostre "quem fez" tem o lookup de membros pronto (inclusive de colaborador desativado).

**`SPEC.md`**:
- `:57` — a Fase 8 já está nomeada no backlog: *"sessões múltiplas, trilha de auditoria e lixeira"*.
- `:85` — *"Cliente não pode ser excluído se tiver proposta ou projeto vinculado → usar arquivamento (soft delete)."*
- `:188` — *"Cobrança paga não pode ser excluída — apenas estornada (volta a `pendente`, com registro em observação)."* — hoje esse "registro em observação" é um append em `notes` (`payments.service.ts:121-128`), sem autor.
- `:204-402` — a seção "Modelo de Dados" **está defasada**: transcreve `User` ainda com `refreshTokenHash` e sem `ownerId`, e não tem `Role`/`Subscription`/`OAuthAccount`. Atualizar ou marcar a defasagem é decisão da fase.

**Commits recentes** (`git log --oneline -20`): a Fase 7 fechou em `3542168`. Em `apps/api/src/modules/auth` + `collaborators` há 11 commits no total, e **nenhum** toca sessões múltiplas, auditoria ou lixeira — a Fase 8 é território virgem no código.

## Constraints & Considerations

- **`Session` nasce fora do contexto de RLS.** Login, refresh e aceite de convite são `@Public()`, passam **fora** da transação do `OwnerContextInterceptor` e não têm `app.owner_id`. Uma policy `owner_isolation` em `Session` fecharia a escrita no login (fail-closed = zero linhas). O grupo natural é o de `User`/`OAuthAccount`/`PasswordResetToken`: **sem RLS**, com filtro explícito por `userId` no repositório — exatamente como o módulo de colaboradores já faz com `User`.

- **O autor não existe na camada `application`.** 100% dos services sensíveis recebem `ownerId`; nenhum recebe `userId` (exceção: `CollaboratorsService.update`). Não há nenhum campo `*By` no schema. Sem resolver isso, não há auditoria.

- **A transação por request é uma vantagem e uma armadilha.** Vantagem: a trilha commita junto com a mudança. Armadilha: se o handler lançar, **o registro de auditoria some junto** — o que é correto para "mudança aplicada", mas significa que *tentativas negadas* (403, 422) não ficam na trilha por esse caminho (ficam só no log de acesso do Loki).

- **Três classes de escrita não têm ator humano**: os crons (`FinanceBillingJob`, `ProposalsExpirationJob`, 3h, cross-owner, via admin), o webhook do Stripe (rota pública, admin) e o aceite de convite (público, o próprio convidado, identificado só pelo token). Os crons usam `updateMany` e **só conhecem o `count`** — não sabem quais linhas mudaram.

- **`crm_user` precisa continuar superuser.** Declarado como risco em `specs/plans/2026-07-23-rls-por-ownerid.md:403`. Vale para qualquer job de expurgo cross-owner.

- **Expurgo esbarra em `ON DELETE RESTRICT`.** As FKs de negócio não têm cascade; as remoções em cascata são feitas à mão nos repositórios (ex.: proposta apaga itens e depois a proposta). Um expurgo de `Deal`/`Project`/`Contact` precisa da ordem correta ou responde 500 de FK.

- **Soft delete muda toda leitura, não só a listagem.** Para `Deal` e `Task` isso inclui os dois quadros Kanban, o "Minhas demandas", o `_count.tasks` do projeto, as agregações do dashboard (funil, atrasadas, próximas entregas) e as travas de exclusão que contam filhos (`409` de projeto com tarefas, `409` de estágio com deals). Um estágio "sem oportunidades" porque todas estão arquivadas é uma pergunta de produto, não de código.

- **`Contact` não tem `createdAt` nem `updatedAt`** ([schema.prisma:180-192](../../apps/api/prisma/schema.prisma)). Uma lixeira ordenada por "arquivado em" funciona; por "criado em", não.

- **O front não expõe exclusão de `Deal` nem de `Task`.** Os hooks existem sem consumidor — a ação de arquivar nesses dois é UI nova, não substituição de botão.

- **`archivedAt` já está no tipo `Client` do front e nunca é lido**; `ListClientsParams` não tem `includeArchived`. A lixeira de cliente é, na prática, tão nova quanto as outras.

- **Permissão nova só chega a papel customizado por migration** (Padrão 3). Owner e papel `system` resolvem `ALL_PERMISSION_KEYS` em runtime.

- **`PATCH /auth/me` devolve o usuário sem `isOwner`/`role`/`permissions`, e `useUpdateProfile` faz `setQueryData(queryKeys.auth.me, data)`** — o cache de `me` fica temporariamente sem `permissions`, o que `useCan` lê como "não pode nada" até o próximo refetch. Divergência existente que a tela de sessões no perfil vai encostar.

- **Modal sobre modal é proibido** (`apps/web/CLAUDE.md:94-97`). Uma confirmação de "revogar sessão" dentro do `PerfilDialog` precisa usar `ConfirmDialog`/`AlertDialog`, que já participam da pilha `modal-stack`.

- **Definition of Done do projeto** (`.github/PULL_REQUEST_TEMPLATE.md`): tudo em pt-BR; enum novo traduzido em `apps/web/src/lib/labels.ts` no mesmo PR; `ENDPOINTS.md` atualizado no mesmo commit, com os rótulos fixos **Propósito / Auth / Body / Resposta / Erros / Handler**; log novo com `evento` e sem segredo; `pnpm --filter api test` e `pnpm --filter api build` passando; mudança de modelo começando no `schema.prisma` com migration.

- **Testes**: o padrão é teste unitário de service por **instanciação direta** (`new Service(mockRepo)`), com `jest.Mocked<Repository>` — não há `Test.createTestingModule` em nenhum lugar do repo, não há teste de controller nem e2e, e o **frontend não tem suíte** (o portão dele é o `tsc -b`). Guards e interceptors têm teste (`access.guard.spec.ts`, `owner-context.interceptor.spec.ts`) — um `AuditService` transversal cai nessa categoria.

- **Crescimento do `AuditLog`**: nenhuma tabela do projeto tem hoje política de retenção ou partição. Um log de mudanças cresce de forma monotônica.

## Open Questions

**1. `Session` entra no RLS?**
(a) **Recomendada** — fica **fora**, como `User`/`OAuthAccount`/`PasswordResetToken`, com `userId` + filtro explícito no repositório e escrita via `PrismaAdminService`. Motivo: a linha é criada no login, onde não existe `app.owner_id`.
(b) Entra no RLS com `ownerId` denormalizado — exige que o login descubra o `ownerId` antes de gravar e que a escrita use o client admin mesmo assim (a policy não ajudaria em nada no caminho público).
Sub-pergunta: se ficar fora, o `ownerId` ainda deve existir na linha (para o owner futuramente ver sessões de colaboradores) ou a sessão é estritamente pessoal?

**2. O refresh JWT passa a carregar `sid`?**
(a) **Recomendada** — sim: `{ sub, sid }`. Validação vira busca indexada + 1 `argon2.verify`.
(b) Não: o servidor tenta `verify` contra todas as sessões ativas do usuário — O(N) em argon2 por refresh.
Sub-pergunta: o hash guardado é argon2 (padrão de senha/refresh do projeto) ou sha256 (padrão dos tokens de busca, como reset e convite)? Com `sid` no payload, argon2 custa 1 verificação e não precisa ser indexável.

**3. Quanto de "device" a sessão registra?**
(a) **Recomendada** — `userAgent` cru + `ip`, e o rótulo amigável ("Chrome no Windows") derivado por heurística curta no repo; zero dependência nova.
(b) `bowser` ou outra lib MIT (dependência nova em `apps/api`).
(c) Só a string crua na UI.
Ver Consequência 3 (ua-parser-js v2 é AGPL e está descartada).

**4. Como o autor chega à camada `application` para a auditoria?**
(a) **Recomendada** — pelo **CLS**, que já é global, já carrega `PRISMA_TX` e `requestId`: um `AuditService` lê o `AccessContext` publicado pelo `AccessGuard`. Zero mudança de assinatura em ~15 métodos.
(b) Parâmetro explícito em toda assinatura sensível (mais rastreável, muito mais invasivo, muda todos os specs existentes).
(c) Interceptor genérico que registra por rota — descartado: não conhece o "antes" nem o diff.
Sub-pergunta: se for (a), o `AccessContext` passa a ser gravado no CLS pelo `AccessGuard` (que hoje só escreve em `req.access`)?

**5. O que exatamente é o `diff`?**
(a) `Json` com `{ antes, depois }` só dos campos alterados.
(b) Só a lista de campos alterados, sem valores.
(c) Snapshot completo do registro depois da mudança.
Sub-perguntas: a redação de segredo do log (`CHAVE_SENSIVEL`) **não** vale para uma coluna `Json` persistida — quais campos ficam de fora por regra (`passwordHash`, `tokenHash`, `document`?)? E o `diff` de uma ação em massa (o `cancel` de contrato cancela N cobranças; o cron marca N vencidas) vira 1 registro agregado ou N registros?

**6. Ações sem ator humano entram na trilha?**
(a) **Recomendada** — sim, com `actorId = null` e um discriminador (`SISTEMA`/`CRON`/`WEBHOOK`), porque "por que esta cobrança virou OVERDUE" é justamente o tipo de pergunta que a trilha responde.
(b) Não: a trilha é só de ação humana; crons continuam apenas no log estruturado.
Se (a): os crons rodam via admin, cross-owner e sem CLS — a gravação precisa do `ownerId` da linha afetada, o que hoje eles não coletam (usam `updateMany`).

**7. A trilha é imutável no banco?**
(a) **Recomendada** — `GRANT SELECT, INSERT` apenas para `crm_app` em `AuditLog` (sem `UPDATE`/`DELETE`), além da policy de RLS. Uma trilha que o próprio app pode reescrever tem valor limitado.
(b) Grants padrão como as demais tabelas.
Nota: o `ALTER DEFAULT PRIVILEGES` de `20260724040000_create_app_role` concede os quatro verbos por padrão — restringir exige `REVOKE` explícito na migration.

**8. Formato da lixeira na interface.**
(a) **Recomendada** — uma página `/lixeira` única, com filtro por tipo de registro (menos superfície, um só lugar para procurar).
(b) Uma aba/filtro "Arquivados" em cada listagem (mais contextual, cinco implementações).
Sub-perguntas: arquivar em cascata (arquivar projeto arquiva as tarefas dele)? Cliente arquivado hoje deixa deals/projetos ativos órfãos na tela — isso muda? O expurgo é só manual nesta fase, ou entra um cron de expurgo após N dias?

**9. Chaves de permissão novas.**
Proposta: `auditoria:ver` e `lixeira:gerenciar` (ver arquivados + restaurar) + `lixeira:expurgar` (destrutivo, separado), todas na categoria `Organização`. Confirmar os nomes, e o critério de backfill para papéis customizados (o precedente concede a chave nova a quem já enxerga o módulo correspondente — aqui não há módulo correspondente óbvio, o que sugere **não** conceder a ninguém automaticamente).

**10. Como partir em planos.**
(a) **Recomendada** — três planos: **8A Sessões** (só `auth`/`users`/perfil), **8B Auditoria**, **8C Lixeira**. As três frentes não compartilham arquivo nenhum, e 8A é a de menor risco e maior efeito imediato.
(b) Dois planos, como sugerido no pedido: 8A Sessões / 8B Auditoria + Lixeira.
Nota de ordem: se a auditoria vier **antes** da lixeira, as ações de arquivar/restaurar/expurgar já nascem auditadas; na ordem inversa, é retrabalho.

## Code References Index

**Banco e migrations**
- `apps/api/prisma/schema.prisma:18` — `User.refreshTokenHash`, o campo a substituir
- `apps/api/prisma/schema.prisma:24` — `User.ownerId` nulo = é owner (predicado canônico)
- `apps/api/prisma/schema.prisma:159-160` — único `archivedAt` do schema (`Client`)
- `apps/api/prisma/schema.prisma:175-177` — índices do `Client`, incluindo `[ownerId, archivedAt]`
- `apps/api/prisma/schema.prisma:180-192` — `Contact` (sem `createdAt`/`updatedAt`)
- `apps/api/prisma/schema.prisma:322` — `Task.checklist Json?`, único precedente de coluna `Json`
- `apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql` — role `crm_app` + `ALTER DEFAULT PRIVILEGES`
- `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:1-13` — invariantes do RLS, template `owner_isolation`
- `apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql` — template de coluna nova em tabela com dados
- `apps/api/prisma/migrations/20260726120000_pipeline_stages_per_owner/migration.sql` — tabela existente ganhando `ownerId` + RLS, com guard de integridade
- `apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql:38-60` — backfill de permissão em papéis customizados

**Backend — sessões**
- `apps/api/src/modules/auth/auth.service.ts:207-225` — `refresh`
- `apps/api/src/modules/auth/auth.service.ts:260-262` — `logout`
- `apps/api/src/modules/auth/auth.service.ts:264-284` — `issueTokens` (payload `{ sub }`)
- `apps/api/src/modules/auth/auth.service.ts:190` — reset de senha revoga a sessão
- `apps/api/src/modules/auth/auth.controller.ts:105-146` — `refresh` e `logout`
- `apps/api/src/modules/auth/refresh-cookie.ts:5-27` — cookie de refresh (ponto único)
- `apps/api/src/modules/auth/jwt-auth.guard.ts:23-41` — `req.user` = payload decodificado
- `apps/api/src/modules/users/users.service.ts:140-148` — `findById`, `setRefreshTokenHash`
- `apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts:97-102` — `revokeSession`
- `apps/api/src/modules/collaborators/api/invites.controller.ts:51-60` — aceite emite sessão
- `apps/api/src/main.ts:51-59` — `trust proxy` / `TRUST_PROXY_HOPS`
- `apps/api/src/shared/logging/request-context.middleware.ts:62-81` — único ponto que lê `ip` e `ua`

**Backend — auditoria**
- `apps/api/src/prisma/owner-context.interceptor.ts:30-52` — transação por request + `set_config`
- `apps/api/src/prisma/prisma.service.ts:39-41` — getter `db` (CLS)
- `apps/api/src/prisma/prisma-admin.service.ts:11` — client que bypassa RLS
- `apps/api/src/app.module.ts:43-51` — `ClsModule.forRoot` (id = `x-request-id`)
- `apps/api/src/app.module.ts:68-80` — ordem de filtro/guards/interceptor
- `apps/api/src/modules/access/access.guard.ts:41-54` — publica `req.access`
- `apps/api/src/modules/access/domain/access-context.ts:13-27` — `AccessContext`
- `apps/api/src/modules/finance/application/payments.service.ts:80-137` — `update`/`pay`/`revert`/`cancel`
- `apps/api/src/modules/finance/application/contracts.service.ts:61-176` — CRUD e transições de contrato
- `apps/api/src/modules/finance/application/finance-billing.job.ts:22-44` — cron sem ator
- `apps/api/src/modules/proposals/application/proposals.service.ts:159-220` — `delete`, `send`, `accept`, `reject`, `new-version`
- `apps/api/src/modules/proposals/application/proposals-expiration.job.ts:16-24` — cron sem ator
- `apps/api/src/modules/collaborators/application/collaborators.service.ts:121-161` — único service com `requesterId`
- `apps/api/src/modules/collaborators/application/roles.service.ts:44-134` — CRUD de papéis
- `apps/api/src/shared/logging/log.ts:28-29` — regex de redação de segredo
- `apps/api/src/shared/permissions.ts` — catálogo (17 chaves, 6 categorias)

**Backend — lixeira**
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:41,82-84` — filtro e `archive`
- `apps/api/src/modules/clients/api/clients.controller.ts:86` — `POST /clients/:id/archive`
- `apps/api/src/modules/pipeline/application/deals.service.ts:146` — hard delete de deal
- `apps/api/src/modules/projects/application/tasks.service.ts:134` — hard delete de tarefa
- `apps/api/src/modules/projects/application/projects.service.ts:89-95` — hard delete de projeto (`409` com tarefas)
- `apps/api/src/modules/contacts/application/contacts.service.ts:55` — hard delete de contato
- `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts:101-107` — `409` de estágio com deals
- `apps/api/src/shared/record-scope.ts:30-62` — `resolveAssigneeScope`, `assigneeScopeWhere`

**Frontend**
- `apps/web/src/features/perfil/PerfilDialog.tsx` — diálogo de perfil (um `<form>`, sem abas)
- `apps/web/src/features/perfil/api/perfil.api.ts:3-28` — tipo `Me` e `perfilApi`
- `apps/web/src/hooks/use-can.ts:13-32` — `can`/`canAny`/`isOwner`
- `apps/web/src/hooks/use-url-filters.ts:17-92` — codecs e `useUrlFilters`
- `apps/web/src/hooks/use-debounced-value.ts` — debounce 300ms
- `apps/web/src/lib/query-keys.ts` — chaves centralizadas (sem `audit`/`sessions`/`trash`)
- `apps/web/src/lib/format.ts:69-93` — `formatDate`, `formatDateTime`, `formatMoney`
- `apps/web/src/lib/labels.ts:9-12` — fábrica `make()` dos tradutores de enum
- `apps/web/src/components/ui/confirm-dialog.tsx:13-52` — `ConfirmDialog`
- `apps/web/src/components/ui/pagination.tsx:4-71` — `Pagination`
- `apps/web/src/components/ui/table.tsx:94` — `TableEmpty`
- `apps/web/src/features/clientes/ClientesListPage.tsx:64-70,131-137,198-294` — listagem canônica
- `apps/web/src/features/clientes/ClienteDetalheLayout.tsx:101-111,181-219` — arquivar cliente
- `apps/web/src/features/pipeline/api/hooks.ts:56-62` — `useDeleteDeal` (sem consumidor)
- `apps/web/src/features/demandas/api/hooks.ts:101-107` — `useDeleteTask` (sem consumidor)
- `apps/web/src/routes/router.tsx:119-128` — molde de rota gated
- `apps/web/src/app/nav.ts:56-62` — grupo "Organização"
- `apps/web/src/app/AppLayout.tsx:64-71,175-178,224` — filtro de nav, item "Perfil", `PerfilDialog`

**Docs e specs**
- `ROADMAP.md:235-255` — escopo declarado da Fase 8
- `SPEC.md:57` — Fase 8 no backlog; `SPEC.md:204-402` — modelo de dados (defasado)
- `apps/api/ENDPOINTS.md:3-26` — convenções globais; `:668-674` — formato literal de um endpoint
- `docs/observabilidade.md:57-68` — catálogo de eventos; `:101-112` — regras de segredo
- `.github/PULL_REQUEST_TEMPLATE.md:1-19` — checklist de Definition of Done
- `specs/plans/2026-07-25-colaboradores-e-papeis.md:67,68,333,343,348-349,474`
- `specs/research/2026-07-23-rls-por-ownerid.md:193,194,203`
- `specs/plans/2026-07-21-fase-2-pipeline.md:61-62` — decisão de hard delete que esta fase reverte
- `specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md:77,186-211,627,688`
