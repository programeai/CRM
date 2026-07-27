---
date: 2026-07-26T19:41:16-03:00
author: claude
source_prd: specs/research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md
git_commit: b87e8af528af3e35c528c9c8ae6bbb582ca8ec8b
branch: main
status: implemented
tags: [spec, permissoes, colaboradores, pipeline, demandas, clientes, dashboard]
---

# Spec: Fase 7B — Responsável por registro (`assigneeId`)

## Overview

Papéis definem **o que** um colaborador pode fazer, mas o CRM não sabe **de quem** é o registro:
grep por `assignee|responsav|assignedTo` em `apps/api/src`, `apps/web/src` e `prisma/` retorna zero.
Sem carteira por vendedor não há distribuição de lead, métrica por pessoa, nem "Minhas demandas" que
sejam de fato minhas — hoje a página mostra o workspace inteiro. Esta fase fecha a Frente B da Fase 7,
com a Frente A (funil por owner) já entregue em
[`2026-07-26-fase-7a-funil-por-owner.md`](2026-07-26-fase-7a-funil-por-owner.md).

A estratégia é aditiva: `assigneeId String?` com FK `ON DELETE SET NULL` em `Client`, `Deal`, `Task` e
`Activity` — coluna nullable, sem backfill, sem janela de risco. O escopo por registro é aplicado na
camada `application`/`infra`, **não** no `AccessGuard`: o guard decide antes de tocar o recurso e nunca
vê o `:id`. O precedente exato é `DashboardService.summary`, hoje o único lugar do backend que consulta
permissão fora do guard.

Duas travas de segurança não têm rede de proteção no banco e são obrigatórias na aplicação: (a) `assigneeId`
referencia `User`, tabela **sem RLS** — nem a FK nem a policy de `Deal`/`Task`/`Activity`/`Client` impedem
apontar o responsável para alguém de outra workspace; (b) o escopo por registro não é expressável na policy
`owner_isolation`, que só compara `ownerId`.

## Current State

- Nenhum modelo de negócio tem FK para `User`. `userId` só existe em tabelas de identidade.
- Catálogo em [`shared/permissions.ts`](../../apps/api/src/shared/permissions.ts): 14 chaves em
  `recurso:ver` / `recurso:gerenciar`, 6 categorias. `PermissionMeta.hidden` existe e nunca foi usado.
- `AccessContext` já carrega `userId` **e** `ownerId` — o escopo por usuário não exige mudança de contrato.
- `GET /collaborators` não serve ao seletor de responsável: `@RequirePermission('colaborador:gerenciar')`
  no nível da classe e `where: { ownerId }` exclui o owner (que tem `ownerId = null`).
- `MinhasDemandasPage` chama `useMyBoard()` → `GET /tasks/board` sem `projectId` → todas as tarefas do
  workspace, filtradas no cliente. `PipelineBoardPage` não tem filtro nenhum.
- `queryKeys.deals.board` e `queryKeys.tasks.myBoard` são **constantes sem params**.
- Os quatro `UpdateDto` derivam do `CreateDto` via `PartialType` → o campo novo propaga sozinho.

Detalhes completos no PRD.

## Desired End State

1. `Client`, `Deal`, `Task` e `Activity` têm `assigneeId String?` com FK para `User`
   (`ON DELETE SET NULL`) e índice `@@index([ownerId, assigneeId])`.
2. Três chaves novas no catálogo: `cliente:ver_todos`, `oportunidade:ver_todas`, `demanda:ver_todas`.
   Papéis não-`system` **já existentes** recebem, por migration de dados, as chaves cujo módulo eles já
   enxergam — preservando exatamente o comportamento atual.
3. `GET /workspace/members` devolve owner + colaboradores ativos (`{ id, name, isOwner }`), sem exigir
   permissão além de sessão válida.
4. Atribuir e trocar responsável funciona nos quatro recursos, com **validação de pertencimento à
   workspace** na aplicação. Só colaborador `ACTIVE` (convite aceito) pode ser atribuído.
5. Listagens, boards **e leitura de detalhe** respeitam o escopo: sem a chave `:ver_todos` do recurso, a
   pessoa vê apenas os registros atribuídos a ela **ou sem responsável**. Escritas seguem governadas
   apenas pelas chaves `:gerenciar` de hoje.
6. Filtro `?assigneeId=` nas listagens dos quatro recursos.
7. Dashboard: escopo automático nos blocos de oportunidades, demandas e próximas ações, mais um
   alternador "Somente meus" para quem tem a chave ampla.
8. Interface: seletor de responsável nos quatro formulários, responsável visível nos cards, filtro
   "Atribuídos a mim" nos dois boards, tudo persistido na URL.
9. `ENDPOINTS.md`, `SPEC.md` e `ROADMAP.md` (Fase 7, Frente B) refletem o novo estado.

## What We're NOT Doing

- **Escopo por registro nas escritas.** Sem `:ver_todos`, editar/mover um registro alheio continua
  permitido por `:gerenciar`. Decisão explícita: o ROADMAP pede corte de **visibilidade**, e ampliar para
  escrita dobraria a superfície da fase.
- **Filtro "sem responsável"** (`?assigneeId=none`). O ROADMAP pede `?assigneeId=<uuid>`; o sentinela de
  "não atribuído" fica para quando houver demanda real.
- **Reatribuição automática ao desativar colaborador** — decisão 5 registrada na Frente A: o registro
  mantém o nome de quem foi desativado, sem zerar histórico.
- **Migrar `TaskFormDialog` para RHF + Zod.** O campo novo segue o padrão já existente no arquivo
  (`setField` + PATCH imediato). A divergência é dívida conhecida e sai do escopo desta fase.
- **`assigneeId` em `Proposal`, `Project`, `Contract`, `Payment`.** O ROADMAP nomeia quatro modelos.
- **Roteamento automático de lead novo** — é a Fase 15, que declara depender desta.
- **Notificação de "registro atribuído a você"** — é a Fase 10.

---

## Fase 1: Banco e catálogo de permissões

### Goal

`assigneeId` existe nos quatro modelos e as três chaves de escopo existem no catálogo, com os papéis já
existentes preservando o comportamento atual. Nada muda de comportamento ainda — a fase é aditiva pura.

### Changes

#### 1.1 Prisma schema

**Modify**: `apps/api/prisma/schema.prisma`

Em `model User`, junto das back-relations existentes (depois de `pipelineStages`, adicionada na Frente A):

```prisma
  ownedRoles         Role[]         @relation("OwnerRoles")
  pipelineStages     PipelineStage[]
  assignedClients    Client[]
  assignedDeals      Deal[]
  assignedTasks      Task[]
  assignedActivities Activity[]
  invites            CollaboratorInvite[]
```

Relações **sem nome**: cada uma é a única relação entre `User` e o modelo em questão (diferente de
`Role`, que precisa de `"OwnerRoles"` por também ter `users User[]`).

Em cada um dos quatro modelos, o mesmo par de linhas + índice. `Client` (após `archivedAt`):

```prisma
  // Responsável pelo registro. Opcional: registro sem responsável é visível para
  // quem só enxerga os próprios (ver `shared/record-scope.ts`). `SetNull` porque
  // apagar um usuário não pode apagar o dado de negócio do owner.
  assigneeId String?
  assignee   User?     @relation(fields: [assigneeId], references: [id], onDelete: SetNull)
```

e, junto dos `@@index` existentes:

```prisma
  @@index([ownerId, assigneeId])
```

Repetir exatamente nos modelos `Deal`, `Task` e `Activity` (o comentário completo só no primeiro; nos
outros três, `// Responsável pelo registro — ver Client.assigneeId.`).

#### 1.2 Migration escrita à mão

Gerar o diretório e escrever o SQL à mão — o diff automático do Prisma não faz a migration de dados dos
papéis:

```bash
pnpm --filter api exec prisma migrate dev --create-only --name assignee_per_record
```

> Ambiente não interativo bloqueia `migrate dev`. Se falhar, crie o diretório à mão:
> `mkdir -p apps/api/prisma/migrations/20260727100000_assignee_per_record` — o que importa é o timestamp
> ficar **depois** de `20260726120000_pipeline_stages_per_owner`.

