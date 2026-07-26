---
date: 2026-07-25T00:00:00-03:00
author: claude
source_prd: standalone
git_commit: 992b5075f606fcc108e2a6d252eda3de26537218
branch: main
status: implemented
tags: [spec, colaboradores, papeis, permissoes, rbac, rls, nestjs, react]
---

# Spec: Colaboradores e papéis (RBAC) com isolamento por owner

## Overview

Trazer para o CRM a funcionalidade de **colaboradores com papéis e permissões granulares** que já existe no painel do Dorados da Sorte, adaptada à arquitetura do CRM (NestJS + Prisma + React/Vite) e — diferença central — **preservando o isolamento por `ownerId`**.

Hoje o CRM é multi-owner numa instância: cada `User` é o próprio owner e `app.owner_id` (o GUC que as policies de RLS leem) recebe `req.user.sub`. Colaborador rompe essa identidade: passa a existir usuário cujo `ownerId` **não** é o próprio id. A partir desta spec:

- **Owner** = quem se cadastrou (`User.ownerId = NULL`). Dono da workspace, dos dados e da assinatura. Tem **todas** as permissões por definição, não recebe papel, não pode ser desativado.
- **Colaborador** = usuário criado por convite (`User.ownerId = <id do owner>`), com **um papel** (`Role`) que carrega um conjunto de chaves de permissão. Enxerga **exatamente os mesmos dados do owner** (mesmo `app.owner_id`) e nada de outros owners.

A inspiração técnica é o Dorados (`lib/permissoes.ts`, `lib/auth.ts`, `lib/tokens-email.ts`, `app/admin/papeis`, `app/admin/usuarios`, `app/convite/[token]`); o **design, o idioma e os padrões de código são 100% do CRM** — Modular Monolith com camadas, repository pattern, DTOs class-validator, log estruturado, TanStack Query, design system `components/ui`.

## Current State

**Backend (`apps/api`)**
- `User` (`prisma/schema.prisma:13-24`): `id`, `name`, `email` unique, `passwordHash?` (nulo em conta OAuth), `refreshTokenHash?`, `stripeCustomerId?`, `oauthAccounts`, `passwordResetTokens`, `subscription`. **Fora do RLS** (login busca por e-mail).
- RLS por `ownerId` nas 10 tabelas de dados + `Subscription` (`prisma/migrations/20260724050000_enable_rls/migration.sql`): `USING`/`WITH CHECK` em `"ownerId" = current_setting('app.owner_id', true)`, `FORCE ROW LEVEL SECURITY`, fail-closed sem contexto.
- `PrismaService` conecta como `crm_app` (NOBYPASSRLS) e expõe `prisma.db` = transação do request (via CLS) ou client base; `PrismaAdminService` conecta como `crm_user` (superuser, bypassa RLS) para operações sem contexto de owner (webhook Stripe, registro, seed).
- `OwnerContextInterceptor` (`src/prisma/owner-context.interceptor.ts`): em request autenticado abre transação, faz `SELECT set_config('app.owner_id', $1, true)` **com `req.user.sub`** e guarda o `tx` no CLS.
- `JwtAuthGuard` global popula `req.user = { sub }`; `@Public()` libera rota; `@CurrentUserId()` (`src/shared/current-user.decorator.ts`) devolve `req.user.sub` e é usado como **`ownerId`** em 11 controllers (activities, billing, clients, contacts, dashboard, contracts, payments, deals, projects, tasks, proposals).
- `BillingGuard` global (após o `JwtAuthGuard`) usa `req.user.sub` como `ownerId` do gate de assinatura; `@AllowWithoutSubscription()` isenta as rotas de billing.
- `AuthService`: registro/login/refresh/logout, reset de senha por token sha256 (`PasswordResetToken`, TTL 1h), OAuth Google/GitHub. `register()` cria o usuário com trial de 14 dias via `PrismaAdminService`.
- `MailService` (`src/mail/mail.service.ts`): SMTP opcional — sem `SMTP_HOST` o envio é desabilitado e o conteúdo é logado em `warn`. Templates em `src/mail/templates/` com helpers de layout (`button`, `pill`, `urlBox`, `renderLayout`).
- `nav.ts` do front já declara `permission?: string` **"Reservado para RBAC futuro; hoje ignorado"**.

**Frontend (`apps/web`)**
- `lib/auth.tsx` (contexto: `isAuthenticated`, `login`, `register`, `logout`), `lib/api.ts` (axios + refresh transparente + redirect no 402).
- `app/ProtectedRoute.tsx` só checa sessão; `app/AppLayout.tsx` renderiza `NAV_GROUPS` inteiro e usa `useMe()` de `features/perfil/api/hooks`.
- `routes/router.tsx` lista todas as rotas sob `ProtectedRoute` → `AppLayout`.
- Padrões: TanStack Query com `queryKeys` centralizado, `features/<nome>/api/{*.api.ts,hooks.ts,types.ts}`, formulários com react-hook-form + zod + `Field`/`FieldLabel required`, `ConfirmDialog` para ação destrutiva, `Table`/`TableEmpty`, toasts `sonner` em pt-BR.

