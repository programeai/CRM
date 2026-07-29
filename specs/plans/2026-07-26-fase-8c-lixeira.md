---
date: 2026-07-26T22:15:00-03:00
author: claude
source_prd: specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md
git_commit: 35421684362649ab861746eaf7c0fa8bc5932265
branch: main
status: implemented
tags: [spec, lixeira, soft-delete, permissoes, prisma]
---

# Spec: Fase 8C — Lixeira (soft delete, restauração e expurgo)

## Overview

Hoje `archivedAt` existe em **exatamente um** modelo (`Client`, [schema.prisma:160](../../apps/api/prisma/schema.prisma#L160)), e `Deal`, `Project`, `Task` e `Contact` são apagados de vez. Esta fase generaliza o soft delete para os quatro, acrescenta restauração e expurgo definitivo sob permissão própria, e concentra tudo numa página `/lixeira`.

A frente parece a mais simples e é a que **mais toca superfície**. O filtro de arquivados vive num único `where` de repositório hoje (`includeArchived ? {} : { archivedAt: null }`); replicá-lo nos quatro modelos significa revisar **todas** as leituras: listagens paginadas, os dois quadros Kanban (`/deals/board`, `/tasks/board`), o "Minhas demandas" cross-projeto, o `_count.tasks` do projeto, as agregações do dashboard (funil, demandas atrasadas, próximas entregas) e as travas de exclusão que contam filhos. Some-se que **não há como excluir uma oportunidade ou uma tarefa pela interface** — `useDeleteDeal` e `useDeleteTask` existem no data layer sem nenhum consumidor `.tsx` —, então a ação de arquivar nesses dois nasce do zero na UI.

E o expurgo esbarra em FKs `ON DELETE RESTRICT` em toda a cadeia de negócio: a ordem de remoção é regra, não detalhe.

## Current State

- `Client.archivedAt` + `@@index([ownerId, archivedAt])` ([schema.prisma:159-176](../../apps/api/prisma/schema.prisma#L159-L176)) — único soft delete.
- Filtro e ação em [prisma-client.repository.ts:41,82-84](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L41-L84); rota `POST /clients/:id/archive` ([clients.controller.ts:86](../../apps/api/src/modules/clients/api/clients.controller.ts#L86)) — **sem** rota de restaurar.
- Hard deletes: [deals.service.ts:146](../../apps/api/src/modules/pipeline/application/deals.service.ts#L146) (sem trava), [tasks.service.ts:134](../../apps/api/src/modules/projects/application/tasks.service.ts#L134) (sem trava), [projects.service.ts:89-97](../../apps/api/src/modules/projects/application/projects.service.ts#L89-L97) (`409` se tiver tarefas), [contacts.service.ts:55](../../apps/api/src/modules/contacts/application/contacts.service.ts#L55).
- Trava de estágio: [pipeline-stages.service.ts:101-109](../../apps/api/src/modules/pipeline/application/pipeline-stages.service.ts#L101-L109) — `409` se houver deals.
- Leituras a revisar: [prisma-deal.repository.ts](../../apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts), [prisma-task.repository.ts](../../apps/api/src/modules/projects/infra/prisma-task.repository.ts), [prisma-project.repository.ts](../../apps/api/src/modules/projects/infra/prisma-project.repository.ts), [prisma-contact.repository.ts](../../apps/api/src/modules/contacts/infra/prisma-contact.repository.ts), [prisma-dashboard.repository.ts](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts).
- Frontend: `archivedAt` já está no tipo `Client` ([types.ts:32](../../apps/web/src/features/clientes/api/types.ts#L32)) e **nunca é lido**; `ListClientsParams` não tem `includeArchived`. Único fluxo de arquivamento na UI: [ClienteDetalheLayout.tsx:181-219](../../apps/web/src/features/clientes/ClienteDetalheLayout.tsx#L181-L219). `useDeleteDeal` ([hooks.ts:56-62](../../apps/web/src/features/pipeline/api/hooks.ts#L56-L62)) e `useDeleteTask` ([hooks.ts:101-107](../../apps/web/src/features/demandas/api/hooks.ts#L101-L107)) não têm consumidor.
- `Contact` **não tem `createdAt` nem `updatedAt`** ([schema.prisma:180-192](../../apps/api/prisma/schema.prisma#L180-L192)).

## Desired End State

- `Deal`, `Project`, `Task` e `Contact` têm `archivedAt DateTime?` + `@@index([ownerId, archivedAt])`, no molde do `Client`.
- **Nenhuma leitura de negócio enxerga registro arquivado**: listagens, quadros, "Minhas demandas", `_count.tasks`, agregações do dashboard e validações de posse.
- `POST /<recurso>/:id/archive` e `POST /<recurso>/:id/restore` existem nos cinco recursos (os quatro novos + `Client`), sob a chave `:gerenciar` do módulo.
- `DELETE /<recurso>/:id` deixa de ser hard delete solto e passa a ser **expurgo**: exige `lixeira:expurgar`, só aceita registro já arquivado e responde `409` com mensagem clara quando há filho `RESTRICT`.
- `GET /trash` devolve a lixeira unificada, paginada e filtrável por tipo, sob `lixeira:ver`.
- A página `/lixeira` (categoria Organização) lista os arquivados dos cinco tipos, com "Restaurar" e "Excluir em definitivo".
- Arquivar está disponível na interface de todos os cinco — inclusive oportunidade e demanda, que hoje não têm ação nenhuma.
- Todas as seis ações (`ARQUIVAR`, `RESTAURAR`, `EXPURGAR`) entram na trilha da Fase 8B, que já tem os valores no enum.

## What We're NOT Doing

- **Arquivamento em cascata** — arquivar um projeto **não** arquiva as tarefas dele, e arquivar um cliente **não** arquiva deals/projetos. É exatamente o comportamento que o `Client` já tem hoje; generalizar a cascata mudaria a semântica de um fluxo em produção sem pedido do ROADMAP. A consequência conhecida (um projeto arquivado com tarefas ativas continua alimentando "Minhas demandas") fica registrada como comportamento, não bug.
- **Expurgo em cascata** — expurgar não apaga filhos. Filho `RESTRICT` presente → `409` com a instrução do que expurgar antes.
- **Cron de expurgo após N dias** — o expurgo é manual nesta fase. Nenhuma tabela do projeto tem política de retenção, e um cron que apaga dado de negócio sozinho é decisão de produto, não de implementação.
- **Soft delete em `Proposal`, `Contract`, `Payment` e `Activity`** — o ROADMAP nomeia quatro modelos. Proposta e contrato já têm status terminais (`REJECTED`/`EXPIRED`, `CANCELED`) que cumprem o papel; cobrança paga já não pode ser excluída por regra ([SPEC.md:188](../SPEC.md)).
- **Alterar o comportamento do estágio do funil** — a trava de `409` ao excluir um estágio continua contando **todos** os deals, inclusive arquivados. Ignorar arquivados violaria a FK `Deal.stageId` (`RESTRICT`) e responderia `500`. Só a mensagem muda.
- **Filtro "incluir arquivados" nas listagens normais** — o único lugar de ver arquivado é `/lixeira`. O `includeArchived` do `ClientListFilter` permanece como está (uso interno), sem virar query param.
- **Restaurar em lote** — uma ação por registro.

## Phase Ordering Note

Esta fase pressupõe a **Fase 8B implementada**: as chamadas `audit.registrar` das ações de arquivar/restaurar/expurgar assumem o `AuditService` existente e os valores `ARQUIVAR`/`RESTAURAR`/`EXPURGAR` já no enum `AuditAction`. Se por algum motivo 8C for antecipada, remover essas chamadas e reintroduzi-las depois — mas o caminho barato é respeitar a ordem.

---

## Phase 1: `archivedAt` no schema e filtro em todas as leituras

### Goal

Introduzir a coluna nos quatro modelos e fazer **todas** as leituras de negócio ignorarem arquivados — sem nenhuma forma de arquivar ainda, portanto sem mudança de comportamento observável.

### Changes

#### Banco

**Modify**: `apps/api/prisma/schema.prisma`

Em `Deal` (após `stageMovedAt`, linha 226), `Project` (após `dueDate`, linha 300), `Task` (após `completedAt`, linha 323) e `Contact` (após `isPrimary`, linha 189):

```prisma
  // --- soft delete (ver Client.archivedAt e o módulo trash) ---
  archivedAt DateTime?
```

E o índice composto no molde do `Client`, em cada um dos quatro:

```prisma
  @@index([ownerId, archivedAt])
```

**Create**: `apps/api/prisma/migrations/20260730100000_soft_delete_lixeira/migration.sql`

```sql
-- Soft delete em Deal, Project, Task e Contact — hoje só Client tem.
--
-- Notas de projeto:
--  * Coluna nullable e SEM backfill: `archivedAt IS NULL` é "ativo", que é o
--    estado de todo registro existente. Nenhum quadro fica vazio no deploy.
--  * Índice composto (ownerId, archivedAt) no molde do Client
--    (schema.prisma:176): toda listagem já filtra por owner e passa a filtrar
--    por arquivado.
--  * NÃO há cascata: arquivar um projeto não arquiva as tarefas dele, do mesmo
--    modo que arquivar um cliente hoje não arquiva os deals dele.
--  * As FKs continuam ON DELETE RESTRICT: é o expurgo (Fase 2) que precisa da
--    ordem correta, não o arquivamento.
--  * Roda como crm_user (superuser), que bypassa RLS.

ALTER TABLE "Deal"    ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Task"    ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Deal_ownerId_archivedAt_idx"    ON "Deal"("ownerId", "archivedAt");
CREATE INDEX "Project_ownerId_archivedAt_idx" ON "Project"("ownerId", "archivedAt");
CREATE INDEX "Task_ownerId_archivedAt_idx"    ON "Task"("ownerId", "archivedAt");
CREATE INDEX "Contact_ownerId_archivedAt_idx" ON "Contact"("ownerId", "archivedAt");
```

#### Convenção de filtro

**Create**: `apps/api/src/shared/soft-delete.ts`

Um único lugar definindo o fragmento — evita cinco variações do mesmo `where` e deixa o grep trivial.

```ts
/**
 * Soft delete: `archivedAt IS NULL` é o registro ativo.
 *
 * **Sempre componha com `AND: [fragmento]`**, nunca por spread no objeto raiz,
 * pela mesma razão do `assigneeScopeWhere` (ver `shared/record-scope.ts`): o
 * `where` de várias listagens já usa `OR` para a busca textual, e um segundo
 * `OR` no mesmo nível sobrescreveria o primeiro silenciosamente. Onde não há
 * `OR`, o spread é seguro e mais legível — o padrão do `Client` (`archivedAt:
 * null` direto no objeto) permanece válido.
 */
export const ATIVO = { archivedAt: null } as const;

/** Fragmento de leitura: `undefined` quando arquivados devem entrar. */
export function ativoWhere(includeArchived = false) {
  return includeArchived ? {} : ATIVO;
}
```

#### Repositórios

**Modify**: `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts`

- `findById` (linha 28) ganha um parâmetro explícito — restaurar e expurgar precisam **encontrar** o arquivado:

```ts
  findById(
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
    includeArchived = false,
  ) {
    const scoped = assigneeScopeWhere(scope);
    // findFirst (não findUnique): o recorte e o soft delete fazem parte da busca.
    return this.prisma.db.deal.findFirst({
      where: {
        id,
        ...ativoWhere(includeArchived),
        ...(scoped ? { AND: [scoped] } : {}),
      },
      include: withClient,
    });
  }
```

- `findManyAndCount` (linha 37): acrescentar `...ATIVO` ao `where`.
- `findAllForBoard` (linha 62): acrescentar `...ATIVO` ao `where`.
- `maxPositionInStage` (linha 91): `where: { stageId, ...ATIVO }` — um deal arquivado não deve reservar posição na coluna.
- `move` (linha 99): os dois `findMany` de reindexação (linhas 112 e 137) ganham `...ATIVO`, para que o arquivado não ocupe índice na coluna.
- Métodos novos:

```ts
  archive(id: string) {
    return this.prisma.db.deal.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: withClient,
    });
  }

  restore(id: string) {
    return this.prisma.db.deal.update({
      where: { id },
      data: { archivedAt: null },
      include: withClient,
    });
  }
```

(`delete` permanece como está — passa a ser chamado só pelo expurgo.)

**Modify**: `apps/api/src/modules/projects/infra/prisma-task.repository.ts`

- `findById` (:37): mesmo tratamento com `includeArchived`.
- `findManyAndCount` (:46), `findAllForBoard` (:78), `findAllForBoardByOwner` (:95): `...ATIVO`.
- `listOwnerTags` (:130) e `findByTag` (:140): `...ATIVO` — a tag de uma tarefa arquivada não deve aparecer no autocomplete.
- `removeTagFromAll` (:152): **sem** filtro, incluindo arquivados — mesma decisão já documentada no `Client` ("a tag deixa de existir em qualquer registro do dono"). Comentar.
- `maxPositionInStatus` (:170) e os dois `findMany` do `move` (:191 e :214): `...ATIVO`.
- `archive`/`restore` novos.

**Modify**: `apps/api/src/modules/projects/infra/prisma-project.repository.ts`

- `findById` (:22): passa de `findUnique` para `findFirst` com `...ativoWhere(includeArchived)`.
- `findManyAndCount` (:29) e `findByClient` (:51): `...ATIVO`.
- `countTasks` (:71): `where: { projectId, ...ATIVO }` — a trava de "projeto com tarefas" (que na Fase 2 vira trava de **expurgo**) só conta tarefas ativas… **não**. Ver a decisão abaixo:

```ts
  /**
   * Conta TODAS as tarefas, inclusive arquivadas: quem consome isto é a trava
   * de expurgo, e a FK `Task.projectId` é RESTRICT — apagar o projeto com uma
   * tarefa arquivada pendurada responderia 500 de FK. Para a contagem exibida
   * na listagem, ver `_count` em `withClient`.
   */
  async countTasks(projectId: string) {
    return this.prisma.db.task.count({ where: { projectId } });
  }
```

- O `_count: { select: { tasks: true } }` de `withClient` (:11) **precisa** excluir arquivadas — é o número que aparece no card do projeto:

```ts
const withClient = {
  client: { select: { id: true, name: true } },
  // Só tarefas ativas: é a contagem exibida no card do projeto. A trava de
  // expurgo usa `countTasks`, que conta tudo (FK RESTRICT).
  _count: { select: { tasks: { where: { archivedAt: null } } } },
} as const;
```

- `findByDealId` (:75): **inclui arquivados** de propósito:

```ts
  /**
   * Inclui projeto arquivado: este método é o dedupe do "criar-ao-ganhar"
   * (DealsService.move). Ignorar o arquivado faria uma segunda passagem pelo
   * estágio "Ganhou" criar um projeto duplicado.
   */
  findByDealId(dealId: string) {
    return this.prisma.db.project.findFirst({ where: { dealId }, include: withClient });
  }
```

- `archive`/`restore` novos.

**Modify**: `apps/api/src/modules/contacts/infra/prisma-contact.repository.ts`

- `findManyByClient` (:10), `countByClient` (:33) e `clearPrimary` (:37): `...ATIVO`. (Um contato arquivado não deve contar como "primeiro contato" nem ser rebaixado de principal.)
- `findById` (:17): `findFirst` com `includeArchived`.
- `archive`/`restore` novos.

**Modify**: `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts`

Quatro consultas passam a excluir arquivados:

- `funnel` (:24) — `deal.groupBy`, `where: { client: { ownerId }, ...ATIVO, … }`;
- `tasksInProgressCount` (:91), `tasksOverdueCount` (:102) e `upcomingTasks` (:118) — `...ATIVO` no `where` de `task`.

As consultas de `proposal`, `contract`, `payment` e `activity` ficam inalteradas (esses modelos não ganham soft delete).

**Modify**: `apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts`

`countDeals` permanece **sem** filtro de arquivado. Comentar o porquê:

```ts
  /**
   * Conta TODOS os deals do estágio, inclusive arquivados: a FK `Deal.stageId`
   * é RESTRICT, então apagar um estágio com deal arquivado pendurado
   * responderia 500. A mensagem de 409 avisa sobre a lixeira.
   */
```

**Modify**: `apps/api/src/modules/pipeline/application/pipeline-stages.service.ts:101-109`

Só a mensagem muda:

```ts
      throw new ConflictException(
        'Não é possível excluir um estágio que possui oportunidades, inclusive arquivadas. Mova ou expurgue as oportunidades antes.',
      );
```

**Modify**: as interfaces de repositório correspondentes em `domain/*.repository.ts`

`findById` ganha `includeArchived?: boolean`; `archive` e `restore` entram no contrato dos quatro (`DealRepository`, `TaskRepository`, `ProjectRepository`, `ContactRepository`).

#### Testes

**Modify**: `deals.service.spec.ts`, `tasks.service.spec.ts`, `projects.service.spec.ts`, `contacts.service.spec.ts`

Os mocks de repositório ganham `archive` e `restore`; nenhuma asserção nova nesta fase (não há caminho que os chame ainda). O que **muda** é o `findById`, que passa a receber um terceiro argumento — ajustar as asserções que verificam a chamada.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma migrate dev` e `prisma generate` — sem erro (migração aplicada manualmente + `prisma migrate resolve --applied` devido a um drift de checksum pré-existente e não relacionado nesta fase, numa migration antiga; `prisma migrate status` confirma "Database schema is up to date!")
- [x] `pnpm --filter api test` — toda a suíte passa com os mocks ajustados (274 testes)
- [x] `pnpm --filter api build` e `pnpm --filter api lint` — sem erros (lint tem 1 erro pré-existente em `main.ts`, não tocado nesta fase)
- [x] `grep -rn "prisma.db.deal.findMany\|prisma.db.task.findMany\|prisma.db.project.findMany\|prisma.db.contact.findMany" apps/api/src` — cada ocorrência tem `ATIVO`/`ativoWhere` no `where`, ou um comentário justificando a exceção (`removeTagFromAll`, `findByDealId`, `countTasks`, `countDeals`)

#### Manual Verification
- [ ] Com a coluna criada e **nada** arquivado, a aplicação inteira se comporta como antes: listagens de clientes/oportunidades/projetos/demandas, os dois quadros, "Minhas demandas", o dashboard e a timeline
- [ ] Marcar à mão `UPDATE "Deal" SET "archivedAt" = now() WHERE id = '…'`: o deal some do quadro `/pipeline`, da listagem, do funil do dashboard **e** do `GET /deals/:id` (404)
- [ ] Marcar à mão uma `Task`: some do quadro do projeto, de "Minhas demandas", de "demandas atrasadas" e de "próximas entregas"; o `_count` do card do projeto **diminui**
- [ ] Marcar à mão um `Project`: some da listagem e do `GET /projects/:id`; mover de novo o deal de origem para "Ganhou" **não** cria projeto duplicado
- [ ] Marcar à mão um `Contact`: some da aba Contatos; se era o principal, o cliente não fica com dois principais ao promover outro
- [ ] Arrastar cards no quadro do funil com um deal arquivado na coluna: as posições reindexam de 0..n-1 sem buraco
- [ ] `UPDATE` de volta para `NULL` restaura tudo — a fase é reversível por dado

**⏸ PAUSE**: Parar para confirmação humana antes de expor arquivamento e expurgo.

---

## Phase 2: Arquivar, restaurar e expurgar na API

### Goal

Trocar os hard deletes por arquivamento, criar restauração e expurgo sob permissão própria, e expor a lixeira unificada.

### Changes

#### Permissões

**Modify**: `apps/api/src/shared/permissions.ts`

Na categoria `Organização`, após `auditoria:ver` (Fase 8B):

```ts
  {
    key: 'lixeira:ver',
    label: 'Ver a lixeira',
    description:
      'Consultar os registros arquivados e restaurá-los para as listagens',
    category: 'Organização',
  },
  {
    key: 'lixeira:expurgar',
    label: 'Excluir em definitivo',
    description:
      'Apagar da lixeira, sem volta, um registro arquivado. Ação destrutiva e irreversível',
    category: 'Organização',
  },
```

**Sem migration de backfill**, mesma justificativa da Fase 8B: são chaves de governança sem módulo correspondente, e `lixeira:expurgar` é destrutiva — conceder automaticamente seria o oposto do desejado. Owner e papel `system` recebem em runtime. **Registrar a exceção ao Padrão 3 no PR.**

Arquivar e restaurar **não** ganham chave nova: continuam sob o `:gerenciar` do módulo (arquivar substitui excluir, que já era `:gerenciar`). Restaurar exige `lixeira:ver` **ou** o `:gerenciar` do recurso — na prática o controller pede o `:gerenciar` do recurso, porque é ele que devolve o registro à área de trabalho daquele módulo.

#### Regra de expurgo

**Create**: `apps/api/src/shared/purge.ts`

```ts
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

/**
 * Guardas do expurgo, compartilhadas pelos cinco recursos.
 *
 * Regra 1: só se expurga o que já está na lixeira. Sem isso, `DELETE /deals/:id`
 * continuaria sendo um hard delete de um registro ativo — exatamente o que esta
 * fase remove.
 *
 * Regra 2: nenhuma cascata. As FKs de negócio são ON DELETE RESTRICT e as
 * remoções em cascata do projeto são feitas à mão nos repositórios. Um expurgo
 * com filho pendurado responderia 500 de FK; aqui vira 409 com instrução.
 */
export function assertArquivado(archivedAt: Date | null, recurso: string): void {
  if (!archivedAt) {
    throw new UnprocessableEntityException(
      `Só é possível excluir em definitivo ${recurso} que já esteja na lixeira. Arquive antes.`,
    );
  }
}

export function assertSemFilhos(quantidade: number, mensagem: string): void {
  if (quantidade > 0) throw new ConflictException(mensagem);
}
```

#### Services

O molde é o mesmo nos cinco. `DealsService` como referência completa:

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts`

```ts
import { AuditService } from '../../audit/audit.service';
import { assertArquivado } from '../../../shared/purge';

  /** Manda a oportunidade para a lixeira. Substitui o antigo hard delete. */
  async archive(ownerId: string, id: string): Promise<DealWithClient> {
    const deal = await this.loadOwned(ownerId, id);
    const arquivado = await this.repo.archive(id);
    await this.audit.registrar({
      entity: 'DEAL',
      entityId: id,
      entityLabel: deal.title,
      action: 'ARQUIVAR',
    });
    return arquivado;
  }

  /** Devolve a oportunidade ao funil, na posição em que estava. */
  async restore(ownerId: string, id: string): Promise<DealWithClient> {
    const deal = await this.loadOwned(ownerId, id, ALL_RECORDS, true);
    const restaurado = await this.repo.restore(id);
    await this.audit.registrar({
      entity: 'DEAL',
      entityId: id,
      entityLabel: deal.title,
      action: 'RESTAURAR',
    });
    return restaurado;
  }

  /**
   * Expurgo: apaga de vez. `Proposal.dealId`, `Project.dealId` e
   * `Activity.dealId` são FKs opcionais com SET NULL, então nenhum filho
   * bloqueia — os registros vinculados sobrevivem sem a oportunidade.
   */
  async purge(ownerId: string, id: string): Promise<void> {
    const deal = await this.loadOwned(ownerId, id, ALL_RECORDS, true);
    assertArquivado(deal.archivedAt, 'uma oportunidade');
    await this.repo.delete(id);
    await this.audit.registrar({
      entity: 'DEAL',
      entityId: id,
      entityLabel: deal.title,
      action: 'EXPURGAR',
    });
  }
```

`loadOwned` ganha o quarto parâmetro:

```ts
  private async loadOwned(
    ownerId: string,
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
    includeArchived = false,
  ): Promise<DealWithClient> {
    const deal = await this.repo.findById(id, scope, includeArchived);
    if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
    await this.clients.findOne(ownerId, deal.clientId); // 404 se não for do dono
    return deal;
  }
```

O método `delete` público some do service — quem apaga agora é `purge`.

**Modify**: `apps/api/src/modules/projects/application/tasks.service.ts`

Idem, com `entity: 'TASK'`, `entityLabel: task.title`, mensagem "uma demanda". `Task` não tem filhos — expurgo direto.

**Modify**: `apps/api/src/modules/projects/application/projects.service.ts`

O `409` de hoje (linhas 89-97) **muda de lugar**: arquivar um projeto com tarefas é permitido (sem cascata); expurgar, não.

```ts
  /**
   * Expurgo. `Task.projectId` é FK obrigatória com RESTRICT: um projeto com
   * qualquer tarefa (ativa OU arquivada) não pode ser apagado. `Contract.projectId`
   * é opcional com SET NULL — contrato vinculado não bloqueia.
   */
  async purge(ownerId: string, id: string): Promise<void> {
    const project = await this.loadOwned(ownerId, id, true);
    assertArquivado(project.archivedAt, 'um projeto');
    assertSemFilhos(
      await this.repo.countTasks(id),
      'Não é possível excluir em definitivo um projeto que ainda tem demandas. Expurgue as demandas dele primeiro.',
    );
    await this.repo.delete(id);
    await this.audit.registrar({ entity: 'PROJECT', entityId: id, entityLabel: project.name, action: 'EXPURGAR' });
  }
```

**Modify**: `apps/api/src/modules/contacts/application/contacts.service.ts`

Idem, `entity: 'CONTACT'`, `entityLabel: contact.name`. Sem filhos.

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

`archive` já existe (só ganha o registro de auditoria na Fase 8B). Acrescentar `restore` e `purge`:

```ts
  /**
   * Expurgo de cliente. TODAS as FKs de filho para Client são RESTRICT
   * (contatos, atividades, oportunidades, propostas, projetos, contratos) — ver
   * specs/research/2026-07-21-fase-1-clientes.md:140. A contagem é somada e a
   * mensagem cita o que sobrou, senão o usuário tenta N vezes sem saber o motivo.
   */
  async purge(ownerId: string, id: string): Promise<void> {
    const client = await this.loadOwned(ownerId, id, true);
    assertArquivado(client.archivedAt, 'um cliente');
    const vinculos = await this.repo.countChildren(id);
    assertSemFilhos(
      vinculos.total,
      `Não é possível excluir em definitivo um cliente com registros vinculados (${vinculos.descricao}). Expurgue-os primeiro.`,
    );
    await this.repo.delete(id);
    await this.audit.registrar({ entity: 'CLIENT', entityId: id, entityLabel: client.name, action: 'EXPURGAR' });
  }
```

`ClientRepository.countChildren(id)` é novo: um `Promise.all` de seis `count` devolvendo `{ total, descricao }`, com a descrição montada em pt-BR ("3 oportunidades, 1 contrato").

#### Controllers

**Modify**: `apps/api/src/modules/pipeline/api/deals.controller.ts` (e os equivalentes de tasks, projects, contacts, clients)

```ts
  @RequirePermission('oportunidade:gerenciar')
  @Post(':id/archive')
  archive(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.archive(ownerId, id);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post(':id/restore')
  restore(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.restore(ownerId, id);
  }

  /**
   * Expurgo — destrutivo e irreversível. A chave é `lixeira:expurgar`, não a do
   * módulo: quem gerencia oportunidades pode arquivar, mas apagar de vez é uma
   * decisão de governança.
   */
  @RequirePermission('lixeira:expurgar')
  @Delete(':id')
  purge(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.purge(ownerId, id);
  }
```

**Mudança de contrato**: `DELETE /deals/:id`, `DELETE /tasks/:id`, `DELETE /projects/:id`, `DELETE /contacts/:id` deixam de ser hard delete sob a chave do módulo e passam a exigir `lixeira:expurgar` + registro já arquivado. É intencional. `DELETE /deals/:id` e `DELETE /tasks/:id` não têm consumidor na interface hoje; `DELETE /projects/:id` e `DELETE /contacts/:id` têm — a Fase 3 os troca por "Arquivar".

#### Módulo `trash`

**Create**: `apps/api/src/modules/trash/` (`trash.module.ts`, `domain/trash.repository.ts`, `application/trash.service.ts`, `infra/prisma-trash.repository.ts`, `api/trash.controller.ts`, `api/dto/list-trash-query.dto.ts`)

É um **read model** que atravessa cinco tabelas. O precedente é o `DashboardModule`, que já lê `deal`, `proposal`, `task`, `payment` e `activity` por um repositório próprio — mesma forma, mesma justificativa: agregar leituras de módulos diferentes num repositório de leitura é mais honesto que fazer cinco módulos exportarem services só para isso.

```ts
/** Tipo de registro na lixeira — o mesmo vocabulário do enum `AuditEntity`. */
export type TrashType = 'CLIENT' | 'CONTACT' | 'DEAL' | 'PROJECT' | 'TASK';

/** Linha da lixeira, uniformizada entre os cinco tipos. */
export interface TrashItem {
  type: TrashType;
  id: string;
  /** Rótulo humano do registro (nome do cliente, título do deal…). */
  label: string;
  /** Contexto: o cliente ou o projeto a que ele pertence. Vazio quando não há. */
  context: string | null;
  archivedAt: Date;
}
```

O repositório faz cinco `findMany` filtrando `{ ownerId, archivedAt: { not: null } }`, mapeia cada um para `TrashItem`, concatena, ordena por `archivedAt` desc e pagina **em memória**:

```ts
  /**
   * Paginação em memória, e não no banco: são cinco tabelas heterogêneas e uma
   * UNION em SQL cru fugiria do Prisma sem ganho real no volume esperado (uma
   * lixeira com centenas de itens já é sinal de que falta expurgar). Se um dia
   * o volume justificar, o caminho é um `$queryRaw` com UNION ALL — o contrato
   * de `TrashItem` já está desenhado para isso.
   *
   * `Contact` não tem `createdAt` (schema.prisma:180-192): ordenar por
   * "arquivado em" é o único critério que funciona para os cinco tipos.
   */
```

O filtro por `type` restringe **quais** consultas rodam (um tipo → uma consulta).

```ts
@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @RequirePermission('lixeira:ver')
  @Get()
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListTrashQueryDto) {
    return this.trash.list(ownerId, query);
  }
}
```

**Modify**: `apps/api/src/app.module.ts` — importar `TrashModule`.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md`

- Nas seções de cada recurso, as rotas `POST /:id/archive` e `POST /:id/restore` no formato fixo.
- Reescrever as entradas de `DELETE /deals/:id`, `/tasks/:id`, `/projects/:id`, `/contacts/:id` — o propósito passa a ser "excluir em definitivo (expurgo)", a permissão vira `lixeira:expurgar`, e a lista de erros ganha `422 Só é possível excluir em definitivo … que já esteja na lixeira.` e o `409` específico de cada um.
- Acrescentar `DELETE /clients/:id`, que não existia.
- Seção `## Lixeira` com `GET /trash`.

**Modify**: `docs/observabilidade.md` — nenhuma linha nova: as ações de lixeira vão para o `AuditLog` (Fase 8B), não para o log estruturado. Registrar essa decisão numa frase na seção de regras.

#### Testes

**Modify**: os quatro specs de service + `clients.service.spec.ts`

Por service:
- `archive` chama `repo.archive` e registra `ARQUIVAR`;
- `restore` encontra o arquivado (`findById` com `includeArchived: true`) e registra `RESTAURAR`;
- `purge` de registro **não** arquivado → `UnprocessableEntityException`;
- `purge` de registro de outro owner → `NotFoundException`;
- `ProjectsService.purge` com `countTasks > 0` → `ConflictException`;
- `ClientsService.purge` com vínculos → `ConflictException` com a descrição.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — todos os casos acima passam
- [x] `pnpm --filter api build` e `pnpm --filter api lint` — sem erros
- [ ] `curl -X POST .../deals/:id/archive` → `200` e o deal some de `GET /deals/board` — requer servidor rodando com sessão autenticada; não executado nesta implementação (ver verificação manual)
- [ ] `curl -X DELETE .../deals/:id` num deal **ativo** → `422` — idem
- [ ] `curl -X DELETE .../deals/:id` com token sem `lixeira:expurgar` → `403 Você não tem permissão para excluir em definitivo.` — idem
- [ ] `curl .../trash` com `lixeira:ver` devolve os cinco tipos ordenados por `archivedAt` desc — idem

#### Manual Verification
- [ ] Arquivar um cliente, um contato, uma oportunidade, um projeto e uma demanda: os cinco somem das telas de origem e aparecem em `GET /trash`
- [ ] Restaurar cada um: volta exatamente para onde estava (o deal reaparece na coluna e na posição, a tarefa no status)
- [ ] Expurgar uma demanda arquivada: some de vez; expurgar o projeto dela **em seguida** funciona
- [ ] Expurgar um projeto arquivado que ainda tem demandas: `409` com a mensagem que manda expurgar as demandas antes — e **nada** é apagado
- [ ] Expurgar um cliente arquivado com uma proposta vinculada: `409` citando o vínculo
- [ ] Expurgar uma oportunidade arquivada que tem proposta vinculada: **funciona**, e a proposta sobrevive com `dealId` nulo
- [ ] Cada arquivar/restaurar/expurgar gera a linha correspondente em `AuditLog` com o autor certo
- [ ] Um colaborador com `oportunidade:gerenciar` mas sem `lixeira:expurgar` consegue arquivar e **não** consegue expurgar

**⏸ PAUSE**: Parar para confirmação humana antes da interface.

---

## Phase 3: Interface — arquivar nas telas e a página `/lixeira`

### Goal

Dar acesso às três ações pela interface: arquivar onde o registro vive, restaurar e expurgar na lixeira.

### Changes

#### Camada de dados

**Modify**: `apps/web/src/lib/query-keys.ts`

```ts
  trash: {
    all: ['trash'] as const,
    list: (params: object) => ['trash', 'list', params] as const,
  },
```

**Modify**: `apps/web/src/features/pipeline/api/deals.api.ts` e `.../demandas/api/tasks.api.ts`, `projects.api.ts`, `.../clientes/api/clients.api.ts`, `.../clientes/api/contacts.api.ts`

Cada um ganha `archive(id)`, `restore(id)` e mantém `remove(id)` (que agora é o expurgo). Exemplo:

```ts
  archive: (id: string) => api.post<Deal>(`/deals/${id}/archive`).then((r) => r.data),
  restore: (id: string) => api.post<Deal>(`/deals/${id}/restore`).then((r) => r.data),
  /** Expurgo — exige `lixeira:expurgar` e registro já arquivado. */
  remove: (id: string) => api.delete(`/deals/${id}`).then((r) => r.data),
```

**Modify**: `apps/web/src/features/pipeline/api/hooks.ts`

`useDeleteDeal` (linhas 56-62) — hoje sem consumidor — vira `useArchiveDeal`, e nasce um consumidor de verdade:

```ts
export function useArchiveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dealsApi.archive(id),
    onSuccess: () => invalidateDeals(qc),
  });
}
```

O mesmo em `demandas/api/hooks.ts`: `useDeleteTask` → `useArchiveTask`; `useDeleteProject` → `useArchiveProject`. Nenhum hook de expurgo nesses arquivos — o expurgo mora só na feature `lixeira`.

**Create**: `apps/web/src/features/lixeira/api/types.ts`, `trash.api.ts`, `hooks.ts`

```ts
export type TrashType = 'CLIENT' | 'CONTACT' | 'DEAL' | 'PROJECT' | 'TASK';

export interface TrashItem {
  type: TrashType;
  id: string;
  label: string;
  context: string | null;
  archivedAt: string;
}
```

`useTrash(params)`; `useRestoreItem()` e `usePurgeItem()` despacham para a API do tipo (a restauração e o expurgo são rotas **do recurso**, não da lixeira):

```ts
/** Rota por tipo: restaurar e expurgar pertencem ao módulo dono do registro. */
const API_POR_TIPO: Record<TrashType, { restore: (id: string) => Promise<unknown>; purge: (id: string) => Promise<unknown> }> = {
  CLIENT: { restore: clientsApi.restore, purge: clientsApi.remove },
  CONTACT: { restore: contactsApi.restore, purge: contactsApi.remove },
  DEAL: { restore: dealsApi.restore, purge: dealsApi.remove },
  PROJECT: { restore: projectsApi.restore, purge: projectsApi.remove },
  TASK: { restore: tasksApi.restore, purge: tasksApi.remove },
};
```

Ambos invalidam `queryKeys.trash.all` **e** a raiz do domínio afetado (o registro volta às listagens).

Uma feature importando o `api.ts` de outra é a única exceção necessária ao "uma feature não importa o interior de outra" — a alternativa seria duplicar cinco clientes HTTP. Registrar o comentário no arquivo. (Se preferir rigor total, mover os cinco `*.api.ts` para `lib/` é uma refatoração maior, fora desta fase.)

#### Rótulos e navegação

**Modify**: `apps/web/src/lib/labels.ts`

```ts
export const TRASH_TYPE_LABELS = {
  CLIENT: 'Cliente',
  CONTACT: 'Contato',
  DEAL: 'Oportunidade',
  PROJECT: 'Projeto',
  TASK: 'Demanda',
} as const;
export const translateTrashType = make(TRASH_TYPE_LABELS);
```

**Modify**: `apps/web/src/app/nav.ts` — item na categoria Organização, ícone `Trash2`, `permission: ["lixeira:ver"]`.

**Modify**: `apps/web/src/routes/router.tsx` — `<PermissionRoute permission={['lixeira:ver']} />` com `{ path: '/lixeira', element: <LixeiraPage /> }`.

#### Ação "Arquivar" nas telas

**Modify**: `apps/web/src/features/pipeline/DealFormDialog.tsx`

O quadro `/pipeline` não tem nenhuma ação de exclusão hoje. O lugar natural é o rodapé do diálogo de edição, à esquerda dos botões de salvar — mesmo desenho do detalhe de cliente. Só em modo edição e só com `oportunidade:gerenciar`.

```tsx
<DialogFooter className="justify-between">
  {deal && can('oportunidade:gerenciar') ? (
    <Button type="button" variant="ghost" className="text-destructive" onClick={() => setArchiveOpen(true)}>
      <Archive data-icon="inline-start" />
      Arquivar
    </Button>
  ) : <span />}
  <div className="flex gap-2">{/* Cancelar + Salvar, como hoje */}</div>
</DialogFooter>
```

Com o `ConfirmDialog` correspondente ("Arquivar oportunidade" / "Ela sai do funil e vai para a lixeira, de onde pode ser restaurada."). Ao confirmar: toast, fecha o diálogo, invalida o quadro.

**Modify**: `apps/web/src/features/demandas/TaskFormDialog.tsx` — mesmo padrão, texto "Arquivar demanda".

**Modify**: `apps/web/src/features/demandas/ProjetoDetalhePage.tsx` (e/ou `ProjectFormDialog.tsx`) — o botão de excluir projeto existente passa a ser "Arquivar", chamando `useArchiveProject`. A mensagem do `ConfirmDialog` perde o aviso de irreversibilidade (arquivar não é destrutivo) e ganha a menção à lixeira.

**Modify**: `apps/web/src/features/clientes/tabs/ContatosTab.tsx` — o "Excluir" do contato vira "Arquivar", com o mesmo tratamento.

**Modify**: `apps/web/src/features/clientes/ClienteDetalheLayout.tsx:212-215` — a descrição do `ConfirmDialog` de arquivar passa a citar a lixeira:

```tsx
        description={`Tem certeza que deseja arquivar “${client.name}”? Ele sai das listagens e vai para a lixeira, de onde pode ser restaurado.`}
```

#### Página da lixeira

**Create**: `apps/web/src/features/lixeira/LixeiraPage.tsx`

Listagem canônica, no molde de `ClientesListPage`:

```tsx
const LIXEIRA_FILTERS = {
  type: enumFilter(['CLIENT', 'CONTACT', 'DEAL', 'PROJECT', 'TASK'] as const, 'ALL'),
  page: numberFilter(1),
};
const LIMIT = 20;
```

- Cabeçalho: título "Lixeira" e a linha de apoio "Registros arquivados. Restaure para devolvê-los às listagens ou exclua em definitivo — o que não tem volta."
- Filtro por tipo num `Select` do design system.
- Tabela: **Tipo** (`Badge` com `translateTrashType`), **Registro** (`label` + `context` em texto menor), **Arquivado em** (`formatDateTime`), **Ações**.
- Três estados no `TableBody`: erro (`TableEmpty` com "Falha ao carregar a lixeira."), carregando (5 linhas de `Skeleton className="h-5 w-full"`), vazio (`TableEmpty` com "A lixeira está vazia.").
- `Pagination` com `labelSingular="registro"` / `labelPlural="registros"`.
- Ações por linha: "Restaurar" (`variant="outline"`) sempre; "Excluir em definitivo" (`variant="ghost"` com `text-destructive`) só quando `can('lixeira:expurgar')`.
- Dois `ConfirmDialog`, um por ação. O de expurgo é enfático:

```tsx
      <ConfirmDialog
        open={!!purging}
        onOpenChange={(open) => !open && setPurging(null)}
        title="Excluir em definitivo?"
        description={`“${purging?.label}” será apagado do banco de dados. Esta ação não tem volta e o registro não poderá ser recuperado.`}
        confirmLabel="Excluir em definitivo"
        pendingLabel="Excluindo…"
        destructive
        pending={purge.isPending}
        onConfirm={() => void confirmPurge()}
      />
```

Erros de `409`/`422` da API são exibidos via `extractApiMessage(err, 'Falha ao excluir em definitivo.')` — as mensagens do backend já explicam o que expurgar antes, e é isso que o usuário precisa ler.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` (o `tsc -b` é o portão do frontend) e `pnpm --filter web lint` — sem erros
- [x] `grep -rn "useDeleteDeal\|useDeleteTask\|useDeleteProject" apps/web/src` — zero ocorrências (todos renomeados para `useArchive*`; `useDeleteContact` também renomeado para `useArchiveContact`, mesma lógica)

#### Manual Verification
- [ ] Arquivar uma oportunidade pelo `DealFormDialog`: o card some do quadro na hora e aparece em `/lixeira`
- [ ] Arquivar uma demanda, um projeto, um contato e um cliente: os cinco tipos aparecem em `/lixeira` com o rótulo, o contexto e a data corretos — **nenhum** identificador técnico cru na tela
- [ ] Filtrar por tipo: a lista restringe e o filtro fica na URL (navegar para outra tela e voltar preserva)
- [ ] Restaurar cada um: some da lixeira e reaparece na tela de origem (o deal na coluna certa, a demanda no status certo, o contato na aba, o cliente na listagem)
- [ ] Expurgar uma demanda: some de vez e não volta
- [ ] Expurgar um projeto que ainda tem demandas arquivadas: o toast mostra a mensagem do backend explicando o que expurgar antes
- [ ] Um colaborador **sem** `lixeira:ver` não vê o item de navegação e é redirecionado ao acessar `/lixeira` na barra de endereços
- [ ] Um colaborador **com** `lixeira:ver` e **sem** `lixeira:expurgar` vê a lista e o botão "Restaurar", mas **não** vê "Excluir em definitivo"
- [ ] O `ConfirmDialog` aberto de dentro do `DealFormDialog` não empilha dois modais (o de baixo é soterrado e volta com o formulário intacto)
- [ ] Tema claro e escuro; a tabela rola horizontalmente em tela estreita sem estourar o corpo da página

**⏸ PAUSE**: Fase 8C concluída — e, com ela, a Fase 8 inteira. Atualizar o `ROADMAP.md` marcando os itens.

---

## Testing Strategy

### Unit Tests

Instanciação direta com `jest.Mocked<Repository>`, como todo o repositório. Por service (`deals`, `tasks`, `projects`, `contacts`, `clients`):

- `archive` chama `repo.archive` e registra `ARQUIVAR` na trilha;
- `restore` busca com `includeArchived: true` (registro ativo não é "restaurável", mas o caminho precisa **encontrar** o arquivado) e registra `RESTAURAR`;
- `purge` de registro ativo → `422`;
- `purge` de registro de outro owner → `404` (o `loadOwned` cobre);
- `ProjectsService.purge` com `countTasks > 0` → `409`;
- `ClientsService.purge` com vínculos → `409` com a descrição dos vínculos;
- `DealsService.purge` de deal arquivado **com** proposta vinculada → sucesso (a FK é `SET NULL`).

Não há teste de repositório no projeto — os filtros de `archivedAt` da Fase 1 são verificados manualmente, e é por isso que o roteiro manual daquela fase é o mais longo dos três planos.

### Integration Tests

Sem suíte e2e. Os pontos que **exigem** verificação humana:

- **Cobertura do filtro**: a Fase 1 toca ~20 consultas em 5 repositórios. O roteiro "marcar à mão, conferir que sumiu de todo lugar" é a única rede disponível.
- **Ordem de FK no expurgo**: cada `409` precisa ser provocado de verdade; um `500` de FK escapando seria a falha típica desta fase.
- **Reindexação de posição** nos dois quadros com registros arquivados na mesma coluna.

### Migration & Rollback

- **Aplicar**: `prisma migrate deploy`. Quatro `ADD COLUMN` nullable e quatro `CREATE INDEX` — operação rápida e sem lock relevante na escala atual (`ADD COLUMN` com default nulo não reescreve a tabela no Postgres 11+).
- **Sem backfill**: todo registro existente nasce ativo (`archivedAt IS NULL`).
- **Rollback**: `ALTER TABLE … DROP COLUMN "archivedAt"` nos quatro + reverter o código. **Perde-se a informação de o que estava arquivado** — registros na lixeira voltariam às listagens. Antes de reverter em produção, exportar `SELECT id FROM "Deal" WHERE "archivedAt" IS NOT NULL` (e os outros três).
- **Ordem**: a migration pode ir **antes** do código (colunas a mais não afetam a API antiga). O código sem a migration, não.
- **Fase 1 é seguramente reversível por dado**: enquanto ninguém arquivar nada, `archivedAt` é sempre nulo e o comportamento é idêntico ao anterior.

## Environment Considerations

- **CI/CD**: nenhum passo novo.
- **Migrations**: uma, `20260730100000_soft_delete_lixeira`. Sem RLS nova (as quatro tabelas já têm policy `owner_isolation`) e sem `GRANT` (colunas herdam os grants da tabela).
- **Config/Secrets**: nenhuma variável nova.
- **Mudança de contrato da API**: `DELETE /deals/:id`, `/tasks/:id`, `/projects/:id`, `/contacts/:id` mudam de semântica **e** de permissão. Não há cliente externo (a API só serve o `apps/web`), mas o `ENDPOINTS.md` precisa refletir a mudança no mesmo commit — é parte da Definition of Done.
- **Volume**: registros arquivados continuam ocupando espaço e entrando nos índices. O índice `(ownerId, archivedAt)` é o que mantém as listagens rápidas conforme a lixeira cresce.

## Dependencies & Risks

- **Cobertura do filtro é o risco principal.** Uma consulta esquecida faz um registro arquivado reaparecer numa tela — o tipo de bug que só aparece semanas depois. Mitigações: o helper `shared/soft-delete.ts` torna o grep confiável; as quatro exceções conscientes (`removeTagFromAll`, `findByDealId`, `countTasks`, `countDeals`) estão comentadas no código; o roteiro manual da Fase 1 percorre todas as telas.
- **Depende da Fase 8B** para as chamadas de auditoria (ver "Phase Ordering Note"). Não depende da 8A.
- **Projeto arquivado com demandas ativas** — sem cascata, as demandas continuam em "Minhas demandas" e no dashboard, referindo um projeto que sumiu das listagens. É o comportamento que o `Client` já tem hoje com deals/projetos, e mudá-lo não foi pedido. Se incomodar na prática, a saída é cascata opcional no arquivamento — decisão de produto.
- **`Contact` sem `createdAt`** ([schema.prisma:180-192](../../apps/api/prisma/schema.prisma#L180-L192)) — a lixeira ordena por "arquivado em", que é o único critério disponível para os cinco tipos. Não é limitação, é a razão da escolha.
- **Paginação em memória no `/trash`** — cinco `findMany` por página. Aceitável no volume esperado; o contrato de `TrashItem` já está desenhado para uma UNION em `$queryRaw` se o volume mudar.
- **Feature de lixeira importando o `*.api.ts` de cinco features** — exceção consciente à regra de isolamento entre features (`apps/web/CLAUDE.md`), documentada no arquivo. A alternativa (duplicar cinco clientes HTTP) seria pior.
- **Sem expurgo automático** — a lixeira cresce até alguém limpar. Mesma classe de dívida da retenção do `AuditLog` (Fase 8B).

## References

- PRD: `specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md`
- Planos irmãos: `specs/plans/2026-07-26-fase-8a-sessoes.md`, `specs/plans/2026-07-26-fase-8b-auditoria.md` (**pré-requisito**)
- Padrões seguidos: [prisma-client.repository.ts:41,82-84](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L41-L84) (o soft delete existente), [shared/record-scope.ts:41-47](../../apps/api/src/shared/record-scope.ts#L41-L47) (a regra de compor `where` com `AND`, não spread), [20260727100000_assignee_per_record](../../apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql) (coluna nullable sem backfill)
- Decisões revertidas por esta fase: `specs/plans/2026-07-21-fase-2-pipeline.md:61-62` ("soft delete de deal — `DELETE /deals/:id` é hard delete"), e o inventário de hard deletes em `specs/research/2026-07-23-rls-por-ownerid.md:72-80`
- Precedentes: `specs/plans/2026-07-21-fase-1-clientes.md:45` ("apenas arquivamento"), `specs/research/2026-07-21-fase-1-clientes.md:140` (todas as FKs de filho para `Client` são `RESTRICT`)
- Escopo declarado: [ROADMAP.md:235-255](../../ROADMAP.md) · [SPEC.md:85](../SPEC.md)