**Create**: `apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql`

```sql
-- Responsável por registro: assigneeId em Client, Deal, Task e Activity.
--
-- Notas de projeto:
--  * Colunas nullable, sem backfill: registro legado nasce sem responsável, e
--    "sem responsável" é visível para quem só vê os próprios (ver record-scope.ts).
--    Nenhum board fica vazio no dia do deploy.
--  * ON DELETE SET NULL: apagar um usuário não apaga o dado de negócio do owner.
--    (Hoje colaborador é desativado, não apagado — mas a FK precisa ser correta.)
--  * A FK garante que assigneeId aponta para um User existente; NÃO garante que
--    ele é da mesma workspace — User não tem RLS. Essa validação é da aplicação
--    (ver WorkspaceMembersService.assertMember).
--  * Índice composto (ownerId, assigneeId): toda listagem já filtra por owner e
--    passa a filtrar por responsável.
--  * Roda como crm_user (superuser), que bypassa RLS.

-- ===========================================================================
-- 1. Coluna + índice + FK nos quatro modelos
-- ===========================================================================
ALTER TABLE "Client"   ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "Deal"     ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "Task"     ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "assigneeId" TEXT;

CREATE INDEX "Client_ownerId_assigneeId_idx"   ON "Client"("ownerId", "assigneeId");
CREATE INDEX "Deal_ownerId_assigneeId_idx"     ON "Deal"("ownerId", "assigneeId");
CREATE INDEX "Task_ownerId_assigneeId_idx"     ON "Task"("ownerId", "assigneeId");
CREATE INDEX "Activity_ownerId_assigneeId_idx" ON "Activity"("ownerId", "assigneeId");

ALTER TABLE "Client" ADD CONSTRAINT "Client_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- 2. Papéis existentes preservam o comportamento atual
-- ===========================================================================
-- O papel `system` ("Administrador") e o owner valem ALL_PERMISSION_KEYS, resolvido
-- em tempo de execução no AccessService — as chaves novas já entram lá de graça.
-- Papéis CUSTOMIZADOS não: sem esta migration, o "Comercial" (e qualquer papel real
-- em produção) passaria a perder de vista os registros conforme fossem atribuídos.
--
-- Cada chave é concedida apenas a quem já enxerga o módulo correspondente — assim
-- um papel só-financeiro não ganha chave inerte de cliente poluindo o editor.
-- `&&` é o operador de sobreposição de arrays do Postgres.
UPDATE "Role" SET "permissions" = array_append("permissions", 'cliente:ver_todos')
 WHERE "system" = false
   AND NOT ('cliente:ver_todos' = ANY("permissions"))
   AND ("permissions" && ARRAY['cliente:ver','cliente:gerenciar']);

UPDATE "Role" SET "permissions" = array_append("permissions", 'oportunidade:ver_todas')
 WHERE "system" = false
   AND NOT ('oportunidade:ver_todas' = ANY("permissions"))
   AND ("permissions" && ARRAY['oportunidade:ver','oportunidade:gerenciar']);

UPDATE "Role" SET "permissions" = array_append("permissions", 'demanda:ver_todas')
 WHERE "system" = false
   AND NOT ('demanda:ver_todas' = ANY("permissions"))
   AND ("permissions" && ARRAY['projeto:ver','projeto:gerenciar','demanda:gerenciar']);
```

#### 1.3 Catálogo de permissões

**Modify**: `apps/api/src/shared/permissions.ts`

Três chaves novas, cada uma logo após as do seu recurso, na categoria existente. **Não** usar `hidden`:
a fase entrega a funcionalidade completa e o editor de papéis precisa expô-las.

```ts
  // Clientes — inclui contatos e atividades (timeline), que são client-scoped.
  {
    key: 'cliente:ver',
    …
  },
  {
    key: 'cliente:gerenciar',
    …
  },
  {
    key: 'cliente:ver_todos',
    label: 'Ver clientes de todos',
    description:
      'Ver clientes e atividades de qualquer responsável — sem esta permissão, vê apenas os seus e os sem responsável',
    category: 'Clientes',
  },
```

```ts
  {
    key: 'oportunidade:ver_todas',
    label: 'Ver oportunidades de todos',
    description:
      'Ver oportunidades de qualquer responsável — sem esta permissão, vê apenas as suas e as sem responsável',
    category: 'Pipeline',
  },
```

```ts
  {
    key: 'demanda:ver_todas',
    label: 'Ver demandas de todos',
    description:
      'Ver demandas de qualquer responsável — sem esta permissão, vê apenas as suas e as sem responsável',
    category: 'Operação',
  },
```

> `ALL_PERMISSION_KEYS` é derivado de `PERMISSIONS` — owner e papel `system` recebem as três
> automaticamente, sem migration.

#### 1.4 Seed de desenvolvimento

**Modify**: `apps/api/prisma/seed.ts`

O papel "Comercial" do seed é recriado a cada `migrate reset` a partir da lista literal — a migration de
dados não o alcança num banco novo. Acrescentar as duas chaves coerentes com o que ele já tem:

```ts
      permissions: [
        'cliente:ver',
        'cliente:gerenciar',
        'cliente:ver_todos',
        'oportunidade:ver',
        'oportunidade:gerenciar',
        'oportunidade:ver_todas',
        'proposta:ver',
        'proposta:gerenciar',
      ],
```

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api exec prisma validate` — schema válido.
- [x] `pnpm --filter api exec prisma migrate reset --force` — aplica tudo do zero e roda o seed sem erro.
- [x] `pnpm --filter api build` e `pnpm --filter api test` — verdes (nada de comportamento mudou).
- [x] Colunas, índices e FKs presentes nos quatro modelos:
      ```bash
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        "SELECT table_name FROM information_schema.columns WHERE column_name = 'assigneeId' ORDER BY 1;"
      ```
      → `Activity`, `Client`, `Deal`, `Task`.
- [x] FK com `SET NULL` nas quatro:
      ```bash
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        "SELECT conrelid::regclass AS tabela, confdeltype FROM pg_constraint WHERE conname LIKE '%_assigneeId_fkey' ORDER BY 1;"
      ```
      → quatro linhas, `confdeltype = n` (SET NULL).
- [x] O papel "Comercial" do seed tem as chaves novas:
      ```bash
      docker compose exec -T postgres psql -U crm_user -d crm_db -c \
        "SELECT name, permissions FROM \"Role\" WHERE system = false;"
      ```
      → contém `cliente:ver_todos` e `oportunidade:ver_todas`, **não** contém `demanda:ver_todas`
      (o papel não tem nenhuma chave de Operação).
- [x] `GET /permissions` lista 17 chaves:
      `grep -c "key: '" apps/api/src/shared/permissions.ts` → `17`.

#### Manual Verification

- [ ] Abrir Organização → Papéis → editar "Comercial": as três chaves novas aparecem nas categorias
      certas, com "Ver clientes de todos" e "Ver oportunidades de todos" **já marcadas**.
- [ ] O CRM continua funcionando exatamente como antes em todas as telas (a fase é aditiva).

**⏸ PAUSE**: após a verificação automatizada passar, pare para confirmação manual antes da Fase 2.

---

## Fase 2: Backend — atribuição, filtro e escopo

### Goal

Atribuir responsável nos quatro recursos com validação de pertencimento, filtrar por `?assigneeId=`, e
aplicar o escopo por permissão em listagens, boards, leitura de detalhe e dashboard.

### Changes

#### 2.1 Recorte por responsável (helper compartilhado)

**Create**: `apps/api/src/shared/record-scope.ts`

O ponto de aplicação do escopo por registro. Fica em `shared/` porque é consumido por quatro módulos de
negócio e pelo dashboard.

```ts
import type { AccessContext } from '../modules/access/domain/access-context';

/**
 * Recorte por responsável de uma leitura.
 *
 *  - `all`               → sem restrição (tem a chave `:ver_todos`, ou é owner).
 *  - `mine`              → estritamente os do usuário (alternador "Somente meus").
 *  - `mineOrUnassigned`  → os do usuário **mais** os sem responsável. É o escopo de
 *    quem não tem a chave ampla: registro sem responsável é visível para todos, senão
 *    o lead novo ficaria invisível (e o roteamento da Fase 15 não teria de onde partir).
 */