**Regra do `CLAUDE.md` da raiz** — "É single-tenant: há um `ownerId` como preparação para multiusuário… Não introduza multi-tenancy sem decisão explícita." Esta spec **é** a decisão explícita: multiusuário **dentro** do owner (colaboradores), sem introduzir organização/tenant como entidade separada. O `ownerId` continua sendo o eixo único de isolamento.

## Desired End State

- `Role` (papel) por owner, com `permissions String[]`, `system` para o papel "Administrador" (não editável/excluível) e `@@unique([ownerId, name])`; RLS por `ownerId`.
- `User` ganha `ownerId?` (auto-relação), `roleId?`, `active`, `acceptedAt?`. Owner: `ownerId = NULL`, `roleId = NULL`. Colaborador: ambos preenchidos.
- `CollaboratorInvite`: token de uso único (sha256, 7 dias), invalidando o anterior; RLS por `ownerId`.
- Catálogo único de permissões no backend (`src/shared/permissions.ts`), exposto por `GET /permissions` — o front **não duplica** rótulos em pt-BR.
- `AccessGuard` global (após `JwtAuthGuard`, antes do `BillingGuard`) resolve `req.access = { userId, ownerId, isOwner, roleName, permissions }`, barra usuário inativo e aplica `@RequirePermission()`.
- `OwnerContextInterceptor` e `BillingGuard` passam a usar `req.access.ownerId` → colaborador lê/escreve os dados do owner e herda a assinatura dele.
- `@CurrentOwnerId()` substitui `@CurrentUserId()` onde o parâmetro significa "workspace"; `@CurrentUserId()` permanece para identidade (perfil, logout).
- Módulo `collaborators` (camadas `domain/application/infra/api`): CRUD de papéis, CRUD de colaboradores (convidar, trocar papel, ativar/desativar), reenvio de convite e **rotas públicas** de consulta/aceite do convite (define senha e já entra logado).
- Convite entregue **por e-mail** (template novo no padrão do CRM) **e** devolvido como link copiável na tela — funciona em dev sem SMTP.
- Frontend: `useCan()`, sidebar e rotas filtradas por permissão, grupo "Organização" com **Colaboradores** e **Papéis**, e página pública `/convite/:token`.
- `ENDPOINTS.md` e os `CLAUDE.md` (raiz, api, web) atualizados.

## What We're NOT Doing

- **Sem organização/tenant como entidade.** O eixo de isolamento continua sendo `ownerId`; não há tabela `Organization`.
- **Sem cobrança por assento (seat).** Colaborador não cria `Subscription` nem conta para o preço; herda o gate do owner.
- **Sem transferir a titularidade** da workspace nem promover colaborador a owner.
- **Sem colaborador via OAuth.** O aceite do convite define senha; vincular Google/GitHub a colaborador fica fora.
- **Sem trava anti-lockout** (a do Dorados). Ela existe lá porque todo usuário tem papel; aqui o owner é total e imexível, então lockout é impossível por construção.
- **Sem permissão por registro** (ex.: "só os clientes que eu criei"). A granularidade é por módulo/ação, e todo colaborador vê todos os dados do owner.
- **Sem RLS na tabela `User`.** Mantém-se a decisão vigente (login por e-mail); o isolamento de colaboradores é feito por filtro explícito `ownerId` no repositório.
- **Sem exclusão de colaborador.** Segue o Dorados: desativa/reativa.
- **Sem trocar o papel do próprio usuário** nem se autodesativar.

---

## Phase 1: Dados — papel, convite e vínculo owner↔colaborador

### Goal
Schema e migration prontos: `Role`, `CollaboratorInvite`, campos novos em `User`, RLS nas tabelas novas e backfill do papel "Administrador" para os owners já existentes.

### Changes

#### `apps/api/prisma/schema.prisma`

Em `User`, acrescentar o bloco de colaboração:

```prisma
model User {
  id               String         @id @default(uuid())
  name             String
  email            String         @unique
  passwordHash     String? // nulo: conta OAuth ou convite de colaborador ainda não aceito
  refreshTokenHash String?
  stripeCustomerId String?        @unique
  // --- colaboração ---
  // NULL = é owner (dono da workspace). Preenchido = colaborador daquele owner:
  // o `ownerId` do RLS passa a ser este valor, não o próprio id (ver AccessService).
  ownerId          String?
  owner            User?          @relation("Collaborators", fields: [ownerId], references: [id], onDelete: Cascade)
  collaborators    User[]         @relation("Collaborators")
  // Papel do colaborador. NULL no owner — que tem todas as permissões por definição.
  roleId           String?
  role             Role?          @relation(fields: [roleId], references: [id])
  // Colaborador desativado não autentica e perde a sessão na próxima requisição.
  active           Boolean        @default(true)
  // Quando o convite foi aceito (senha definida). NULL = convite pendente.
  acceptedAt       DateTime?
  createdAt        DateTime       @default(now())
  oauthAccounts    OAuthAccount[]
  passwordResetTokens PasswordResetToken[]
  subscription     Subscription?
  ownedRoles       Role[]         @relation("OwnerRoles")
  invites          CollaboratorInvite[]

  @@index([ownerId])
}
```