export type AssigneeScope =
  | { kind: 'all' }
  | { kind: 'mine'; userId: string }
  | { kind: 'mineOrUnassigned'; userId: string };

/** Sem recorte — para chamadas internas entre módulos (validação de posse). */
export const ALL_RECORDS: AssigneeScope = { kind: 'all' };

/**
 * Decide o recorte de uma leitura. O `AccessGuard` já liberou a rota; aqui a
 * consulta é estreitada — mesmo desenho de `DashboardService.summary`.
 *
 * `onlyMine` (alternador da interface) sempre vence: é o recorte mais estrito, e
 * aplicá-lo a quem já é restrito apenas remove os sem responsável.
 *
 * Owner e papel `system` recebem `:ver_todos` via `ALL_PERMISSION_KEYS`, então
 * caem em `all` sem verificação especial.
 */
export function resolveAssigneeScope(
  access: AccessContext,
  seeAllKey: string,
  onlyMine = false,
): AssigneeScope {
  if (onlyMine) return { kind: 'mine', userId: access.userId };
  return access.permissions.includes(seeAllKey)
    ? { kind: 'all' }
    : { kind: 'mineOrUnassigned', userId: access.userId };
}

/**
 * Fragmento de `where` do Prisma, ou `null` quando não há recorte.
 *
 * **Sempre componha com `AND: [fragmento]`**, nunca por spread no objeto raiz: o
 * `where` de `Client` já usa `OR` para a busca textual, e um segundo `OR` no mesmo
 * nível sobrescreveria o primeiro silenciosamente.
 */
export function assigneeScopeWhere(
  scope: AssigneeScope,
):
  | { assigneeId: string }
  | { OR: [{ assigneeId: string }, { assigneeId: null }] }
  | null {
  switch (scope.kind) {
    case 'all':
      return null;
    case 'mine':
      return { assigneeId: scope.userId };
    case 'mineOrUnassigned':
      return { OR: [{ assigneeId: scope.userId }, { assigneeId: null }] };
  }
}
```

**Create**: `apps/api/src/shared/record-scope.spec.ts` — cobre as três resoluções e a composição do
`where` (ver Testing Strategy).

#### 2.2 Módulo `workspace` — membros da workspace

Módulo novo, pequeno e focado. **Não** entra em `collaborators`: aquele módulo importa `AuthModule` e
`MailModule`, e os quatro módulos de negócio passariam a arrastar esse grafo só para validar
pertencimento. Este depende apenas do `PrismaModule` (global).

**Create**: `apps/api/src/modules/workspace/domain/workspace-member.repository.ts`

```ts
export const WORKSPACE_MEMBER_REPOSITORY = Symbol('WORKSPACE_MEMBER_REPOSITORY');

/** Pessoa da workspace como o seletor de responsável precisa — nada além disso. */
export interface WorkspaceMember {
  id: string;
  name: string;
  isOwner: boolean;
}

export interface WorkspaceMemberRepository {
  /** Owner + colaboradores ativos com convite aceito, ordenados por nome. */
  findManyByOwner(ownerId: string): Promise<WorkspaceMember[]>;
  /** O usuário é membro atribuível desta workspace (owner ou colaborador ACTIVE)? */
  isMember(ownerId: string, userId: string): Promise<boolean>;
}
```

**Create**: `apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts`

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  WorkspaceMember,
  WorkspaceMemberRepository,
} from '../domain/workspace-member.repository';

/**
 * "Membro atribuível" = o owner (ownerId nulo) **ou** um colaborador dele que já
 * aceitou o convite e está ativo. Convite pendente (`acceptedAt` nulo) e
 * colaborador desativado ficam de fora: não podem receber atribuição nova.
 *
 * `User` não tem RLS — este `where` é a única barreira, não há policy por trás.
 */
const membersOf = (ownerId: string): Prisma.UserWhereInput => ({
  OR: [
    { id: ownerId, ownerId: null },
    { ownerId, active: true, acceptedAt: { not: null } },
  ],
});

@Injectable()
export class PrismaWorkspaceMemberRepository
  implements WorkspaceMemberRepository
{
  constructor(private prisma: PrismaService) {}

  async findManyByOwner(ownerId: string): Promise<WorkspaceMember[]> {
    const rows = await this.prisma.db.user.findMany({
      where: membersOf(ownerId),
      orderBy: { name: 'asc' },
      select: { id: true, name: true, ownerId: true },
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      isOwner: u.ownerId === null,
    }));
  }

  async isMember(ownerId: string, userId: string): Promise<boolean> {
    const found = await this.prisma.db.user.findFirst({
      where: { AND: [{ id: userId }, membersOf(ownerId)] },
      select: { id: true },
    });
    return found !== null;
  }
}
```

**Create**: `apps/api/src/modules/workspace/application/workspace-members.service.ts`

```ts
import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  type WorkspaceMember,
  type WorkspaceMemberRepository,
} from '../domain/workspace-member.repository';

@Injectable()
export class WorkspaceMembersService {
  constructor(
    @Inject(WORKSPACE_MEMBER_REPOSITORY)
    private readonly repo: WorkspaceMemberRepository,
  ) {}

  list(ownerId: string): Promise<WorkspaceMember[]> {
    return this.repo.findManyByOwner(ownerId);
  }

  /**
   * Trava obrigatória antes de gravar `assigneeId`: `assigneeId` referencia `User`,
   * que **não** tem RLS, então nem a FK nem a policy do próprio registro impedem
   * apontar o responsável para alguém de outra workspace.
   *
   * `null`/`undefined` passa direto — limpar o responsável é sempre válido.
   */
  async assertMember(ownerId: string, userId?: string | null): Promise<void> {
    if (!userId) return;
    if (!(await this.repo.isMember(ownerId, userId))) {
      throw new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      );
    }
  }
}
```

**Create**: `apps/api/src/modules/workspace/api/workspace-members.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { WorkspaceMembersService } from '../application/workspace-members.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';

/**
 * Sem `@RequirePermission`: qualquer pessoa que possa atribuir um registro precisa
 * escolher entre os membros, e exigir `colaborador:gerenciar` (como faz
 * `GET /collaborators`) fecharia o seletor para quem só cuida de demandas. O shape
 * é mínimo de propósito — nome e id, sem e-mail, papel ou situação de convite.
 * Mesmo desenho de `GET /permissions`.
 */
@Controller('workspace')
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get('members') list(@CurrentOwnerId() ownerId: string) {
    return this.members.list(ownerId);
  }
}
```

**Create**: `apps/api/src/modules/workspace/workspace.module.ts`

```ts
import { Module } from '@nestjs/common';
import { WorkspaceMembersController } from './api/workspace-members.controller';
import { WorkspaceMembersService } from './application/workspace-members.service';
import { WORKSPACE_MEMBER_REPOSITORY } from './domain/workspace-member.repository';
import { PrismaWorkspaceMemberRepository } from './infra/prisma-workspace-member.repository';

/**
 * Quem são as pessoas da workspace. Exporta o service porque os módulos de negócio
 * precisam validar pertencimento antes de gravar `assigneeId`.
 */
@Module({
  controllers: [WorkspaceMembersController],
  providers: [
    WorkspaceMembersService,
    {
      provide: WORKSPACE_MEMBER_REPOSITORY,
      useClass: PrismaWorkspaceMemberRepository,
    },
  ],
  exports: [WorkspaceMembersService],
})
export class WorkspaceModule {}
```

**Modify**: `apps/api/src/app.module.ts` — registrar `WorkspaceModule` na lista de `imports`, junto dos
demais módulos de negócio.

#### 2.3 DTOs

**Modify**: os quatro DTOs de criação. O mesmo bloco em cada um; os `UpdateDto` herdam via `PartialType`.