Modelos novos:

```prisma
// Papel de colaborador: um conjunto de chaves do catálogo em
// `src/shared/permissions.ts`. Escopado ao owner (RLS por ownerId) — dois owners
// podem ter papéis com o mesmo nome sem se verem.
model Role {
  id          String   @id @default(uuid())
  ownerId     String
  owner       User     @relation("OwnerRoles", fields: [ownerId], references: [id], onDelete: Cascade)
  name        String
  description String?
  // Papel criado junto com a conta ("Administrador"): não é editável nem
  // excluível e vale SEMPRE o catálogo inteiro (resolvido em AccessService), de
  // modo que uma permissão nova não deixa o papel desatualizado.
  system      Boolean  @default(false)
  permissions String[] @default([])
  users       User[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([ownerId, name])
  @@index([ownerId])
}

// Convite de colaborador. Guarda apenas o sha256 do token que vai no link — o
// valor bruto só existe no e-mail/link entregue ao convidado. Uso único.
model CollaboratorInvite {
  id        String    @id @default(uuid())
  ownerId   String
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@index([ownerId])
}
```

#### `apps/api/prisma/migrations/20260725120000_add_collaborators_and_roles/migration.sql`

1. `CREATE TABLE "Role"`, `CREATE TABLE "CollaboratorInvite"` + índices/FKs (o que o `prisma migrate diff` gerar).
2. `ALTER TABLE "User"` com as colunas novas (`ownerId`, `roleId`, `active` default true, `acceptedAt`) + FKs + índice.
3. **Backfill**: todo `User` existente é owner → `ownerId` fica NULL (default) e `acceptedAt` recebe `createdAt` (contas já ativas):
   ```sql
   UPDATE "User" SET "acceptedAt" = "createdAt" WHERE "acceptedAt" IS NULL;
   ```
4. **Papel "Administrador" (system) para cada owner existente**:
   ```sql
   INSERT INTO "Role" ("id", "ownerId", "name", "description", "system", "permissions", "createdAt", "updatedAt")
   SELECT gen_random_uuid(), u."id", 'Administrador',
          'Acesso total ao CRM. Papel do sistema — não pode ser editado nem excluído.',
          true, ARRAY[]::text[], now(), now()
     FROM "User" u
    WHERE u."ownerId" IS NULL;
   ```
   `permissions` vazio de propósito: papel `system` resolve para o catálogo inteiro.
5. **RLS** nas duas tabelas novas, no mesmo molde do arquivo de RLS existente (`FOR ALL`, `USING`/`WITH CHECK` idênticos, `FORCE`):
   ```sql
   ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "Role" FORCE  ROW LEVEL SECURITY;
   CREATE POLICY owner_isolation ON "Role"
     FOR ALL
     USING      ("ownerId" = current_setting('app.owner_id', true))
     WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
   -- idem "CollaboratorInvite"
   ```

#### `apps/api/prisma/seed.ts`
Se o seed criar usuário de exemplo, criar também o papel "Administrador" `system` correspondente. (Verificar o conteúdo atual e ajustar apenas o necessário.)

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma validate` passa.
- [x] `pnpm --filter api exec prisma migrate dev` aplica sem erro num banco limpo.
- [x] `pnpm --filter api exec prisma generate` regenera o client com `Role`/`CollaboratorInvite`.
- [x] `pnpm --filter api build` compila.

#### Manual Verification (feita em navegador headless + curl na sessão de implementação)
- [x] `\d+ "Role"` mostra a policy `owner_isolation` e `FORCE`.
- [x] Owner já existente no banco ganhou um papel "Administrador" com `system = true`.

---

## Phase 2: Contexto de acesso e enforcement de permissão

### Goal
Toda requisição autenticada resolve `{ ownerId, isOwner, permissions }`; o RLS e o billing passam a usar o **owner da workspace**; rotas ganham `@RequirePermission()`.

### Changes

#### `apps/api/src/shared/permissions.ts` (novo)
Catálogo único — espelha `lib/permissoes.ts` do Dorados (chave, rótulo, descrição, categoria, `hidden?`), em pt-BR:

```ts
export const PERMISSION_CATEGORIES = [
  'Clientes', 'Pipeline', 'Propostas', 'Operação', 'Financeiro', 'Organização',
] as const;