- `apps/api/src/modules/clients/api/dto/create-client.dto.ts`
- `apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts`
- `apps/api/src/modules/projects/api/dto/create-task.dto.ts`
- `apps/api/src/modules/activities/api/dto/create-activity.dto.ts`

```ts
  /**
   * Responsável. `null` limpa o campo; ausente preserva. `@IsOptional()` do
   * class-validator ignora `null` **e** `undefined`, então o `@IsUUID` só roda
   * quando vem um valor de verdade.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string | null;
```

> `create-client.dto.ts` ainda não importa `IsUUID` — acrescentar ao import de `class-validator`.

**Modify**: os quatro DTOs de listagem, com o filtro explícito:

- `list-clients-query.dto.ts`, `list-deals-query.dto.ts`, `list-tasks-query.dto.ts`,
  `list-activities-query.dto.ts`

```ts
  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string;
```

> `list-clients-query.dto.ts` também precisa do import de `IsUUID`.

#### 2.4 Convenção de assinatura (vale para os quatro módulos)

Regra única, para o /code não improvisar:

- **Métodos de leitura ganham um parâmetro final `scope: AssigneeScope = ALL_RECORDS`.** O default
  mantém intactos os chamadores internos entre módulos (`ClientsService.findOne` é chamado por Deals,
  Activities, Proposals e Projects apenas para validar posse — ali não há recorte por responsável).
- **O controller calcula o recorte** com `resolveAssigneeScope(access, CHAVE)` e o repassa. Isso exige
  trocar `@CurrentOwnerId()` por `@CurrentAccess()` nas rotas de leitura, usando `access.ownerId` onde
  antes havia `ownerId`.
- **Métodos de escrita não recebem `scope`** — escopo por registro não governa escrita nesta fase.
- Chave por recurso: `Client` e `Activity` → `cliente:ver_todos`; `Deal` → `oportunidade:ver_todas`;
  `Task` → `demanda:ver_todas`.

#### 2.5 Clients

**Modify**: `apps/api/src/modules/clients/domain/client.repository.ts`

```ts
import type { AssigneeScope } from '../../../shared/record-scope';

export interface ClientListFilter {
  ownerId: string;
  search?: string;
  status?: Client['status'];
  source?: NonNullable<Client['source']>;
  includeArchived?: boolean;
  /** Filtro explícito da query (`?assigneeId=`). */
  assigneeId?: string;
  /** Recorte por permissão — independente do filtro acima; os dois se somam. */
  scope: AssigneeScope;
  skip: number;
  take: number;
}
```

e `findById` ganha o recorte:

```ts
  findById(id: string, ownerId: string, scope?: AssigneeScope): Promise<Client | null>;
```

**Modify**: `apps/api/src/modules/clients/infra/prisma-client.repository.ts`

```ts
import { ALL_RECORDS, assigneeScopeWhere, type AssigneeScope } from '../../../shared/record-scope';

  findById(id: string, ownerId: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.client.findFirst({
      where: { id, ownerId, ...(scoped ? { AND: [scoped] } : {}) },
    });
  }

  async findManyAndCount(filter: ClientListFilter) {
    const scoped = assigneeScopeWhere(filter.scope);
    const where: Prisma.ClientWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.includeArchived ? {} : { archivedAt: null }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { tradeName: { contains: filter.search, mode: 'insensitive' } },
              { document: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // AND (não spread): o `OR` da busca acima seria sobrescrito por um segundo `OR`.
      ...(scoped ? { AND: [scoped] } : {}),
    };
    …
  }
```

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

Injetar o service novo e validar nos dois caminhos de escrita — este é o módulo onde o esquecimento é
invisível, porque `create`/`update` fazem **spread do DTO** e `assigneeId` chegaria ao Prisma sem passar
por validação nenhuma:

```ts
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { ALL_RECORDS, type AssigneeScope } from '../../../shared/record-scope';

  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly repo: ClientRepository,
    private readonly members: WorkspaceMembersService,
  ) {}

  async create(ownerId: string, dto: CreateClientDto): Promise<Client> {
    // `assigneeId` entra pelo spread do DTO — sem esta linha, iria ao banco sem validação.
    await this.members.assertMember(ownerId, dto.assigneeId);
    const document = await this.resolveDocument(ownerId, dto.document, dto.personType);
    return this.repo.create({ ...dto, document, ownerId });
  }

  async list(ownerId: string, query: ListClientsQueryDto, scope: AssigneeScope = ALL_RECORDS) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      status: query.status,
      source: query.source,
      assigneeId: query.assigneeId,
      scope,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async findOne(ownerId: string, id: string, scope: AssigneeScope = ALL_RECORDS): Promise<Client> {
    const client = await this.repo.findById(id, ownerId, scope);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  async update(ownerId: string, id: string, dto: UpdateClientDto): Promise<Client> {
    await this.members.assertMember(ownerId, dto.assigneeId);
    const existing = await this.findOne(ownerId, id);
    …
  }
```

**Modify**: `apps/api/src/modules/clients/clients.module.ts` — `imports: [WorkspaceModule]`.

**Modify**: `apps/api/src/modules/clients/api/clients.controller.ts` — as rotas de leitura passam a usar
`@CurrentAccess()`:

```ts
import { CurrentAccess, CurrentOwnerId } from '../../../shared/current-user.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { resolveAssigneeScope } from '../../../shared/record-scope';

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get()
  list(@CurrentAccess() access: AccessContext, @Query() query: ListClientsQueryDto) {
    return this.clients.list(
      access.ownerId,
      query,
      resolveAssigneeScope(access, 'cliente:ver_todos'),
    );
  }

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get(':id')
  findOne(@CurrentAccess() access: AccessContext, @Param('id') id: string) {
    return this.clients.findOne(
      access.ownerId,
      id,
      resolveAssigneeScope(access, 'cliente:ver_todos'),
    );
  }
```

As rotas de tags e as de escrita continuam com `@CurrentOwnerId()`.

#### 2.6 Deals

Mesma forma. `apps/api/src/modules/pipeline/domain/deal.repository.ts`:

```ts
export interface DealListFilter {
  ownerId: string;
  clientId?: string;
  stageId?: string;
  search?: string;
  assigneeId?: string;
  scope: AssigneeScope;
  skip: number;
  take: number;
}

  findById(id: string, scope?: AssigneeScope): Promise<DealWithClient | null>;
  findAllForBoard(ownerId: string, scope?: AssigneeScope): Promise<DealWithClient[]>;
```

**Modify**: `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts`

```ts
  findById(id: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    // findFirst (não findUnique): o recorte faz parte da busca.
    return this.prisma.db.deal.findFirst({
      where: { id, ...(scoped ? { AND: [scoped] } : {}) },
      include: withClient,
    });
  }

  findAllForBoard(ownerId: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.deal.findMany({
      where: { client: { ownerId }, ...(scoped ? { AND: [scoped] } : {}) },
      include: withClient,
      orderBy: [{ stageId: 'asc' }, { position: 'asc' }],
    });
  }
```

e, em `findManyAndCount`, `...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {})` mais o
`AND: [scoped]`.

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts`

```ts
  constructor(
    @Inject(DEAL_REPOSITORY) private readonly repo: DealRepository,
    private readonly clients: ClientsService,
    private readonly stages: PipelineStagesService,
    private readonly projects: ProjectsService,
    private readonly members: WorkspaceMembersService,
  ) {}

  async create(ownerId: string, dto: CreateDealDto): Promise<DealWithClient> {
    await this.clients.findOne(ownerId, dto.clientId); // posse (sem recorte)
    await this.members.assertMember(ownerId, dto.assigneeId);
    const stage = dto.stageId
      ? await this.stages.findOne(ownerId, dto.stageId)
      : await this.stages.firstStage(ownerId);
    const position = (await this.repo.maxPositionInStage(stage.id)) + 1;
    return this.repo.create({
      ownerId,
      clientId: dto.clientId,
      stageId: stage.id,
      assigneeId: dto.assigneeId ?? null,
      …
    });
  }

  async update(ownerId: string, id: string, dto: UpdateDealDto): Promise<DealWithClient> {
    await this.loadOwned(ownerId, id);
    await this.members.assertMember(ownerId, dto.assigneeId);
    return this.repo.update(id, {
      …
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
    });
  }
```

`list`, `board` e `findOne` ganham o `scope` opcional; `loadOwned` ganha o parâmetro e o repassa a
`repo.findById`:

```ts
  async findOne(ownerId: string, id: string, scope: AssigneeScope = ALL_RECORDS) {
    return this.loadOwned(ownerId, id, scope);
  }

  private async loadOwned(ownerId: string, id: string, scope: AssigneeScope = ALL_RECORDS) {
    const deal = await this.repo.findById(id, scope);
    if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
    await this.clients.findOne(ownerId, deal.clientId);
    return deal;
  }
```

> `move`, `update` e `delete` chamam `loadOwned` **sem** scope — escrita não é recortada.

**Modify**: `apps/api/src/modules/pipeline/pipeline.module.ts` — acrescentar `WorkspaceModule` aos
`imports`.

**Modify**: `apps/api/src/modules/pipeline/api/deals.controller.ts` — `list`, `board` e `findOne`
passam a `@CurrentAccess()` + `resolveAssigneeScope(access, 'oportunidade:ver_todas')`.

#### 2.7 Tasks

Mesma forma, com a chave `demanda:ver_todas`.

- `domain/task.repository.ts`: `TaskListFilter` ganha `assigneeId?` e `scope`; `findById`,
  `findAllForBoard(projectId, scope?)` e `findAllForBoardByOwner(ownerId, scope?)` ganham o recorte.
- `infra/prisma-task.repository.ts`: `AND: [scoped]` nos três `where`.
- `application/tasks.service.ts`: injeta `WorkspaceMembersService`; `create` valida e grava
  `assigneeId: dto.assigneeId ?? null`; `update` valida e acrescenta
  `...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {})`; `list`, `board`, `findOne`
  e `loadOwned` ganham `scope`.
- `projects.module.ts`: `imports: [ClientsModule, WorkspaceModule]`.
- `api/tasks.controller.ts`: `list`, `board`, `findOne` com `@CurrentAccess()`.

> O board de projeto (`GET /tasks/board?projectId=`) também é recortado — é uma listagem como as outras.

#### 2.8 Activities

Além do responsável, **corrigir a assimetria** apontada no PRD: é o único dos quatro repositórios sem
filtro de `ownerId` na aplicação (depende só do RLS).

**Modify**: `apps/api/src/modules/activities/domain/activity.repository.ts`

```ts
export interface ActivityListFilter {
  /** Defesa em profundidade: o RLS já fecha, mas o repositório não depende disso. */
  ownerId: string;
  clientId?: string;
  dealId?: string;
  assigneeId?: string;
  scope: AssigneeScope;
  skip: number;
  take: number;
}

  findById(id: string, scope?: AssigneeScope): Promise<Activity | null>;
```

**Modify**: `apps/api/src/modules/activities/infra/prisma-activity.repository.ts`

```ts
  async findManyAndCount(filter: ActivityListFilter) {
    const scoped = assigneeScopeWhere(filter.scope);
    const where: Prisma.ActivityWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.dealId ? { dealId: filter.dealId } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(scoped ? { AND: [scoped] } : {}),
    };
    …
  }