export const PERMISSIONS = [
  { key: 'cliente:ver',          label: 'Ver clientes',            description: 'Consultar a base de clientes, contatos e histórico', category: 'Clientes' },
  { key: 'cliente:gerenciar',    label: 'Gerenciar clientes',      description: 'Criar, editar e arquivar clientes, contatos e atividades', category: 'Clientes' },
  { key: 'oportunidade:ver',     label: 'Ver pipeline',            description: 'Consultar o quadro de oportunidades', category: 'Pipeline' },
  { key: 'oportunidade:gerenciar', label: 'Gerenciar oportunidades', description: 'Criar, mover, ganhar e perder oportunidades', category: 'Pipeline' },
  { key: 'proposta:ver',         label: 'Ver propostas',           description: 'Consultar propostas e versões', category: 'Propostas' },
  { key: 'proposta:gerenciar',   label: 'Gerenciar propostas',     description: 'Criar, versionar, enviar e decidir propostas', category: 'Propostas' },
  { key: 'projeto:ver',          label: 'Ver projetos e demandas', description: 'Consultar projetos, quadros e demandas', category: 'Operação' },
  { key: 'projeto:gerenciar',    label: 'Gerenciar projetos',      description: 'Criar, editar e encerrar projetos', category: 'Operação' },
  { key: 'demanda:gerenciar',    label: 'Gerenciar demandas',      description: 'Criar, mover e concluir demandas dos projetos', category: 'Operação' },
  { key: 'financeiro:ver',       label: 'Ver financeiro',          description: 'Consultar contratos, recebimentos e indicadores financeiros', category: 'Financeiro' },
  { key: 'financeiro:gerenciar', label: 'Gerenciar financeiro',    description: 'Criar contratos e registrar recebimentos', category: 'Financeiro' },
  { key: 'colaborador:gerenciar', label: 'Gerenciar colaboradores', description: 'Convidar, desativar e trocar o papel de colaboradores', category: 'Organização' },
  { key: 'papel:gerenciar',      label: 'Gerenciar papéis',        description: 'Criar, editar e excluir papéis e suas permissões', category: 'Organização' },
  { key: 'assinatura:gerenciar', label: 'Gerenciar assinatura',    description: 'Ver e alterar o plano de assinatura do CRM', category: 'Organização' },
] as const;
```
Mais: `PermissionKey`, `ALL_PERMISSION_KEYS`, `isPermissionKey()`, `sanitizePermissionKeys()` (dedupe + descarta chave fora do catálogo — equivale a `filtrarChavesValidas`) e `permissionCatalog()` agrupado por categoria (para o `GET /permissions`).

#### `apps/api/src/modules/access/` (novo — recurso transversal com fronteira clara)
- `domain/access-context.ts`: `AccessContext { userId; ownerId; isOwner; roleId: string | null; roleName: string | null; permissions: PermissionKey[] }` e `AuthenticatedRequest` (tipo do `req` com `user` + `access`).
- `application/access.service.ts`:
  ```ts
  async resolve(userId: string): Promise<AccessContext | null>
  ```
  Lê `User` (com `role`) pelo **`PrismaAdminService`** — corre **antes** do contexto de RLS existir e `Role` tem RLS. Regras: usuário inexistente → `null`; `active === false` → `null`; owner (`ownerId == null`) → `isOwner: true`, `permissions = ALL_PERMISSION_KEYS`; colaborador → `ownerId` do vínculo e `permissions` do papel (`role.system` → catálogo inteiro; sem papel → `[]`).
- `access.guard.ts`: pula `@Public()`; resolve pelo `req.user.sub`; `null` → `UnauthorizedException('Sessão inválida ou acesso desativado.')`; grava `req.access`; lê `@RequirePermission()` e, faltando a chave, lança `ForbiddenException('Você não tem permissão para <rótulo em minúsculas>.')` (usa o rótulo do catálogo, como o `exigirPermissao` do Dorados).
- `require-permission.decorator.ts`: `@RequirePermission(...keys: PermissionKey[])` via `SetMetadata` (OR entre as chaves — ex.: leitura liberada para quem tem `:ver` **ou** `:gerenciar`).
- `access.module.ts`: `@Global()`, provê/exporta `AccessService`.

#### `apps/api/src/shared/current-user.decorator.ts`
Manter `@CurrentUserId()` (identidade) e acrescentar:
- `@CurrentOwnerId()` → `req.access.ownerId` (a workspace).
- `@CurrentAccess()` → `req.access` inteiro (usado pelo `/auth/me`).

#### `apps/api/src/prisma/owner-context.interceptor.ts`
`const ownerId = req.access?.ownerId ?? req.user?.sub;` — comentário explicando que o GUC recebe o **owner da workspace**, para o colaborador cair nas mesmas linhas do owner.

#### `apps/api/src/modules/billing/billing.guard.ts`
`const ownerId = req.access?.ownerId ?? req.user?.sub;` — colaborador herda o gate do owner.

#### `apps/api/src/app.module.ts`
Registrar `AccessModule` e o guard **entre** `JwtAuthGuard` e `BillingGuard`:
```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: AccessGuard },   // precisa de req.user; publica req.access
{ provide: APP_GUARD, useClass: BillingGuard },  // usa req.access.ownerId
```

#### `apps/api/src/modules/auth/auth.service.ts` + `auth.controller.ts`
- `login()`: bloquear colaborador desativado ou com convite pendente → `UnauthorizedException` com mensagem pt-BR específica ("Seu acesso foi desativado…" / credenciais inválidas quando não há senha).
- `refresh()`: negar se `active === false`.
- `me()`: devolver, além do usuário sem segredos, `isOwner`, `role` (`{ id, name } | null`) e `permissions` — lidos de `@CurrentAccess()`.
- `updateProfile()` continua por `@CurrentUserId()`.

#### `apps/api/src/modules/access/api/permissions.controller.ts` (novo)
`GET /permissions` (autenticada, sem permissão exigida) → catálogo agrupado por categoria, sem as chaves `hidden`. Fonte única dos rótulos pt-BR para o editor de papéis no front.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` compila.
- [x] `pnpm --filter api lint` sem erro.
- [x] `pnpm --filter api test` passa (inclui os `*.spec.ts` existentes de billing/owner-context).
- [x] Testes novos: `access.service.spec.ts` (owner → todas; colaborador → papel; `system` → catálogo; inativo → null) e `access.guard.spec.ts` (403 sem permissão, 401 inativo, `@Public()` passa).

#### Manual Verification (feita em navegador headless + curl na sessão de implementação)
- [x] Login de colaborador e `GET /auth/me` devolve `isOwner: false` e as permissões do papel.
- [x] Colaborador chamando rota sem permissão recebe **403 em pt-BR**.
- [x] Colaborador em `GET /clients` vê os clientes **do owner** (mesmo `app.owner_id`).

---

## Phase 3: Módulo de colaboradores e papéis

### Goal
Backend completo de gestão: papéis, convites e colaboradores, com aceite público que já autentica.

### Changes

#### `apps/api/src/modules/collaborators/`

```
collaborators.module.ts
domain/
  role.repository.ts            → ROLE_REPOSITORY + interface
  collaborator.repository.ts    → COLLABORATOR_REPOSITORY + interface (User escopado por ownerId)
  invite.repository.ts          → INVITE_REPOSITORY + interface
application/
  roles.service.ts
  collaborators.service.ts
  invites.service.ts            → emitir/localizar/consumir token (sha256, 7 dias)
infra/
  prisma-role.repository.ts
  prisma-collaborator.repository.ts
  prisma-invite.repository.ts
api/
  roles.controller.ts
  collaborators.controller.ts
  invites.controller.ts         → rotas PÚBLICAS do aceite
  dto/{create-role,update-role,create-collaborator,update-collaborator,accept-invite}.dto.ts
```

**Papéis — `roles.controller.ts` (`@RequirePermission('papel:gerenciar')`)**
- `GET /roles` → lista do owner com `collaboratorsCount` e, para `system`, `permissions` = catálogo inteiro.
- `POST /roles` `{ name, description?, permissions[] }` → `409` se o nome repetir no owner; `permissions` saneadas pelo catálogo.
- `PATCH /roles/:id` → `403` se `system`; `409` em conflito de nome.
- `DELETE /roles/:id` → `403` se `system`; `409 'Este papel está em uso por colaboradores…'` se houver usuário vinculado.
- `DELETE /roles/:id/permissions/:key` → remoção pontual (paridade com `removerPermissaoFuncao` do Dorados).

**Colaboradores — `collaborators.controller.ts` (`@RequirePermission('colaborador:gerenciar')`)**
- `GET /collaborators` → colaboradores do owner (`ownerId` filtrado explicitamente, pois `User` não tem RLS), sem `passwordHash`/`refreshTokenHash`, com `role`, `active` e `status` derivado (`PENDING` quando `acceptedAt` nulo).
- `POST /collaborators` `{ name, email, roleId }` → cria `User` (ownerId atual, `passwordHash` nulo, `active` true) + emite convite, envia e-mail e responde `201 { collaborator, inviteUrl }`. `409` se o e-mail já existe (qualquer conta); `400` se o `roleId` não é do owner.
- `POST /collaborators/:id/invite` → reemite (invalida o anterior); `409` se o convite já foi aceito.
- `PATCH /collaborators/:id` `{ roleId?, active? }` → troca papel / ativa / desativa. `403` ao mirar o próprio usuário ou o owner; ao desativar, revoga o refresh token do colaborador.

**Convite público — `invites.controller.ts`**
- `GET /collaborators/invite/:token` (`@Public()`, throttle 10/min) → `{ name, email, ownerName }`; `410` em token inexistente/expirado/usado (mensagens pt-BR iguais em espírito às do reset de senha).
- `POST /collaborators/invite/:token/accept` (`@Public()`, throttle 5/min) `{ password }` → consome o token (uso único via `updateMany` condicionado a `usedAt: null`), grava `passwordHash` (argon2), marca `acceptedAt` e **emite sessão** (access + cookie de refresh) — o convidado já entra logado, como no Dorados.
- Ambas via `PrismaAdminService` (rota pública, sem contexto de owner; `CollaboratorInvite` tem RLS).