```

**Modify**: `apps/api/src/modules/activities/application/activities.service.ts` — injeta
`WorkspaceMembersService`, valida em `create`/`update`, grava `assigneeId: dto.assigneeId ?? null`,
passa `ownerId` ao filtro e propaga `scope` em `list`/`loadOwned`.

**Modify**: `apps/api/src/modules/activities/activities.module.ts` — `WorkspaceModule` nos `imports`.

**Modify**: `apps/api/src/modules/activities/api/activities.controller.ts` — `list` com
`@CurrentAccess()` e `resolveAssigneeScope(access, 'cliente:ver_todos')`.

#### 2.9 Dashboard

**Create**: `apps/api/src/modules/dashboard/api/dto/summary-query.dto.ts`

```ts
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class SummaryQueryDto {
  /** Alternador "Somente meus" — recorta os blocos ao usuário logado. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  onlyMine?: boolean;
}
```

**Modify**: `apps/api/src/modules/dashboard/domain/dashboard.repository.ts` — as cinco consultas com
responsável ganham o recorte:

```ts
  funnel(ownerId: string, scope?: AssigneeScope): Promise<FunnelStageRow[]>;
  tasksInProgressCount(ownerId: string, scope?: AssigneeScope): Promise<number>;
  tasksOverdueCount(ownerId: string, now: Date, scope?: AssigneeScope): Promise<number>;
  upcomingTasks(ownerId: string, now: Date, until: Date, take: number, scope?: AssigneeScope): Promise<UpcomingTaskRow[]>;
  upcomingActions(ownerId: string, take: number, scope?: AssigneeScope): Promise<UpcomingActionRow[]>;
```

> Propostas ficam de fora: `Proposal` não tem responsável nesta fase.

**Modify**: `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts` — em cada uma, o
`AND: [scoped]`. Atenção ao `funnel`: o recorte vai no `groupBy` dos deals, **não** na leitura dos
estágios (estágio é do owner, não de uma pessoa):

```ts
  async funnel(ownerId: string, scope: AssigneeScope = ALL_RECORDS): Promise<FunnelStageRow[]> {
    const scoped = assigneeScopeWhere(scope);
    const [stages, grouped] = await Promise.all([
      this.prisma.db.pipelineStage.findMany({
        where: { ownerId },
        orderBy: { order: 'asc' },
      }),
      this.prisma.db.deal.groupBy({
        by: ['stageId'],
        where: { client: { ownerId }, ...(scoped ? { AND: [scoped] } : {}) },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    …
  }
```

**Modify**: `apps/api/src/modules/dashboard/application/dashboard.service.ts`

```ts
  async summary(
    ownerId: string,
    access: AccessContext,
    onlyMine = false,
  ) {
    const may = (...keys: string[]) => keys.some((k) => access.permissions.includes(k));
    const mayDeals = may('oportunidade:ver', 'oportunidade:gerenciar');
    …
    // Cada bloco tem a sua chave de escopo; o alternador vale para os três.
    const dealScope = resolveAssigneeScope(access, 'oportunidade:ver_todas', onlyMine);
    const taskScope = resolveAssigneeScope(access, 'demanda:ver_todas', onlyMine);
    const clientScope = resolveAssigneeScope(access, 'cliente:ver_todos', onlyMine);

    const w = buildWindows(new Date());
    const [funnel, proposals, demands, upcomingActions] = await Promise.all([
      mayDeals ? this.funnelBlock(ownerId, dealScope) : null,
      mayProposals ? this.proposalsBlock(ownerId, w) : null,
      mayTasks ? this.demandsBlock(ownerId, w, taskScope) : null,
      mayClients ? this.repo.upcomingActions(ownerId, UPCOMING_TAKE, clientScope) : [],
    ]);
    return { funnel, proposals, demands, upcomingActions };
  }
```

`funnelBlock` e `demandsBlock` repassam o `scope` às consultas.

**Modify**: `apps/api/src/modules/dashboard/api/dashboard.controller.ts`

```ts
  @Get('summary') summary(
    @CurrentOwnerId() ownerId: string,
    @CurrentAccess() access: AccessContext,
    @Query() query: SummaryQueryDto,
  ) {
    return this.dashboard.summary(ownerId, access, query.onlyMine ?? false);
  }
```

#### 2.10 Testes de unidade

**Create**: `apps/api/src/shared/record-scope.spec.ts`

```ts
describe('resolveAssigneeScope', () => {
  const access = (permissions: string[]): AccessContext => ({
    userId: 'u1', ownerId: 'o1', isOwner: false,
    roleId: 'r1', roleName: 'Comercial',
    permissions: permissions as never,
  });

  it('sem a chave ampla, restringe aos próprios e aos sem responsável', () => {
    expect(resolveAssigneeScope(access([]), 'oportunidade:ver_todas')).toEqual({
      kind: 'mineOrUnassigned', userId: 'u1',
    });
  });

  it('com a chave ampla, não restringe', () => {
    expect(
      resolveAssigneeScope(access(['oportunidade:ver_todas']), 'oportunidade:ver_todas'),
    ).toEqual({ kind: 'all' });
  });

  it('onlyMine vence a chave ampla (alternador é o recorte mais estrito)', () => {
    expect(
      resolveAssigneeScope(access(['oportunidade:ver_todas']), 'oportunidade:ver_todas', true),
    ).toEqual({ kind: 'mine', userId: 'u1' });
  });

  it('onlyMine também estreita quem já era restrito (tira os sem responsável)', () => {
    expect(resolveAssigneeScope(access([]), 'oportunidade:ver_todas', true)).toEqual({
      kind: 'mine', userId: 'u1',
    });
  });
});

describe('assigneeScopeWhere', () => {
  it('devolve null em `all` (nada a compor)', () => {
    expect(assigneeScopeWhere({ kind: 'all' })).toBeNull();
  });

  it('inclui os sem responsável em `mineOrUnassigned`', () => {
    expect(assigneeScopeWhere({ kind: 'mineOrUnassigned', userId: 'u1' })).toEqual({
      OR: [{ assigneeId: 'u1' }, { assigneeId: null }],
    });
  });
});
```

**Create**: `apps/api/src/modules/workspace/application/workspace-members.service.spec.ts`

```ts
  it('aceita responsável ausente sem consultar o repositório', async () => {
    await expect(service.assertMember('o1', null)).resolves.toBeUndefined();
    expect(repo.isMember).not.toHaveBeenCalled();
  });

  it('rejeita responsável de fora da workspace com 422', async () => {
    repo.isMember.mockResolvedValue(false);
    await expect(service.assertMember('o1', 'u-de-outro-owner')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
```

**Modify**: `deals.service.spec.ts`, `tasks.service.spec.ts` (se existir), `clients.service.spec.ts`,
`activities.service.spec.ts` — acrescentar `members: { assertMember: jest.fn() }` ao construtor mockado
e um caso por módulo: "valida o responsável antes de gravar".

**Modify**: `apps/api/src/modules/dashboard/application/dashboard.service.spec.ts` (se existir) — a
assinatura de `summary` mudou.

#### 2.11 `ENDPOINTS.md`

**Modify**: `apps/api/ENDPOINTS.md`

- Seção nova **Workspace**, antes de "Permissões":

```markdown
## Workspace

### GET /workspace/members
- **Propósito:** Listar as pessoas da workspace (owner + colaboradores ativos) para o seletor de responsável.
- **Auth:** Bearer (access token). Sem permissão específica — qualquer sessão válida.
- **Body:** —
- **Resposta:** `200 { id, name, isOwner }[]`, ordenado por nome. Convite pendente e colaborador desativado ficam de fora.
- **Erros:** `401`.
- **Handler:** `modules/workspace/api/workspace-members.controller.ts` → `WorkspaceMembersController.list`
```

- Nos endpoints de **Clients**, **Deals**, **Tasks** e **Activities**: acrescentar `assigneeId?: uuid | null`
  ao Body de criação/edição, `assigneeId?: uuid` à query das listagens, e o erro
  `422 Responsável inválido: escolha alguém da sua equipe.` nas rotas de escrita.
- Nas rotas de leitura dos quatro, acrescentar ao Propósito a nota de escopo:
  "Sem `<chave>:ver_todos`, devolve apenas os registros do usuário e os sem responsável."
- Em `GET /dashboard/summary`: query `onlyMine?: boolean`, com a mesma nota de escopo.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api build` — compila.
- [x] `pnpm --filter api test` — verde, incluindo `record-scope.spec.ts` e o spec do service novo.
- [x] `pnpm --filter api lint` — sem erro novo (o erro pré-existente em `main.ts` não conta).
- [x] A rota nova responde e traz o owner:
      ```bash
      curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/workspace/members | jq
      ```
      → inclui um item com `"isOwner": true`.
- [x] Nenhum `where` compõe o recorte por spread (o bug do `OR` sobrescrito):
      ```bash
      grep -rn 'assigneeScopeWhere' apps/api/src --include=*.ts | grep -v 'AND: \[' | grep -v 'record-scope'
      ```
      → só as linhas de `const scoped = …`.
- [x] Cobertura de doc: `grep -c 'WorkspaceMembersController\.' apps/api/ENDPOINTS.md` → `1`.

#### Manual Verification

- [ ] `POST /deals` com `assigneeId` de um colaborador ativo → `201`, campo gravado.
- [ ] `POST /deals` com `assigneeId` de um usuário **de outro owner** →
      `422 Responsável inválido: escolha alguém da sua equipe.`
- [ ] `POST /clients` com `assigneeId` inválido → `422` (confirma que o spread do DTO não escapou da validação).
- [ ] `PATCH /deals/:id` com `"assigneeId": null` → limpa o responsável; sem o campo no body → preserva.
- [ ] Colaborador **com** `oportunidade:ver_todas`: `GET /deals` devolve tudo, como hoje.
- [ ] Colaborador **sem** a chave: `GET /deals` devolve só os atribuídos a ele e os sem responsável;
      `GET /deals/:id` de um deal atribuído a outra pessoa → `404`.
- [ ] `GET /deals?assigneeId=<id>` filtra corretamente para quem tem a chave ampla.
- [ ] `GET /dashboard/summary?onlyMine=true` reduz funil, demandas e próximas ações; propostas não mudam.
- [ ] `GET /workspace/members` não lista colaborador com convite pendente nem desativado.

**⏸ PAUSE**: pare para confirmação manual antes da Fase 3.

---

## Fase 3: Frontend — atribuição, exibição e filtros

### Goal

Atribuir responsável nas quatro telas, ver quem é responsável nos cards, e recortar os dois boards e o
dashboard por pessoa, com o recorte persistido na URL.

### Changes

#### 3.1 Lookup de membros

**Create**: `apps/web/src/lib/members-lookup.ts`

Espelha `clients-lookup.ts`. Fica em `lib/` porque quatro features o consomem — e a regra de
`apps/web/CLAUDE.md` proíbe uma feature importar o interior de outra.

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface WorkspaceMember {
  id: string;
  name: string;
  isOwner: boolean;
}

export const membersLookupApi = {
  list: () => api.get<WorkspaceMember[]>('/workspace/members').then((r) => r.data),
};

/** Membros da workspace para os seletores de responsável. Lista curta e estável. */
export function useWorkspaceMembers() {
  return useQuery({
    queryKey: queryKeys.workspaceMembers,
    queryFn: membersLookupApi.list,
    staleTime: 5 * 60 * 1000,
  });
}

/** Sentinela do item "Sem responsável" — o `Select` do base-ui não aceita valor vazio. */
export const NO_ASSIGNEE = 'none';

/**
 * Mapa value→rótulo que o `Select` usa para exibir o nome no gatilho (senão mostra
 * o id cru). Inclui o responsável atual mesmo que ele não esteja mais na lista de
 * membros (desativado depois de atribuído — decisão: não zerar o histórico).
 */
export function buildMemberItems(
  members: WorkspaceMember[],
  current?: { id: string; name: string } | null,
): Record<string, string> {
  const items: Record<string, string> = { [NO_ASSIGNEE]: 'Sem responsável' };
  for (const m of members) items[m.id] = m.name;
  if (current) items[current.id] = current.name;
  return items;
}
```

#### 3.2 Query keys parametrizadas

**Modify**: `apps/web/src/lib/query-keys.ts`

`deals.board` e `tasks.myBoard` viram funções — sem isso o cache de "atribuídos a mim" sobrescreve o de
"todos", e o optimistic update de `useMoveDeal`/`useMoveMyTask` escreve no recorte errado.

```ts
  deals: {
    all: ['deals'] as const,
    board: (params: object = {}) => ['deals', 'board', params] as const,
    byClient: (clientId: string) => ['deals', 'client', clientId] as const,
  },
  …
  tasks: {
    all: ['tasks'] as const,
    board: (projectId: string) => ['tasks', 'board', projectId] as const,
    myBoard: (params: object = {}) => ['tasks', 'board', 'me', params] as const,
    …
  },
  …
  workspaceMembers: ['workspace', 'members'] as const,
```

> Os `invalidateQueries({ queryKey: queryKeys.deals.all })` existentes continuam cobrindo todos os
> recortes — prefixo não muda.

#### 3.3 Tipos

**Modify**: `apps/web/src/features/pipeline/api/types.ts`

```ts
/** Responsável, quando houver. Shape mínimo devolvido junto do registro. */
export interface Assignee { id: string; name: string }

export interface Deal {
  …
  assigneeId?: string | null;
  assignee?: Assignee | null;
}

export interface CreateDealBody {
  …
  assigneeId?: string | null;
}
```

Idem em `features/demandas/api/types.ts` (`Task`, `CreateTaskBody`, `UpdateTaskBody`, `ListTasksParams`)
e `features/clientes/api/types.ts` (`Client`, `Activity`, bodies e params).

> O backend precisa **incluir** o responsável na resposta para o card mostrar o nome. Acrescentar
> `assignee: { select: { id: true, name: true } }` aos `include` de `withClient` (deals),
> `withProject` (tasks) e às leituras de `Client`/`Activity` — ajuste da Fase 2 que se confirma aqui.
> Se o /code chegou à Fase 3 sem isso, volte e inclua: é o mesmo commit conceitual.

#### 3.4 Seletor reutilizável

**Create**: `apps/web/src/components/ui/assignee-select.tsx`

Quatro formulários usam o mesmo controle; ele sobe para `components/ui` em vez de ser copiado.

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { buildMemberItems, NO_ASSIGNEE, useWorkspaceMembers } from '@/lib/members-lookup';

interface Props {
  /** `null`/ausente = sem responsável. */
  value?: string | null;
  onValueChange: (assigneeId: string | null) => void;
  /** Responsável atual, para o gatilho exibir o nome de quem já não é membro. */
  current?: { id: string; name: string } | null;
}

export function AssigneeSelect({ value, onValueChange, current }: Props) {
  const { data: members } = useWorkspaceMembers();
  const items = buildMemberItems(members ?? [], current);
  return (
    <Select<string>
      items={items}
      value={value ?? NO_ASSIGNEE}
      onValueChange={(v) => onValueChange(!v || v === NO_ASSIGNEE ? null : v)}
    >
      <SelectTrigger placeholder="Sem responsável" />
      <SelectContent>
        <SelectItem value={NO_ASSIGNEE}>Sem responsável</SelectItem>
        {(members ?? []).map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

#### 3.5 Formulários

**Modify**: `apps/web/src/features/pipeline/DealFormDialog.tsx` — campo novo no schema e no form.
`assigneeId` é opcional, então **sem** asterisco na label:

```ts
const schema = z.object({
  …
  assigneeId: z.string().nullable().optional(),
});
```

```tsx
            <Field>
              <FieldLabel>Responsável</FieldLabel>
              <Controller
                control={control}
                name="assigneeId"
                render={({ field }) => (
                  <AssigneeSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    current={deal?.assignee}
                  />
                )}
              />
            </Field>
```

com `assigneeId: deal?.assigneeId ?? null` no `reset` e `assigneeId: v.assigneeId ?? null` no body.

**Modify**: `apps/web/src/features/clientes/ClientFormDialog.tsx` — mesmo bloco (o body é
`Partial<Client>`, então propaga sozinho).

**Modify**: `apps/web/src/features/demandas/TaskFormDialog.tsx` — **adaptado ao padrão do arquivo**
(decisão registrada): `FormState` ganha `assigneeId: string | null`, e o campo entra na coluna lateral
com PATCH imediato na edição:

```tsx
              <Field>
                <FieldLabel>Responsável</FieldLabel>
                <AssigneeSelect
                  value={form.assigneeId}
                  onValueChange={(assigneeId) => setField({ assigneeId }, { assigneeId })}
                  current={task?.assignee}
                />
              </Field>
```

com `assigneeId: task.assigneeId ?? null` em `fromTask`, `assigneeId: null` em `emptyForm`, e
`assigneeId: form.assigneeId` no `createTask.mutateAsync`.

**Modify**: `apps/web/src/features/clientes/tabs/TimelineTab.tsx` — o form inline ganha o campo, com
**default = usuário logado** (decisão 3):

```ts
const { data: me } = useMe();
…
  defaultValues: { type: 'NOTE', content: '', scheduledFor: '', assigneeId: me?.id ?? null },
```

e o `reset` após submeter preserva o default. O campo entra na primeira linha, ao lado de "Tipo".

#### 3.6 Responsável nos cards

**Modify**: `apps/web/src/features/pipeline/components/DealCard.tsx` — o nome do responsável ao lado do
cliente, discreto:

```tsx
      <span className="text-xs text-muted-foreground">
        {deal.client.name}
        {deal.assignee && <> · {deal.assignee.name}</>}
      </span>
```

**Modify**: `apps/web/src/features/demandas/components/TaskCard.tsx` — mesma ideia, no rodapé do card.

> Sem avatar: não há foto de usuário no produto, e uma inicial em círculo seria componente novo fora do
> escopo desta fase.

#### 3.7 Filtro nos boards

**Modify**: `apps/web/src/features/pipeline/PipelineBoardPage.tsx`

O board não tinha filtro nenhum; ganha o mesmo padrão de `MinhasDemandasPage` (`useUrlFilters`):

```ts
const PIPELINE_FILTERS = {
  assignee: stringFilter(), // '' = todos; id do membro; 'me' resolvido no envio
};
```

Na prática, um `Select` com "Todos os responsáveis" / "Atribuídos a mim" / cada membro, cujo valor vai
para `useBoard({ assigneeId })`. O default é **todos** (decisão 2) — quem não tem a chave ampla já recebe
o recorte do backend, sem precisar de UI.

**Modify**: `apps/web/src/features/pipeline/api/hooks.ts`

```ts
export function useBoard(params: { assigneeId?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.deals.board(params),
    queryFn: () => dealsApi.board(params),
  });
}
```

e `useMoveDeal(params)` passa a receber os mesmos params, para o optimistic update escrever na chave
ativa:

```ts
export function useMoveDeal(params: { assigneeId?: string } = {}) {
  const qc = useQueryClient();
  const key = queryKeys.deals.board(params);
  …
}
```

**Modify**: `apps/web/src/features/pipeline/api/deals.api.ts` — `board` passa a aceitar params e enviá-los
como query.

**Modify**: `apps/web/src/features/demandas/MinhasDemandasPage.tsx` — acrescentar `assignee` ao
`DEMANDAS_FILTERS` e o `Select` correspondente na toolbar (que já tem quatro controles). O valor vai para
`useMyBoard({ assigneeId })`; `useMoveMyTask(params)` recebe os mesmos params.

> A filtragem por responsável é **do servidor** (ao contrário de cliente/prioridade/projeto/prazo, que
> continuam client-side): o recorte precisa valer também para quem não tem a chave ampla, e isso só o
> backend garante.

#### 3.8 Dashboard

**Modify**: `apps/web/src/features/dashboard/DashboardPage.tsx` — alternador "Somente meus" ao lado do
`MonthPicker`, persistido na URL, visível apenas para quem tem alguma das chaves amplas (quem não tem já
está recortado e o controle não faria nada):

```tsx
const { can } = useCan();
const seesAll = can('oportunidade:ver_todas') || can('demanda:ver_todas') || can('cliente:ver_todos');
…
{seesAll && (
  <Button
    variant={onlyMine ? 'default' : 'outline'}
    onClick={() => set({ onlyMine: !onlyMine })}
  >
    Somente meus
  </Button>
)}
```

**Modify**: `apps/web/src/features/dashboard/api/hooks.ts` e `query-keys.ts` —
`dashboard.summary` vira `(params: object = {}) => ['dashboard','summary', params]`, e o hook envia
`onlyMine`.

#### 3.9 Documentação

**Modify**: `SPEC.md`

- §4: acrescentar `assigneeId String?` aos quatro modelos.
- §5 (tabela de endpoints): linha nova `| Workspace | GET /workspace/members |`.

**Modify**: `ROADMAP.md`

- Marcar os cinco itens da **Frente B** e trocar o status da Fase 7 para `✅ concluída`, tanto no
  cabeçalho da seção quanto na tabela de panorama (linha 28), apontando os dois planos.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter web build` — compila (pega toda query key que ficou sem params).