**`invites.service.ts`** — espelha `lib/tokens-email.ts` do Dorados: `randomBytes(32).toString('hex')`, sha256 no banco, `INVITE_TTL_DAYS = 7`, emissão apaga os convites anteriores do mesmo usuário, `inviteUrl = ${FRONTEND_URL}/convite/${token}`.

#### `apps/api/src/modules/auth/refresh-cookie.ts` (novo)
Extrair `setRefreshCookie(res, token, config)` de `AuthController` (privado hoje) e reusar no aceite do convite — um único lugar definindo `httpOnly`/`sameSite`/`path`/`maxAge`. `AuthController` passa a chamar o helper. Exportar `AuthService` no `AuthModule` para o `invites.controller` emitir a sessão.

#### `apps/api/src/mail/templates/collaborator-invite.template.ts` (novo)
Mesmo formato de `password-reset.template.ts` (`subject`/`text`/`html`, helpers `button`/`pill`/`urlBox`/`renderLayout`): quem convidou, para qual workspace, papel, botão "Ativar meu acesso" e aviso de validade de 7 dias. `MailService.sendCollaboratorInvite(...)` seguindo o padrão "sem SMTP → `warn` com o link".

#### Log estruturado (eventos novos, `substantivo.acao_no_passado`)
`colaborador.convidado`, `colaborador.convite_reemitido`, `colaborador.convite_aceito`, `colaborador.papel_alterado`, `colaborador.desativado`, `colaborador.reativado`, `papel.criado`, `papel.atualizado`, `papel.excluido`, `acesso.negado` (403 do guard). Sem segredo: **nunca** logar token nem link do convite fora do fallback de dev já existente.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build`, `lint` e `test` passam.
- [x] Testes novos: `roles.service.spec.ts` (nome duplicado, `system` imexível, papel em uso), `collaborators.service.spec.ts` (e-mail duplicado, papel de outro owner, não mexer em si mesmo/owner), `invites.service.spec.ts` (uso único, expiração, reemissão invalida anterior).

#### Manual Verification (feita em navegador headless + curl na sessão de implementação)
- [x] Convidar colaborador → e-mail chega (ou link no log) e o link aparece na resposta.
- [x] Aceitar o convite define a senha e entra logado; reabrir o link dá `410`.
- [x] Desativar colaborador derruba a sessão dele na requisição seguinte.

---

## Phase 4: Permissões nas rotas existentes

### Goal
Cada rota dos 11 controllers passa a exigir a permissão certa e a receber o `ownerId` da workspace.

### Changes
Em cada controller: trocar `@CurrentUserId() ownerId` por `@CurrentOwnerId() ownerId` e anotar o método.

| Controller | Leitura | Escrita |
|---|---|---|
| `clients.controller.ts` | `cliente:ver`, `cliente:gerenciar` | `cliente:gerenciar` |
| `contacts.controller.ts` | `cliente:ver`, `cliente:gerenciar` | `cliente:gerenciar` |
| `activities.controller.ts` | `cliente:ver`, `cliente:gerenciar` | `cliente:gerenciar` |
| `deals.controller.ts` | `oportunidade:ver`, `oportunidade:gerenciar` | `oportunidade:gerenciar` |
| `proposals.controller.ts` | `proposta:ver`, `proposta:gerenciar` | `proposta:gerenciar` |
| `projects.controller.ts` | `projeto:ver`, `projeto:gerenciar` | `projeto:gerenciar` |
| `tasks.controller.ts` | `projeto:ver`, `projeto:gerenciar`, `demanda:gerenciar` | `demanda:gerenciar` |
| `contracts.controller.ts` | `financeiro:ver`, `financeiro:gerenciar` | `financeiro:gerenciar` |
| `payments.controller.ts` | `financeiro:ver`, `financeiro:gerenciar` | `financeiro:gerenciar` |
| `dashboard.controller.ts` | resumo: sem permissão; recorte financeiro: `financeiro:ver` ou `financeiro:gerenciar` | — |
| `billing.controller.ts` | `assinatura:gerenciar` | `assinatura:gerenciar` |
| `pipeline` (estágios) | sem permissão (catálogo global) | — |

Rotas de leitura recebem as duas chaves (`:ver` **ou** `:gerenciar`) para que um papel só-de-escrita não fique cego.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build`, `lint`, `test` passam.
- [x] `grep -rn "CurrentUserId" src/modules` só aparece em rotas de identidade (auth).

#### Manual Verification (feita em navegador headless + curl na sessão de implementação)
- [x] Papel só com `cliente:ver` lista clientes mas recebe 403 ao criar.
- [x] Owner continua acessando tudo.

---

## Phase 5: Frontend — permissões, telas e aceite do convite

### Goal
Sidebar e rotas por permissão, telas de Colaboradores e Papéis no design do CRM, e página pública de aceite.

### Changes

#### Base
- `features/perfil/api/perfil.api.ts`: `Me` ganha `isOwner: boolean`, `role: { id, name } | null`, `permissions: string[]`.
- `hooks/use-can.ts` (novo): `useCan()` → `{ can(key), canAny(keys), isOwner, loading }` sobre `useMe()` (precedente: `AppLayout` já consome `useMe`).
- `lib/query-keys.ts`: `collaborators.all/list`, `roles.all`, `permissions.catalog`.

#### Navegação e rotas
- `app/nav.ts`: preencher `permission` em todos os itens e acrescentar o grupo **Organização** → `/colaboradores` (`colaborador:gerenciar`) e `/papeis` (`papel:gerenciar`). Trocar o comentário "Reservado para RBAC futuro" por "Chave exigida para o item aparecer".
- `app/AppLayout.tsx`: filtrar `NAV_GROUPS` por `can()` e ocultar grupo vazio. O item "Assinatura" no menu do usuário passa a exigir `assinatura:gerenciar`.
- `app/PermissionRoute.tsx` (novo): `<PermissionRoute permission="…">` — `Spinner` enquanto carrega, `Navigate to="/"` sem permissão. Aplicado a todas as rotas de feature em `routes/router.tsx`.
- `routes/router.tsx`: rota pública `/convite/:token` + as duas rotas novas do grupo Organização.

#### `features/organizacao/` (novo)
- `api/types.ts`, `api/organizacao.api.ts`, `api/hooks.ts` (TanStack Query: `useCollaborators`, `useCreateCollaborator`, `useUpdateCollaborator`, `useResendInvite`, `useRoles`, `useCreateRole`, `useUpdateRole`, `useDeleteRole`, `useRemoveRolePermission`, `usePermissionCatalog`).
- `ColaboradoresPage.tsx`: título + "Convidar colaborador"; `Table` com Nome (marcando "você"), E-mail, Papel (`Select` do design system, desabilitado no próprio usuário), Situação (`Badge`: Convite pendente / Ativo / Inativo) e ações (Reenviar convite, Desativar/Reativar via `ConfirmDialog`); `TableEmpty` e `Skeleton` no padrão da `ClientesListPage`.
- `ConvidarColaboradorDialog.tsx`: `Dialog` do design system (respeitando `modal-stack`), react-hook-form + zod (mensagens pt-BR), `FieldLabel required` nos obrigatórios, `Select` de papel; no sucesso troca o corpo pelo **link do convite** com botão "Copiar link" e o aviso de validade — sem nunca abrir modal sobre modal.
- `PapeisPage.tsx`: `Table` com linha expansível (`ChevronRight`/`ChevronDown`) listando as permissões do papel (rótulo + descrição do `GET /permissions`) e remoção pontual via `ConfirmDialog`; `Badge` "Sistema"/"Personalizado"; editar/excluir desabilitados no papel `system` com `title` explicando.
- `PapelFormDialog.tsx`: nome, descrição e as permissões agrupadas por categoria com `Checkbox` do design system (o CRM tem `checkbox`, não `switch` — usar o primitivo existente), contador de selecionadas.