- [x] `pnpm --filter api build`, `pnpm --filter api test` — verdes.
- [x] Nenhuma query key de board usada como constante:
      ```bash
      grep -rn 'queryKeys.deals.board\b\|queryKeys.tasks.myBoard\b' apps/web/src | grep -v '('
      ```
      → nenhum resultado.
- [x] Nenhum rótulo de permissão duplicado no front:
      ```bash
      grep -rn 'Ver clientes de todos\|Ver oportunidades de todos\|Ver demandas de todos' apps/web/src
      ```
      → nenhum resultado (os textos vêm de `GET /permissions`).

#### Manual Verification

- [ ] Nas quatro telas (oportunidade, cliente, demanda, atividade), escolher um responsável, salvar e
      reabrir: o nome persiste.
- [ ] O seletor lista o owner e os colaboradores ativos, e **não** lista convite pendente/desativado.
- [ ] Card do pipeline e da demanda mostram o nome do responsável; sem responsável, não mostram nada.
- [ ] Registrar uma atividade na timeline sem tocar no campo: o responsável já vem como o usuário logado.
- [ ] Pipeline: alternar "Atribuídos a mim" recorta o quadro, a URL muda, e voltar de uma tela de detalhe
      preserva o recorte.
- [ ] Arrastar um card com o filtro ligado: o card não "pula" nem reaparece na coluna antiga
      (confirma que o optimistic update está na chave certa).
- [ ] "Minhas demandas" com o filtro ligado: mostra só as suas; os outros quatro filtros continuam
      funcionando combinados.
- [ ] Dashboard: "Somente meus" reduz funil, demandas e próximas ações; propostas não mudam.
- [ ] Colaborador **sem** `oportunidade:ver_todas`: abre `/pipeline` e vê só as suas e as sem
      responsável, sem alternador no dashboard.
- [ ] Desativar um colaborador que era responsável por um registro: o nome dele continua aparecendo no
      card e no formulário, mas ele some do seletor.

**⏸ PAUSE**: confirmação final antes de commitar/deployar.

---

## Testing Strategy

### Unit Tests

- `shared/record-scope.spec.ts` (novo) — as quatro resoluções de escopo e os três fragmentos de `where`.
  É o coração da fase: um erro aqui vaza dado ou esconde dado de todo mundo.
- `modules/workspace/application/workspace-members.service.spec.ts` (novo) — `assertMember` aceita
  nulo sem consultar, rejeita não-membro com `422`, aceita membro.
- `deals.service.spec.ts` / `clients.service.spec.ts` / `activities.service.spec.ts` /
  `tasks.service.spec.ts` — um caso por módulo garantindo que `assertMember` é chamado **antes** de
  gravar, e que `assigneeId` ausente no patch não zera o campo.
- `dashboard.service.spec.ts` — `onlyMine` propaga o escopo `mine` para os três blocos.
- Não há testes de repositório Prisma no projeto — a composição do `where` é verificada pelas consultas
  manuais da Fase 2.

### Integration Tests

Sem suíte e2e ativa. A verificação de integração é a matriz de permissão da Fase 2, executada com duas
sessões simultâneas (um owner e um colaborador com papel restrito):

1. Colaborador sem `:ver_todos` não lista, **nem lê por id**, registro atribuído a outra pessoa.
2. Registro sem responsável é visível para os dois.
3. `assigneeId` de outra workspace é rejeitado com `422` nos quatro recursos.
4. O alternador do dashboard recorta os três blocos e não afeta propostas.

### Migration & Rollback

**Aplicação**: a migration é aditiva (colunas nullable, índices, FKs) e não reescreve dado de negócio —
risco muito menor que o da Frente A. O único `UPDATE` toca `Role.permissions` de papéis não-`system`.

1. Backup por precaução (`pg_dump`), embora não haja passo destrutivo.
2. Registrar o estado dos papéis antes:
   ```sql
   SELECT "id", "name", "permissions" FROM "Role" WHERE "system" = false ORDER BY "name";
   ```
3. `prisma migrate deploy` (o deploy da API já roda).
4. Conferir que cada papel ganhou exatamente as chaves coerentes com o que já tinha, repetindo a consulta.

**Rollback**: `DROP` das quatro colunas (o dado de responsável se perde, nada mais) e
`array_remove` das três chaves nos papéis. Como nenhum dado pré-existente é reescrito, o rollback é
seguro — ao contrário do da Frente A.

**Ordem no release**: as três fases saem juntas. A Fase 1 sozinha é inerte; a Fase 2 sem a 3 entrega a
API sem interface para usá-la.

## Environment Considerations

- **CI/CD**: nenhum passo novo; o deploy já roda `prisma migrate deploy`.
- **Migrations**: uma nova, `20260727100000_assignee_per_record`. Não é reentrante (o `ADD COLUMN` falha
  na segunda execução), que é o comportamento padrão do `_prisma_migrations`.
- **Config/Secrets**: nenhuma variável nova.
- **Multi-environment**: em desenvolvimento, `prisma migrate reset --force` cobre tudo. Em produção há
  papéis reais — é neles que a migration de dados atua.
- **Downtime**: `ADD COLUMN` nullable não reescreve a tabela no Postgres 16; `CREATE INDEX` sem
  `CONCURRENTLY` pega lock de escrita por alguns milissegundos no volume atual. Aplicar fora do pico
  ainda assim.

## Dependencies & Risks

- **Nenhuma dependência nova.**
- **Risco médio — o `where` composto por spread.** Um `{ OR: … }` do recorte espalhado no mesmo nível do
  `OR` da busca textual de `Client` sobrescreveria a busca **sem erro nenhum**. Mitigado por: o helper
  devolver o fragmento nu, a regra de compor sempre com `AND: [ ]`, e uma verificação automatizada por
  grep na Fase 2.
- **Risco médio — colisão de cache nos boards.** Query key sem params faz o recorte "meus" sobrescrever
  o "todos" e o optimistic update escrever no lugar errado. Mitigado por transformar as duas chaves em
  funções e por um teste manual específico de arraste com filtro ligado.
- **Risco baixo — papel customizado em produção com combinação inesperada.** A migration concede a chave
  só a quem já enxerga o módulo; um papel só-financeiro não ganha nada, o que é o correto.
- **Risco baixo — `assigneeId` apontando para usuário de outra workspace.** Não há trava no banco (`User`
  sem RLS, FK só garante existência). Mitigado por `assertMember` nos quatro serviços, com teste de
  unidade por módulo e verificação manual explícita.
- **Contrato para as Fases 14 e 15.** "Resultado por responsável" (14) e "roteamento do lead novo" (15)
  consomem este modelo. `assigneeId` nullable com FK `SET NULL` e o conceito de `AssigneeScope` são o
  contrato que elas herdam.
- **Dívida consciente que permanece**: `TaskFormDialog` segue fora do padrão RHF/Zod, e escrita continua
  sem escopo por registro. Ambas registradas em *What We're NOT Doing*.

## References

- PRD: [`specs/research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md`](../research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md)
- Frente A (implementada): [`specs/plans/2026-07-26-fase-7a-funil-por-owner.md`](2026-07-26-fase-7a-funil-por-owner.md) — em especial "Decisões registradas para a Frente B"
- Origem da exclusão de permissão por registro: [`specs/plans/2026-07-25-colaboradores-e-papeis.md`](2026-07-25-colaboradores-e-papeis.md) (`:66`)
- Origem de "Minhas demandas": [`specs/plans/2026-07-23-fase-4-demandas.md`](2026-07-23-fase-4-demandas.md) (`:1527-1560`)
- PostgreSQL 16 — Row Security Policies: <https://www.postgresql.org/docs/16/ddl-rowsecurity.html>
  (integridade referencial bypassa RLS — por isso a validação de pertencimento é da aplicação)