#### `features/auth/AceitarConvitePage.tsx` (novo)
Usa `AuthLayout` (mesma casca de `/redefinir-senha`): consulta `GET /collaborators/invite/:token`; token inválido → mensagem em `role="alert"` + link para `/login`; válido → saudação com nome/e-mail, `PasswordInput` + confirmação (zod, mín. 6, "As senhas não coincidem"), e no sucesso guarda o `accessToken`, marca a sessão como autenticada e navega para `/`.
- `lib/auth.tsx`: expor um `acceptInvite(token, password)` (ou `authenticateWithToken`) para a página não manipular o `auth-store` na mão.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` compila (tsc + vite).
- [x] `pnpm --filter web lint` sem erro.

#### Manual Verification (feita em navegador headless + curl na sessão de implementação)
- [x] Colaborador sem `financeiro:*` não vê o grupo Financeiro e, ao digitar `/financeiro`, cai no dashboard.
- [x] Convite: copiar link, abrir em aba anônima, definir senha, entrar já logado.
- [x] Editor de papéis reflete o catálogo do backend; papel "Administrador" aparece como Sistema e imexível.
- [x] Tudo em pt-BR, asterisco vermelho nos campos obrigatórios, sem modal sobre modal, tema claro/escuro ok.

---

## Phase 6: Documentação

### Goal
Docs em dia — parte do Definition of Done do repo.

### Changes
- `apps/api/ENDPOINTS.md`: seções **Permissões**, **Papéis**, **Colaboradores** e **Convite de colaborador** no formato fixo (Propósito/Auth/Body/Resposta/Erros/Handler); atualizar `GET /auth/me` (campos novos) e o campo **Auth** de todas as rotas que passaram a exigir permissão.
- `apps/api/CLAUDE.md` → "Autenticação": descrever `req.access`, `AccessGuard`, `@RequirePermission`, `@CurrentOwnerId` vs `@CurrentUserId` e a regra "o GUC `app.owner_id` recebe o owner da workspace".
- `CLAUDE.md` (raiz) → "Escopo de produto": substituir "single-tenant … sem isolamento por RLS" pela descrição real — multi-owner com RLS por `ownerId` e colaboradores dentro do owner; owner é total e imexível; **não** há organização/tenant.
- `apps/web/CLAUDE.md`: regra de gating (`useCan`, `permission` no nav, `PermissionRoute`) e a fonte dos rótulos de permissão (backend, nunca duplicar).
- `ROADMAP.md`: marcar "Multiusuário com papéis/permissões" como entregue.

### Success Criteria

#### Automated Verification
- [x] Toda rota nova aparece em `ENDPOINTS.md` (contagem `grep -c '^### '` bate com os controllers).

#### Manual Verification (feita em navegador headless + curl na sessão de implementação)
- [x] Um leitor novo entende, só pela doc, como colaborador herda o `ownerId` e a assinatura.

---

## Testing Strategy

- **Unitário (Jest, padrão do repo):** `AccessService` (owner/colaborador/system/inativo), `AccessGuard` (403/401/`@Public`), `RolesService`, `CollaboratorsService`, `InvitesService`.
- **Isolamento (manual, com dois owners):** owner A com colaborador; logar como colaborador de A e confirmar que os dados de B não aparecem em nenhuma listagem; conferir no Postgres que `app.owner_id` na transação do colaborador é o id de A.
- **Regressão de billing:** colaborador de owner com trial expirado recebe 402 e o front leva ao paywall.

## Performance Considerations

O `AccessGuard` acrescenta **uma** consulta indexada por requisição autenticada (`User` + `role`), pelo client admin. É o mesmo custo que o Dorados paga ao ler papel/permissões do banco a cada requisição, e é deliberado: permite que troca de papel e desativação valham **na hora**, sem esperar o token expirar. Sem cache nesta fase.

## Migration Notes

- Contas existentes viram owners (`ownerId` NULL) sem nenhuma ação do usuário e ganham o papel "Administrador" (`system`) pelo backfill.
- O JWT **não** muda de formato (`{ sub }`), então sessões emitidas antes do deploy continuam válidas.
- Ordem no deploy: migration → API → web. Entre a migration e a API nova, nada quebra (as colunas novas têm default).

## Desvios da execução (registrados na implementação)

Cinco pontos ficaram diferentes do plano — todos ampliando o escopo para fechar buracos que só
apareceram com o código na mão:

1. **`GET /billing/status` sem permissão.** O plano punha o módulo inteiro sob
   `assinatura:gerenciar`. Só `checkout`/`portal` ficaram restritos: o status é o que diz à
   interface se o billing existe e é o que a tela de bloqueio usa para explicar a suspensão a um
   colaborador. Com ele restrito, um colaborador barrado pelo 402 cairia em `/assinatura` e veria
   erro atrás de erro.
2. **`GET /dashboard/summary` recorta por permissão.** O plano deixava o resumo livre. Como ele
   agrega pipeline, propostas e demandas num único payload, "livre" significava vazar totais de
   propostas para quem não tem `proposta:ver`. O service passou a receber `access.permissions` e
   devolve `null` no bloco não permitido; o front esconde a seção correspondente.
3. **Escritas de `pipeline-stages` exigem `oportunidade:gerenciar`.** O plano dizia "sem permissão
   (catálogo global)". A leitura segue livre (o quadro não renderiza sem os estágios), mas as
   escritas afetam o pipeline de todos os owners da instância — deixá-las abertas a qualquer
   colaborador seria pior do que o estado anterior.
4. **Abas do detalhe do cliente filtradas por permissão.** O `permission?` do `SectionTabItem`
   deixou de ser placeholder: as abas Oportunidades/Propostas/Projetos/Contratos atravessam módulos
   e são removidas para quem não pode vê-las. O filtro fica em quem monta a lista
   (`ClienteDetalheLayout`), não no primitivo de `components/ui`, que não conhece a sessão.
5. **Sem FK em `CollaboratorInvite.ownerId`.** A coluna é denormalizada para o RLS, como
   `Contact.ownerId`/`Deal.ownerId` — o padrão do schema é não colocar FK nessas colunas. O nome do
   owner exibido na página do convite vem da relação real (`User.owner`), não de uma FK nova.

## References

- Inspiração: `DoradosDaSorte/lib/permissoes.ts`, `lib/auth.ts`, `lib/tokens-email.ts`, `app/admin/actions.ts` (§Colaboradores/§Papéis), `app/admin/papeis/papeis-client.tsx`, `app/admin/usuarios/page.tsx`, `app/convite/[token]/page.tsx`.
- Base de isolamento do CRM: `specs/plans/2026-07-23-rls-por-ownerid.md`, `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql`.
- Interação com billing: `specs/plans/2026-07-24-billing-stripe.md`.
