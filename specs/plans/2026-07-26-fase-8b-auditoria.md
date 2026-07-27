---
date: 2026-07-26T22:15:00-03:00
author: claude
source_prd: specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md
git_commit: 35421684362649ab861746eaf7c0fa8bc5932265
branch: main
status: approved
tags: [spec, auditoria, audit-log, rls, cls, permissoes]
---

# Spec: Fase 8B — Trilha de auditoria

## Overview

Colaboradores mexem em dinheiro — `POST /payments/:id/pay`, `/revert`, `/cancel` — e **nada** registra quem fez o quê. O log estruturado no Loki não substitui uma trilha: retenção de 30 dias, Grafana publicado na internet, sem visão por registro e sem um único evento para mudança em `Payment`, `Contract` ou `Proposal`. Esta fase cria um modelo `AuditLog` com RLS, instrumenta as ações sensíveis e entrega duas leituras: a tela de auditoria do owner e o histórico de um registro específico.

Há uma peça de sorte e um bloqueio estrutural. **A sorte**: toda requisição autenticada já roda inteira dentro de uma transação Prisma aberta pelo [OwnerContextInterceptor](../../apps/api/src/prisma/owner-context.interceptor.ts#L44-L50), com o `tx` no CLS — gravar o `AuditLog` por `prisma.db` já é atômico com a escrita de negócio, sem `$transaction` explícito e sem risco de trilha órfã. **O bloqueio**: o autor da ação não existe na camada `application`. Todos os services recebem `ownerId`, nenhum recebe `userId` (a única exceção do repositório é `CollaboratorsService.update`, que recebe `requesterId` só para impedir autoalteração). A saída é o **CLS**, que já é global e já carrega `PRISMA_TX` e o `requestId`: o `AccessGuard` passa a publicar o `AccessContext` lá, e um `AuditService` transversal o lê — zero mudança nas ~15 assinaturas de service e zero spec existente quebrado.

Três classes de escrita **não têm ator humano** e precisam aparecer na trilha assim mesmo: os dois crons diários, o webhook do Stripe e o aceite de convite. "Por que esta cobrança virou OVERDUE" é exatamente o tipo de pergunta que a trilha existe para responder.

## Current State

- **Não existe nada.** `grep -i "auditlog|auditoria|audit"` em `*.ts`, `*.prisma` e `*.sql` só encontra as menções em `ROADMAP.md` e `SPEC.md:57`.
- Nenhum campo `*By` no `schema.prisma`. `Task.checklist Json?` ([schema.prisma:322](../../apps/api/prisma/schema.prisma#L322)) é o único precedente de coluna `Json`.
- `AccessContext` ([access-context.ts:13-21](../../apps/api/src/modules/access/domain/access-context.ts#L13-L21)) traz `userId`, `ownerId`, `isOwner`, `roleId`, `roleName`, `permissions` — **não** traz o nome do usuário.
- `AccessGuard` ([access.guard.ts:41-54](../../apps/api/src/modules/access/access.guard.ts#L41-L54)) publica o contexto só em `req.access`.
- Ações sensíveis instrumentáveis: [payments.service.ts:80-137](../../apps/api/src/modules/finance/application/payments.service.ts#L80-L137), [contracts.service.ts:61-177](../../apps/api/src/modules/finance/application/contracts.service.ts#L61-L177), [proposals.service.ts:159-221](../../apps/api/src/modules/proposals/application/proposals.service.ts#L159-L221), [collaborators.service.ts:51-163](../../apps/api/src/modules/collaborators/application/collaborators.service.ts#L51-L163), [roles.service.ts:44-134](../../apps/api/src/modules/collaborators/application/roles.service.ts#L44-L134).
- Escritas sem ator: [finance-billing.job.ts:22-76](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L22-L76) e [proposals-expiration.job.ts:16-27](../../apps/api/src/modules/proposals/application/proposals-expiration.job.ts#L16-L27) — os dois usam `updateMany` via client admin e **só conhecem o `count`**; o webhook do Stripe; e o aceite de convite ([invites.controller.ts:50-60](../../apps/api/src/modules/collaborators/api/invites.controller.ts#L50-L60)).
- Catálogo de permissões com 17 chaves em 6 categorias ([shared/permissions.ts](../../apps/api/src/shared/permissions.ts)).

## Desired End State

- Existe `model AuditLog` com RLS `owner_isolation` e **imutável para a aplicação**: `crm_app` tem só `SELECT` e `INSERT`; `UPDATE`/`DELETE` foram revogados na migration.
- O `AccessContext` carrega `userName` e é publicado no CLS pelo `AccessGuard`.
- Um `AuditService` global grava a trilha por `prisma.db` — na mesma transação da mudança de negócio — resolvendo o autor pelo CLS, sem que nenhum service ganhe parâmetro novo.
- Todas as ações sensíveis do ROADMAP estão instrumentadas: baixa/estorno/cancelamento de cobrança, criação/edição/pausa/retomada/cancelamento de contrato, envio/aceite/recusa/nova versão/exclusão de proposta, convite/papel/ativação/desativação de colaborador, CRUD de papéis e arquivamento de cliente.
- Ações sem ator humano entram na trilha com `actorId: null` e um discriminador `AuditActorType` (`CRON`, `WEBHOOK`, `SISTEMA`); os dois crons passam a saber **quais** linhas mudaram, não só quantas.
- Existe a chave `auditoria:ver` na categoria `Organização`, **sem backfill** — nenhum papel customizado a recebe automaticamente.
- `GET /audit` (paginado, filtrável) e `GET /audit/entities/:entity/:id` (histórico de um registro) alimentam a página `/auditoria` e um `HistoricoDialog` reutilizável.

## What We're NOT Doing

- **Registrar tentativas negadas** (403, 422) — a trilha vive na transação do request; se o handler lança, o registro some junto. Isso é o comportamento correto para "mudança aplicada", e tentativas negadas continuam no log de acesso do Loki (`http.requisicao`, `acesso.negado`).
- **Registrar leituras** — a trilha é de mudança de estado. Auditar consultas multiplicaria o volume por uma ordem de grandeza sem responder nenhuma pergunta do ROADMAP.
- **Retenção, partição ou expurgo do `AuditLog`** — a tabela cresce de forma monotônica e nenhuma tabela do projeto tem política de retenção hoje. Fica registrado como dívida explícita (ver Dependencies & Risks).
- **Backfill de `auditoria:ver` em papéis customizados** — não há módulo correspondente óbvio, e é uma chave de governança que o owner deve conceder deliberadamente. Owner e papel `system` a recebem em runtime via `ALL_PERMISSION_KEYS`.
- **Reverter uma mudança a partir da trilha** ("desfazer") — a trilha é registro, não comando.
- **`HistoricoDialog` em todas as telas de detalhe** — nesta fase ele é criado e ligado em **um** ponto (detalhe do cliente). O caminho geral para ver o histórico de qualquer registro é `/auditoria` com filtro por entidade. Ligar o diálogo em cobrança, contrato e proposta é trabalho posterior, barato porque o componente já existirá.
- **Auditar mudanças em `Session`** — a Fase 8A já cobre isso com os eventos `sessao.revogada`/`sessoes.revogadas` no Loki, e a sessão é dado pessoal fora do eixo `ownerId`.
- **Assinatura criptográfica / hash encadeado dos registros** — o `REVOKE` já impede a aplicação de reescrever a trilha; ir além é desproporcional ao modelo de ameaça (o owner confia no próprio banco).

---

## Phase 1: Fundação — modelo, RLS, autor no CLS e `AuditService`

### Goal

Ter a infraestrutura de auditoria completa e testada, sem nenhum ponto de negócio chamando ainda.

### Changes

#### Banco

**Modify**: `apps/api/prisma/schema.prisma`

Enums novos, junto ao bloco de enums (após a linha 509):

```prisma
// --- auditoria (Fase 8B) ---

/// Natureza de quem agiu. USER é o único caso com `actorId` preenchido.
enum AuditActorType {
  USER
  CRON
  WEBHOOK
  SISTEMA
}

/// Registro afetado. Cresce conforme a trilha cobre mais domínio.
enum AuditEntity {
  CLIENT
  CONTACT
  DEAL
  PROPOSAL
  PROJECT
  TASK
  CONTRACT
  PAYMENT
  ROLE
  USER
  SUBSCRIPTION
}

/// O que aconteceu. Verbo no infinitivo, no vocabulário do domínio.
enum AuditAction {
  CRIAR
  ATUALIZAR
  EXCLUIR
  ARQUIVAR
  RESTAURAR
  EXPURGAR
  PAGAR
  ESTORNAR
  CANCELAR
  PAUSAR
  RETOMAR
  ENVIAR
  ACEITAR
  RECUSAR
  NOVA_VERSAO
  CONVIDAR
  ATIVAR
  DESATIVAR
  ALTERAR_PAPEL
  EXPIRAR
  VENCER
}
```

Modelo novo, após `Activity` (linha 406):

```prisma
/// Trilha de auditoria: uma linha por mudança sensível de estado.
///
/// Tem RLS por ownerId (template `owner_isolation`) e é IMUTÁVEL para a
/// aplicação: a migration revoga UPDATE/DELETE de `crm_app`. Uma trilha que o
/// próprio app pode reescrever tem valor limitado.
///
/// `actorName` e `entityLabel` são DENORMALIZADOS de propósito: a tela de
/// auditoria não faz join, e o registro guarda o que era verdade no momento da
/// ação — renomear um colaborador ou um contrato não reescreve o passado.
model AuditLog {
  id          String         @id @default(uuid())
  ownerId     String
  actorType   AuditActorType @default(USER)
  /// `null` quando actorType != USER. Sem FK: apagar um usuário não pode apagar a trilha.
  actorId     String?
  /// Nome de quem agiu no momento da ação ("Rotina diária", "Webhook do Stripe" no caso não-humano).
  actorName   String
  entity      AuditEntity
  entityId    String
  /// Rótulo humano do registro no momento da ação ("Mensalidade 07/2026").
  entityLabel String
  action      AuditAction
  /// `{ campo: { antes, depois } }` — só os campos alterados. Ver shared/audit-diff.ts.
  diff        Json?
  /// Mesmo `x-request-id` do log estruturado — amarra a trilha ao Loki.
  requestId   String?
  createdAt   DateTime       @default(now())

  @@index([ownerId, createdAt])
  @@index([ownerId, entity, entityId, createdAt])
  @@index([ownerId, actorId, createdAt])
}
```

**Create**: `apps/api/prisma/migrations/20260729100000_audit_log/migration.sql`

```sql
-- Trilha de auditoria: uma linha por mudança sensível de estado.
--
-- Notas de projeto:
--  * Template `owner_isolation` (ver 20260724050000_enable_rls): ownerId TEXT
--    denormalizado, SEM cast ::uuid; current_setting(…, true) é missing_ok →
--    contexto ausente casa zero linhas (fail-closed); USING e WITH CHECK
--    idênticos; FORCE sujeita o dono da tabela.
--  * ownerId NÃO tem FK para "User" — é a convenção das tabelas de dados.
--    Aqui há um motivo extra: a trilha não pode sumir junto com o registro.
--  * IMUTABILIDADE: o `ALTER DEFAULT PRIVILEGES` de 20260724040000 concede os
--    quatro verbos por padrão a toda tabela nova, então restringir exige REVOKE
--    explícito. crm_app fica com SELECT + INSERT; crm_user (superuser) continua
--    podendo tudo — é por lá que uma futura política de retenção vai passar.
--  * Sem backfill: a trilha começa vazia, no dia do deploy.
--  * Roda como crm_user (superuser), que bypassa RLS.

CREATE TYPE "AuditActorType" AS ENUM ('USER', 'CRON', 'WEBHOOK', 'SISTEMA');

CREATE TYPE "AuditEntity" AS ENUM (
  'CLIENT', 'CONTACT', 'DEAL', 'PROPOSAL', 'PROJECT', 'TASK',
  'CONTRACT', 'PAYMENT', 'ROLE', 'USER', 'SUBSCRIPTION'
);

CREATE TYPE "AuditAction" AS ENUM (
  'CRIAR', 'ATUALIZAR', 'EXCLUIR', 'ARQUIVAR', 'RESTAURAR', 'EXPURGAR',
  'PAGAR', 'ESTORNAR', 'CANCELAR', 'PAUSAR', 'RETOMAR',
  'ENVIAR', 'ACEITAR', 'RECUSAR', 'NOVA_VERSAO',
  'CONVIDAR', 'ATIVAR', 'DESATIVAR', 'ALTERAR_PAPEL',
  'EXPIRAR', 'VENCER'
);

CREATE TABLE "AuditLog" (
  "id"          TEXT             NOT NULL,
  "ownerId"     TEXT             NOT NULL,
  "actorType"   "AuditActorType" NOT NULL DEFAULT 'USER',
  "actorId"     TEXT,
  "actorName"   TEXT             NOT NULL,
  "entity"      "AuditEntity"    NOT NULL,
  "entityId"    TEXT             NOT NULL,
  "entityLabel" TEXT             NOT NULL,
  "action"      "AuditAction"    NOT NULL,
  "diff"        JSONB,
  "requestId"   TEXT,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_ownerId_createdAt_idx"
  ON "AuditLog"("ownerId", "createdAt");
CREATE INDEX "AuditLog_ownerId_entity_entityId_createdAt_idx"
  ON "AuditLog"("ownerId", "entity", "entityId", "createdAt");
CREATE INDEX "AuditLog_ownerId_actorId_createdAt_idx"
  ON "AuditLog"("ownerId", "actorId", "createdAt");

-- RLS (template owner_isolation)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "AuditLog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Imutabilidade: a aplicação só lê e acrescenta.
REVOKE UPDATE, DELETE ON "AuditLog" FROM crm_app;
```

#### Autor no CLS

**Modify**: `apps/api/src/modules/access/domain/access-context.ts`

```ts
export interface AccessContext {
  userId: string;
  /** Nome de quem está logado — denormalizado na trilha de auditoria (`actorName`). */
  userName: string;
  ownerId: string;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: PermissionKey[];
}

/**
 * Chave do `AccessContext` no CLS, publicada pelo `AccessGuard`.
 *
 * Existe para o `AuditService`: nenhum service da camada `application` recebe
 * `userId` (todos recebem `ownerId`), e a trilha precisa do autor. Passar o
 * autor por parâmetro custaria mudar ~15 assinaturas, seus controllers e todos
 * os specs — o CLS já é global e já carrega `PRISMA_TX` e o `requestId`.
 */
export const ACCESS_CONTEXT = 'ACCESS_CONTEXT';
```

**Modify**: `apps/api/src/modules/access/application/access.service.ts`

Selecionar o nome e devolvê-lo nos dois ramos:

```ts
    const user = await this.admin.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        active: true,
        role: { select: { id: true, name: true, system: true, permissions: true } },
      },
    });
    if (!user || !user.active) return null;

    if (user.ownerId === null) {
      return {
        userId: user.id,
        userName: user.name,
        ownerId: user.id,
        isOwner: true,
        roleId: null,
        roleName: null,
        permissions: ALL_PERMISSION_KEYS,
      };
    }

    return {
      userId: user.id,
      userName: user.name,
      ownerId: user.ownerId,
      isOwner: false,
      roleId: user.role?.id ?? null,
      roleName: user.role?.name ?? null,
      permissions: this.permissionsOf(user.role),
    };
```

**Modify**: `apps/api/src/modules/access/access.guard.ts`

```ts
import { ClsService } from 'nestjs-cls';
import { ACCESS_CONTEXT } from './domain/access-context';

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly cls: ClsService,
  ) {}

    // …
    req.access = access;
    // Também no CLS: é daqui que o AuditService descobre o autor, sem que
    // nenhum service da camada `application` precise receber o `userId`.
    this.cls.set(ACCESS_CONTEXT, access);
```

**Modify**: `apps/api/src/modules/access/access.guard.spec.ts`

O construtor ganhou um terceiro argumento — passar um `ClsService` mockado (`{ set: jest.fn(), get: jest.fn() }`) e acrescentar uma asserção de que o contexto é publicado no CLS. Todos os `AccessContext` construídos nos testes ganham `userName`.

**Modify**: `apps/api/src/modules/access/application/access.service.spec.ts`

Os mocks de `admin.user.findUnique` passam a devolver `name`, e as asserções sobre o `AccessContext` retornado (owner e colaborador) ganham `userName`. Sem isso o spec quebra no `toEqual`.

#### `AuditService` e helper de diff

**Create**: `apps/api/src/shared/audit-diff.ts`

```ts
/**
 * Diff de auditoria: `{ campo: { antes, depois } }`, só com o que mudou.
 *
 * A redação automática de segredo do log (`CHAVE_SENSIVEL` em
 * `shared/logging/log.ts`) **não** alcança uma coluna JSONB persistida — a
 * omissão aqui é explícita e por nome de campo.
 */

/** Nunca entram no diff. Segredo, dado pessoal sensível ou ruído. */
const CAMPOS_OMITIDOS = new Set([
  'passwordHash',
  'tokenHash',
  'refreshTokenHash',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'document', // CPF/CNPJ: dado pessoal que a trilha não precisa repetir
  'updatedAt', // muda em toda escrita; diria só "houve escrita"
  'createdAt',
]);

/** Valor pronto para JSONB: Decimal e Date viram string; o resto passa. */
function normalizar(valor: unknown): unknown {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString();
  // Decimal do Prisma (e qualquer objeto com toString próprio que não seja Object).
  if (typeof valor === 'object' && 'toFixed' in (valor as object)) {
    return String(valor);
  }
  return valor;
}

export type AuditDiff = Record<string, { antes: unknown; depois: unknown }>;

/**
 * Compara dois estados do mesmo registro. Devolve `null` quando nada mudou —
 * a trilha grava `diff: null` em ação sem diff (ex.: EXCLUIR, ARQUIVAR).
 *
 * A comparação é rasa e por `JSON.stringify` do valor normalizado: basta para
 * os campos escalares do domínio, e evita falso positivo entre `Decimal(10.00)`
 * e `Decimal(10)`.
 */
export function calcularDiff(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  omitir: ReadonlySet<string> = CAMPOS_OMITIDOS,
): AuditDiff | null {
  const out: AuditDiff = {};
  for (const campo of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    if (omitir.has(campo)) continue;
    const a = normalizar(antes[campo]);
    const d = normalizar(depois[campo]);
    if (JSON.stringify(a) !== JSON.stringify(d)) out[campo] = { antes: a, depois: d };
  }
  return Object.keys(out).length > 0 ? out : null;
}
```

**Create**: `apps/api/src/shared/audit-diff.spec.ts`

Casos: sem mudança → `null`; campo omitido não aparece mesmo mudando; `Decimal`/`Date` normalizados; campo que só existe em um dos lados entra com `undefined → valor`.

**Create**: `apps/api/src/modules/audit/audit.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditEntity, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminService } from '../../prisma/prisma-admin.service';
import {
  ACCESS_CONTEXT,
  type AccessContext,
} from '../access/domain/access-context';
import { calcularDiff, type AuditDiff } from '../../shared/audit-diff';

/** Registro de uma ação humana, no caminho de requisição HTTP. */
export interface EntradaDeAuditoria {
  entity: AuditEntity;
  entityId: string;
  /** Rótulo humano do registro — "Mensalidade 07/2026", o nome do cliente… */
  entityLabel: string;
  action: AuditAction;
  /** Estados para o diff. Omitir em ação sem diff (EXCLUIR, ARQUIVAR). */
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
  /** Contexto extra que não é diff de campo (ex.: `{ cobrancasCanceladas: 4 }`). */
  extra?: Record<string, unknown>;
}

/** Registro de uma ação sem ator humano — cron, webhook, rotina interna. */
export interface EntradaDeSistema extends EntradaDeAuditoria {
  ownerId: string;
  actorType: 'CRON' | 'WEBHOOK' | 'SISTEMA';
  /** Nome exibido na tela ("Rotina diária", "Webhook do Stripe"). */
  actorName: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Registra uma ação humana. Roda por `prisma.db`, ou seja **dentro da
   * transação do request** aberta pelo `OwnerContextInterceptor`: a trilha
   * commita junto com a mudança de negócio, ou nenhuma das duas commita.
   *
   * Deixa a exceção subir de propósito. Se a trilha não pode ser gravada, a
   * mudança não deve ser aplicada — é o ponto inteiro de uma auditoria.
   */
  async registrar(entrada: EntradaDeAuditoria): Promise<void> {
    const access = this.cls.get<AccessContext>(ACCESS_CONTEXT);
    if (!access) {
      // Chamada fora de requisição autenticada. Não derruba o fluxo de negócio,
      // mas é bug de instrumentação: use `registrarPeloSistema`.
      this.logger.warn({
        evento: 'auditoria.sem_contexto',
        msg: 'Tentativa de registrar auditoria sem contexto de acesso.',
        entidade: entrada.entity,
        acao: entrada.action,
      });
      return;
    }
    await this.prisma.db.auditLog.create({
      data: {
        ownerId: access.ownerId,
        actorType: 'USER',
        actorId: access.userId,
        actorName: access.userName,
        entity: entrada.entity,
        entityId: entrada.entityId,
        entityLabel: entrada.entityLabel,
        action: entrada.action,
        diff: this.montarDiff(entrada),
        requestId: this.cls.getId() || null,
      },
    });
  }

  /**
   * Registra uma ação sem ator humano (cron, webhook, rotina). Usa o client
   * admin porque esses caminhos rodam cross-owner, sem `app.owner_id` — a
   * policy de RLS casaria zero linhas.
   *
   * Ao contrário de `registrar`, **engole** a exceção: um cron processa N
   * linhas de N owners, e uma trilha que falha não pode abortar o lote inteiro.
   */
  async registrarPeloSistema(entrada: EntradaDeSistema): Promise<void> {
    try {
      await this.admin.auditLog.create({
        data: {
          ownerId: entrada.ownerId,
          actorType: entrada.actorType,
          actorId: null,
          actorName: entrada.actorName,
          entity: entrada.entity,
          entityId: entrada.entityId,
          entityLabel: entrada.entityLabel,
          action: entrada.action,
          diff: this.montarDiff(entrada),
          requestId: this.cls.getId() || null,
        },
      });
    } catch (erro) {
      this.logger.error(
        {
          evento: 'auditoria.registro_falhou',
          msg: 'Falha ao registrar auditoria de ação do sistema.',
          entidade: entrada.entity,
          entidadeId: entrada.entityId,
          acao: entrada.action,
        },
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }

  /** Junta o diff calculado ao `extra`, ou devolve `undefined` se não há nada. */
  private montarDiff(entrada: EntradaDeAuditoria): Prisma.InputJsonValue | undefined {
    const diff: AuditDiff | null =
      entrada.antes && entrada.depois
        ? calcularDiff(entrada.antes, entrada.depois)
        : null;
    if (!diff && !entrada.extra) return undefined;
    return { ...(diff ?? {}), ...(entrada.extra ?? {}) } as Prisma.InputJsonValue;
  }
}
```

**Create**: `apps/api/src/modules/audit/audit.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global de propósito: a trilha é transversal e cruza módulos que não têm (nem
 * devem ter) dependência entre si — finance, proposals, collaborators, clients.
 * Importar `AuditModule` em cada um deles seria ruído sem ganho de fronteira.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

**Modify**: `apps/api/src/app.module.ts`

Importar `AuditModule` logo após `AccessModule` (antes dos módulos de negócio, que passam a injetar o `AuditService`).

**Create**: `apps/api/src/modules/audit/audit.service.spec.ts`

Instanciação direta (`new AuditService(prisma, admin, cls)`), com `prisma.db` mockado por um objeto `{ auditLog: { create: jest.fn() } }` e `cls` por `{ get: jest.fn(), getId: jest.fn() }`. Casos:

- `registrar` grava `actorType: 'USER'` com `actorId`/`actorName` vindos do CLS;
- `registrar` sem contexto no CLS **não** grava e emite `auditoria.sem_contexto`;
- `registrar` propaga a exceção do `create` (é o que garante a atomicidade);
- `registrarPeloSistema` usa o client **admin**, grava `actorId: null` e **não** propaga exceção;
- `diff` sai `undefined` quando `antes`/`depois` não são passados e nada de `extra`;
- `extra` é mesclado ao diff.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api exec prisma migrate dev` — a migration aplica sem erro
- [ ] `pnpm --filter api test` — `audit.service.spec.ts`, `audit-diff.spec.ts` e `access.guard.spec.ts` passam
- [ ] `pnpm --filter api build` e `pnpm --filter api lint` — sem erros
- [ ] `psql -c '\dp "AuditLog"'` — `crm_app` aparece com `arw` (SELECT/INSERT/REFERENCES) e **sem** `d` (DELETE) nem `w` sozinho de UPDATE

#### Manual Verification
- [ ] Conectado como `crm_app`, `INSERT INTO "AuditLog" …` com `app.owner_id` setado funciona; sem `set_config`, insere **zero** linhas (fail-closed)
- [ ] Conectado como `crm_app`, `UPDATE "AuditLog" SET "actorName" = 'x'` responde `permission denied`
- [ ] Conectado como `crm_app` com o `app.owner_id` de outro owner, `SELECT` não devolve as linhas alheias
- [ ] Nenhuma mudança de comportamento na aplicação (nada chama `registrar` ainda) — login, dashboard e listagens funcionam igual

**⏸ PAUSE**: Parar para confirmação humana antes de instrumentar as ações.

---

## Phase 2: Instrumentação das ações humanas

### Goal

Registrar na trilha toda mudança sensível feita por uma pessoa autenticada.

### Changes

O padrão é sempre o mesmo: injetar `AuditService`, carregar o "antes" (todos esses services **já** carregam o registro no `loadOwned`), executar a mudança e chamar `registrar` com o "depois". Como tudo roda na transação do request, não há `$transaction` extra.

#### Financeiro

**Modify**: `apps/api/src/modules/finance/application/payments.service.ts`

```ts
import { AuditService } from '../../audit/audit.service';

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}
```

Nos quatro métodos de escrita — `update` (:80), `pay` (:101), `revert` (:118) e `cancel` (:132). Exemplo completo do `pay`; os outros três seguem o mesmo molde:

```ts
  /** Baixa: PENDING|OVERDUE → PAID. */
  async pay(
    ownerId: string,
    id: string,
    dto: PayPaymentDto,
  ): Promise<PaymentWithContract> {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'PAID');
    const atualizado = await this.repo.update(id, {
      status: 'PAID',
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      paidAmount: dto.paidAmount ?? p.amount, // aceita valor parcial/diferente
      method: dto.method,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
    await this.audit.registrar({
      entity: 'PAYMENT',
      entityId: id,
      entityLabel: p.description,
      action: 'PAGAR',
      antes: p,
      depois: atualizado,
    });
    return atualizado;
  }
```

Ações: `update` → `ATUALIZAR`; `pay` → `PAGAR`; `revert` → `ESTORNAR`; `cancel` → `CANCELAR`.

**Modify**: `apps/api/src/modules/finance/application/contracts.service.ts`

`create` → `CRIAR` (sem diff: `antes` não existe; `extra: { cobrancasGeradas: contrato.payments.length }`); `update` → `ATUALIZAR` (com diff); `pause` → `PAUSAR`; `resume` → `RETOMAR`; `cancel` → `CANCELAR`.

O `cancel` cancela N cobranças num `updateMany` aninhado. **Decisão: um registro agregado**, no contrato, com a contagem — não N registros de `Payment`. O que se quer responder é "quem cancelou este contrato e quantas cobranças caíram junto":

```ts
  /** Cancela o contrato e as cobranças em aberto (PENDING/OVERDUE); as PAID ficam no histórico. */
  async cancel(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'CANCELED');
    const emAberto = c.payments.filter(
      (p) => p.status === 'PENDING' || p.status === 'OVERDUE',
    ).length;
    const cancelado = await this.repo.update(id, {
      status: 'CANCELED',
      payments: {
        updateMany: {
          where: { status: { in: ['PENDING', 'OVERDUE'] } },
          data: { status: 'CANCELED' },
        },
      },
    });
    // Um registro agregado, não N: a pergunta é "quem cancelou o contrato e
    // quantas cobranças caíram junto", e N linhas de Payment com o mesmo autor
    // e o mesmo instante seriam ruído na tela de auditoria.
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: id,
      entityLabel: c.description,
      action: 'CANCELAR',
      antes: c,
      depois: cancelado,
      extra: { cobrancasCanceladas: emAberto },
    });
    return cancelado;
  }
```

#### Propostas

**Modify**: `apps/api/src/modules/proposals/application/proposals.service.ts`

`send` → `ENVIAR`; `accept` → `ACEITAR`; `reject` → `RECUSAR`; `newVersion` → `NOVA_VERSAO` (registro na proposta **nova**, com `extra: { origemId: source.id, versao: nova.version }`); `delete` → `EXCLUIR` (sem diff). `entityLabel` é `proposal.number` (ex.: `PROP-2026-0042`).

O `accept` dispara efeito cruzado em `Deal`/`Project` via `moveDealToWon`. **Decisão: um registro só**, na proposta, com `extra: { dealMovidoParaGanhou: boolean }` — o movimento do deal é consequência, não ação independente do usuário.

#### Colaboradores e papéis

**Modify**: `apps/api/src/modules/collaborators/application/collaborators.service.ts`

- `invite` → `USER` / `CONVIDAR`, `entityLabel: created.name`, `extra: { papelId: role.id, papel: role.name }`.
- `update` → dois registros possíveis, espelhando os dois logs que já existem nas linhas 145-161:
  - troca de papel → `ALTERAR_PAPEL`, com `diff` de `{ papel }` (nome antigo → nome novo, não o id, para a tela ser legível);
  - ativação/desativação → `ATIVAR` / `DESATIVAR`.

```ts
    if (data.roleId && data.roleId !== current.role?.id) {
      this.logger.log({ evento: 'colaborador.papel_alterado', /* … */ });
      await this.audit.registrar({
        entity: 'USER',
        entityId: id,
        entityLabel: current.name,
        action: 'ALTERAR_PAPEL',
        antes: { papel: current.role?.name ?? null },
        depois: { papel: updated.role?.name ?? null },
      });
    }
    if (data.active !== undefined && data.active !== current.active) {
      this.logger.log({ evento: data.active ? 'colaborador.reativado' : 'colaborador.desativado', /* … */ });
      await this.audit.registrar({
        entity: 'USER',
        entityId: id,
        entityLabel: current.name,
        action: data.active ? 'ATIVAR' : 'DESATIVAR',
      });
    }
```

**Modify**: `apps/api/src/modules/collaborators/application/roles.service.ts`

`create` → `CRIAR`; `update` e `removePermission` → `ATUALIZAR`; `remove` → `EXCLUIR`. O `papel.atualizado` de hoje loga só a **contagem** de permissões ([:82-87](../../apps/api/src/modules/collaborators/application/roles.service.ts#L82-L87)) — a trilha guarda o diff de verdade:

```ts
    await this.audit.registrar({
      entity: 'ROLE',
      entityId: id,
      entityLabel: role.name,
      action: 'ATUALIZAR',
      antes: { nome: current.name, descricao: current.description, permissoes: current.permissions },
      depois: { nome: role.name, descricao: role.description, permissoes: role.permissions },
    });
```

`permissions` **não** entra em `CAMPOS_OMITIDOS`: o diff de permissões é justamente o que a auditoria de papéis precisa mostrar.

#### Clientes

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

`archive` → `CLIENT` / `ARQUIVAR`, `entityLabel: client.name`. É o único soft delete existente; a Fase 8C amplia o padrão para os outros quatro modelos e para `RESTAURAR`/`EXPURGAR`.

#### Módulos

**Modify**: `apps/api/src/modules/finance/finance.module.ts`, `proposals.module.ts`, `collaborators.module.ts`, `clients.module.ts`

Nenhuma mudança: `AuditModule` é `@Global()`, o `AuditService` é injetável direto.

#### Testes

**Modify**: os specs de service afetados

`payments.service.spec.ts`, `contracts.service.spec.ts`, `proposals.service.spec.ts` e os de colaboradores/papéis instanciam os services diretamente. Cada `new Service(...)` ganha um `AuditService` mockado:

```ts
  const audit = { registrar: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
```

E ao menos um teste por service afirma o registro:

```ts
    it('registra a baixa na trilha de auditoria', async () => {
      // … arranjo do pay feliz …
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'PAYMENT', action: 'PAGAR', entityId: 'p1' }),
      );
    });
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — todos os specs de service passam com o `AuditService` mockado, incluindo as asserções novas de registro
- [ ] `pnpm --filter api build` e `pnpm --filter api lint` — sem erros
- [ ] `grep -rn "audit.registrar" apps/api/src/modules | wc -l` — pelo menos 18 pontos (4 pagamentos + 5 contratos + 5 propostas + 3 colaboradores + 4 papéis + 1 cliente)

#### Manual Verification
- [ ] Dar baixa numa cobrança e conferir a linha em `AuditLog`: `actorId` é o colaborador logado, `actorName` é o nome dele, `diff` traz `status: { antes: "PENDING", depois: "PAID" }` e `paidAmount`
- [ ] Provocar um erro depois da gravação (ex.: um `422` numa transição inválida): **nenhuma** linha de trilha fica no banco — a transação do request desfaz as duas
- [ ] Cancelar um contrato com 3 cobranças em aberto: **uma** linha de `CONTRACT`/`CANCELAR` com `diff.cobrancasCanceladas = 3`, não três de `PAYMENT`
- [ ] Editar as permissões de um papel: o `diff.permissoes` traz as duas listas, e nenhum campo omitido (`passwordHash`, `document`) aparece em nenhuma linha
- [ ] Aceitar uma proposta vinculada a um deal: **uma** linha de `PROPOSAL`/`ACEITAR` com `diff.dealMovidoParaGanhou = true`
- [ ] Um colaborador de outro owner não enxerga nenhuma dessas linhas (`SELECT` com o `app.owner_id` dele volta vazio)

**⏸ PAUSE**: Parar para confirmação humana antes de instrumentar as ações sem ator.

---

## Phase 3: Ações sem ator humano

### Goal

Fazer os dois crons, o webhook do Stripe e o aceite de convite aparecerem na trilha, para que mudanças automáticas de estado deixem de ser inexplicáveis.

### Changes

O obstáculo é conhecido: os crons usam `updateMany` e **só leem o `count`** — não sabem quais linhas mudaram nem de que owner são. Os dois repositórios passam a devolver as linhas afetadas.

#### Cobranças vencidas

**Modify**: `apps/api/src/modules/finance/domain/payment.repository.ts`

```ts
/** Cobrança marcada como vencida pela rotina — o mínimo para a trilha. */
export interface PaymentVencido {
  id: string;
  ownerId: string;
  description: string;
}

export interface PaymentRepository {
  // …
  /** Marca as pendentes vencidas e devolve **quais** foram (a trilha precisa dos ids). */
  markOverdue(now: Date): Promise<PaymentVencido[]>;
}
```

**Modify**: `apps/api/src/modules/finance/infra/prisma-payment.repository.ts:220-227`

```ts
  async markOverdue(now: Date): Promise<PaymentVencido[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    // Carrega antes de atualizar: `updateMany` só devolve o `count`, e a trilha
    // precisa de uma linha por cobrança (é ela que responde "por que esta
    // cobrança virou OVERDUE"). O SELECT e o UPDATE usam o MESMO filtro; uma
    // cobrança paga entre os dois simplesmente não é atualizada e a trilha teria
    // uma linha a mais — corrida improvável às 3h e sem consequência de negócio.
    const where = { status: 'PENDING' as const, dueDate: { lt: now } };
    const alvos = await this.admin.payment.findMany({
      where,
      select: { id: true, ownerId: true, description: true },
    });
    if (alvos.length === 0) return [];
    await this.admin.payment.updateMany({ where, data: { status: 'OVERDUE' } });
    return alvos;
  }
```

**Modify**: `apps/api/src/modules/finance/application/finance-billing.job.ts`

```ts
import { AuditService } from '../../audit/audit.service';

/** Nome exibido na tela de auditoria para as duas rotinas diárias. */
const ATOR_ROTINA = 'Rotina diária';

  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const now = new Date();
    const generated = await this.generateMonthly(now);
    const vencidas = await this.payments.markOverdue(now);
    for (const p of vencidas) {
      await this.audit.registrarPeloSistema({
        ownerId: p.ownerId,
        actorType: 'CRON',
        actorName: ATOR_ROTINA,
        entity: 'PAYMENT',
        entityId: p.id,
        entityLabel: p.description,
        action: 'VENCER',
        antes: { status: 'PENDING' },
        depois: { status: 'OVERDUE' },
      });
    }
    // … logs existentes, com `overdue` trocado por `vencidas.length`
  }
```

E, dentro de `generateMonthly`, uma linha `CRIAR` por mensalidade gerada (o loop já cria uma a uma, então basta usar o retorno do `payments.create`):

```ts
        const criado = await this.payments.create({ /* … inalterado … */ });
        await this.audit.registrarPeloSistema({
          ownerId: c.ownerId,
          actorType: 'CRON',
          actorName: ATOR_ROTINA,
          entity: 'PAYMENT',
          entityId: criado.id,
          entityLabel: criado.description,
          action: 'CRIAR',
          extra: { contratoId: c.id, vencimento: dueDate.toISOString() },
        });
        count++;
```

(`PaymentRepository.create` precisa devolver o registro criado, não `void` — ajustar a interface e a implementação se ainda não for o caso.)

#### Propostas expiradas

**Modify**: `apps/api/src/modules/proposals/domain/proposal.repository.ts` e `infra/prisma-proposal.repository.ts:133-143`

Mesmo tratamento: `expireOverdue(now)` passa a devolver `Array<{ id, ownerId, number, status }>` (o `status` anterior entra no diff).

**Modify**: `apps/api/src/modules/proposals/application/proposals-expiration.job.ts`

```ts
    const expiradas = await this.repo.expireOverdue(new Date());
    for (const p of expiradas) {
      await this.audit.registrarPeloSistema({
        ownerId: p.ownerId,
        actorType: 'CRON',
        actorName: 'Rotina diária',
        entity: 'PROPOSAL',
        entityId: p.id,
        entityLabel: p.number,
        action: 'EXPIRAR',
        antes: { status: p.status },
        depois: { status: 'EXPIRED' },
      });
    }
    if (expiradas.length > 0) {
      this.logger.log({
        evento: 'propostas.expiradas',
        msg: 'Propostas expiradas pela rotina diária.',
        quantidade: expiradas.length,
      });
    }
```

#### Webhook do Stripe

**Modify**: `apps/api/src/modules/billing/infra/prisma-subscription.repository.ts` (e o service que o chama)

No ponto em que o webhook sincroniza o estado da assinatura, um registro `SUBSCRIPTION`/`ATUALIZAR` com `actorType: 'WEBHOOK'`, `actorName: 'Webhook do Stripe'`, `entityLabel` = o status novo traduzido, e diff de `{ status, currentPeriodEnd, cancelAtPeriodEnd }`. Só registrar quando **algo mudou** — o Stripe reenvia eventos, e uma trilha com N linhas idênticas por retentativa é ruído:

```ts
    const diff = calcularDiff(anterior, novo);
    if (!diff) return; // reentrega do mesmo evento: nada mudou, nada a registrar
```

#### Aceite de convite

**Modify**: `apps/api/src/modules/collaborators/application/invites.service.ts`

O aceite é `@Public()` (sem CLS de acesso), mas **o autor é conhecido**: é o próprio convidado, cujo `userId` o `accept` já resolve. Registrar com `actorType: 'USER'` e `actorId` preenchido — usando o caminho `registrarPeloSistema` (que aceita `ownerId` explícito e usa o client admin), com uma sobrecarga que permita `actorType: 'USER'` + `actorId`:

```ts
// audit.service.ts — EntradaDeSistema passa a aceitar o ator humano identificado
export interface EntradaDeSistema extends EntradaDeAuditoria {
  ownerId: string;
  actorType: 'CRON' | 'WEBHOOK' | 'SISTEMA' | 'USER';
  actorName: string;
  /** Só em `actorType: 'USER'` fora do caminho de requisição (aceite de convite). */
  actorId?: string | null;
}
```

```ts
// invites.service.ts, ao final do accept()
    await this.audit.registrarPeloSistema({
      ownerId: invite.ownerId,
      actorType: 'USER',
      actorId: user.id,
      actorName: user.name,
      entity: 'USER',
      entityId: user.id,
      entityLabel: user.name,
      action: 'ACEITAR',
      extra: { conviteId: invite.id },
    });
```

#### Documentação

**Modify**: `docs/observabilidade.md`

Duas linhas na tabela de eventos:

```markdown
| `auditoria.sem_contexto` | `AuditService.registrar` chamado fora de requisição autenticada (bug de instrumentação) | `warn` |
| `auditoria.registro_falhou` | falha ao gravar trilha de ação do sistema (cron/webhook) — o lote continua | `error` |
```

E um parágrafo curto na seção de regras deixando explícito que a trilha persistida **convive** com o log: o Loki responde "o que o sistema fez" nos últimos 30 dias; o `AuditLog` responde "quem mudou este registro" sem limite de tempo.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — os specs dos dois jobs passam com o `AuditService` mockado; `markOverdue`/`expireOverdue` mockados devolvendo array
- [ ] `pnpm --filter api build` e `pnpm --filter api lint` — sem erros

#### Manual Verification
- [ ] Criar uma cobrança `PENDING` com vencimento no passado e disparar o `FinanceBillingJob` à mão: uma linha `PAYMENT`/`VENCER` com `actorType: 'CRON'`, `actorId: null`, `actorName: 'Rotina diária'` e o `ownerId` **da cobrança** (não de outro owner)
- [ ] Repetir com cobranças de **dois owners diferentes**: cada linha de trilha fica com o `ownerId` correto, e cada owner só enxerga a sua
- [ ] Contrato recorrente ativo: a rotina gera a mensalidade e registra `PAYMENT`/`CRIAR` com `contratoId` no `extra`
- [ ] Proposta `SENT` com `validUntil` no passado: linha `PROPOSAL`/`EXPIRAR` com o status anterior no diff
- [ ] Reenviar o mesmo evento do Stripe (Stripe CLI `resend`): a segunda entrega **não** cria linha nova
- [ ] Aceitar um convite: linha `USER`/`ACEITAR` com `actorId` do convidado e `ownerId` de quem convidou
- [ ] Forçar uma falha de gravação da trilha no cron (ex.: derrubar o índice temporariamente): o cron **conclui** o lote e emite `auditoria.registro_falhou`

**⏸ PAUSE**: Parar para confirmação humana antes de expor a leitura.

---

## Phase 4: Leitura — permissão, API e telas

### Goal

Dar ao owner a tela de auditoria filtrável e o histórico por registro.

### Changes

#### Permissão

**Modify**: `apps/api/src/shared/permissions.ts`

Na categoria `Organização`, após `papel:gerenciar`:

```ts
  {
    key: 'auditoria:ver',
    label: 'Ver a auditoria',
    description:
      'Consultar a trilha de mudanças sensíveis do CRM — quem alterou o quê e quando',
    category: 'Organização',
  },
```

**Sem migration de backfill**, ao contrário do padrão de [20260727100000_assignee_per_record:38-60](../../apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql#L38-L60). O precedente concede a chave nova a quem já enxerga o módulo correspondente — aqui não há módulo correspondente, e é uma chave de governança: quem pode ver a trilha é decisão deliberada do owner. Owner e papel `system` recebem em runtime via `ALL_PERMISSION_KEYS`. **Registrar isso no PR**, porque é uma exceção consciente ao padrão.

#### Módulo de auditoria (leitura)

**Create**: `apps/api/src/modules/audit/domain/audit.repository.ts`

```ts
import type { AuditAction, AuditEntity, AuditLog } from '@prisma/client';

export const AUDIT_REPOSITORY = 'AUDIT_REPOSITORY';

export interface AuditListFilter {
  ownerId: string;
  entity?: AuditEntity;
  entityId?: string;
  actorId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

export interface AuditRepository {
  findManyAndCount(filter: AuditListFilter): Promise<{ data: AuditLog[]; total: number }>;
  findByEntity(ownerId: string, entity: AuditEntity, entityId: string, take: number): Promise<AuditLog[]>;
}
```

**Create**: `apps/api/src/modules/audit/infra/prisma-audit.repository.ts`

Implementação por `prisma.db` (dentro da transação do request → RLS aplicado; o filtro por `ownerId` continua explícito, como em todo repositório do projeto). Ordenação `createdAt: 'desc'`.

**Create**: `apps/api/src/modules/audit/application/audit-query.service.ts`

`list(ownerId, query)` com `normalizePage`/`paginated` (`shared/pagination`) e `byEntity(ownerId, entity, entityId)` com `take: 100`.

**Create**: `apps/api/src/modules/audit/api/audit.controller.ts` e `api/dto/list-audit-query.dto.ts`

```ts
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @RequirePermission('auditoria:ver')
  @Get()
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListAuditQueryDto) {
    return this.audit.list(ownerId, query);
  }

  @RequirePermission('auditoria:ver')
  @Get('entities/:entity/:id')
  byEntity(
    @CurrentOwnerId() ownerId: string,
    @Param('entity', new ParseEnumPipe(AuditEntity)) entity: AuditEntity,
    @Param('id') id: string,
  ) {
    return this.audit.byEntity(ownerId, entity, id);
  }
}
```

O DTO valida `entity`/`action` contra os enums (`@IsEnum`, mensagens em pt-BR), `from`/`to` como `AAAA-MM-DD` e `page`/`limit` no molde dos demais DTOs de listagem.

**Modify**: `apps/api/src/modules/audit/audit.module.ts`

O módulo passa a ter controller e repositório. Mantém `@Global()` e continua exportando **só** o `AuditService` (a fronteira do módulo é a escrita da trilha; a leitura é dele mesmo).

**Modify**: `apps/api/ENDPOINTS.md`

Seção `## Auditoria` nova, no formato fixo:

```markdown
### GET /audit
- **Propósito:** Listar a trilha de auditoria do owner, paginada e ordenada da mais recente para a mais antiga, com filtro opcional por entidade, registro, autor, ação e período.
- **Auth:** Bearer (access token). Permissão: `auditoria:ver`.
- **Body:** — (query: `page`, `limit`, `entity?`, `entityId?`, `actorId?`, `action?`, `from?` (`AAAA-MM-DD`), `to?` (`AAAA-MM-DD`)).
- **Resposta:** `200 Paginated<AuditLog>` — cada item traz `actorType`, `actorId`, `actorName`, `entity`, `entityId`, `entityLabel`, `action`, `diff`, `requestId`, `createdAt`. `actorName` e `entityLabel` são o que valia **no momento da ação**.
- **Erros:** `400` (validação), `403 Você não tem permissão para ver a auditoria.`, `401`.
- **Handler:** `modules/audit/api/audit.controller.ts` → `AuditController.list`

### GET /audit/entities/:entity/:id
- **Propósito:** Histórico completo de um registro específico (até 100 entradas), para a visão "quem mexeu neste cliente/cobrança/contrato".
- **Auth:** Bearer (access token). Permissão: `auditoria:ver`.
- **Body:** — (`entity` ∈ `CLIENT | CONTACT | DEAL | PROPOSAL | PROJECT | TASK | CONTRACT | PAYMENT | ROLE | USER | SUBSCRIPTION`).
- **Resposta:** `200 AuditLog[]` (mais recente primeiro).
- **Erros:** `400` (entidade fora do enum), `403`, `401`.
- **Handler:** `modules/audit/api/audit.controller.ts` → `AuditController.byEntity`
```

#### Interface

**Modify**: `apps/web/src/lib/labels.ts`

Tradutores dos três enums novos — obrigatório pelo `apps/web/CLAUDE.md` (nenhum identificador técnico aparece cru):

```ts
export const AUDIT_ACTOR_TYPE_LABELS = {
  USER: 'Pessoa',
  CRON: 'Rotina automática',
  WEBHOOK: 'Integração',
  SISTEMA: 'Sistema',
} as const;
export const translateAuditActorType = make(AUDIT_ACTOR_TYPE_LABELS);

export const AUDIT_ENTITY_LABELS = {
  CLIENT: 'Cliente',
  CONTACT: 'Contato',
  DEAL: 'Oportunidade',
  PROPOSAL: 'Proposta',
  PROJECT: 'Projeto',
  TASK: 'Demanda',
  CONTRACT: 'Contrato',
  PAYMENT: 'Cobrança',
  ROLE: 'Papel',
  USER: 'Colaborador',
  SUBSCRIPTION: 'Assinatura',
} as const;
export const translateAuditEntity = make(AUDIT_ENTITY_LABELS);

export const AUDIT_ACTION_LABELS = {
  CRIAR: 'Criou',
  ATUALIZAR: 'Editou',
  EXCLUIR: 'Excluiu',
  ARQUIVAR: 'Arquivou',
  RESTAURAR: 'Restaurou',
  EXPURGAR: 'Excluiu em definitivo',
  PAGAR: 'Deu baixa',
  ESTORNAR: 'Estornou',
  CANCELAR: 'Cancelou',
  PAUSAR: 'Pausou',
  RETOMAR: 'Retomou',
  ENVIAR: 'Enviou',
  ACEITAR: 'Aceitou',
  RECUSAR: 'Recusou',
  NOVA_VERSAO: 'Criou nova versão',
  CONVIDAR: 'Convidou',
  ATIVAR: 'Reativou',
  DESATIVAR: 'Desativou',
  ALTERAR_PAPEL: 'Alterou o papel',
  EXPIRAR: 'Expirou',
  VENCER: 'Marcou como vencida',
} as const;
export const translateAuditAction = make(AUDIT_ACTION_LABELS);
```

**Create**: `apps/web/src/features/auditoria/api/types.ts`, `audit.api.ts`, `hooks.ts`

No molde de `features/organizacao/api/`. `queryKeys.audit = { all, list(params), byEntity(entity, id) }` em `lib/query-keys.ts`.

**Create**: `apps/web/src/features/auditoria/AuditoriaPage.tsx`

Listagem canônica ([Padrão 8 da PRD](../research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md)): filtros na URL via `useUrlFilters` com objeto estável fora do componente, `useDebouncedValue` de 300 ms no campo de texto, `TableEmpty`/`Skeleton` nos três estados e `Pagination` no rodapé.

```tsx
const AUDITORIA_FILTERS = {
  entity: enumFilter(AUDIT_ENTITIES, 'ALL'),
  action: enumFilter(AUDIT_ACTIONS, 'ALL'),
  actorId: stringFilter(),
  from: stringFilter(),
  to: stringFilter(),
  page: numberFilter(1),
};
```

Colunas: **Quando** (`formatDateTime`), **Quem** (`actorName` + badge de `translateAuditActorType` quando `actorType !== 'USER'`), **O quê** (`translateAuditAction` + `translateAuditEntity` + `entityLabel`), **Detalhes** (botão que abre o diff). O seletor de autor usa `useWorkspaceMembers` ([members-lookup.ts](../../apps/web/src/lib/members-lookup.ts)), que já resolve nome de colaborador desativado.

**Create**: `apps/web/src/features/auditoria/components/DiffView.tsx`

Renderiza `{ campo: { antes, depois } }` como uma lista `campo: antes → depois`, com `—` para `null`. Chaves que não são pares (o `extra`, ex.: `cobrancasCanceladas`) são exibidas como `chave: valor`.

**Create**: `apps/web/src/features/auditoria/HistoricoDialog.tsx`

Diálogo reutilizável: recebe `entity`, `entityId` e `label`, consome `GET /audit/entities/:entity/:id` e lista as entradas em ordem cronológica reversa, com o `DiffView` embutido. A query só roda com o diálogo aberto (`enabled: open`).

**Modify**: `apps/web/src/features/clientes/ClienteDetalheLayout.tsx`

Botão "Histórico" ao lado de "Editar", visível só com `can('auditoria:ver')` (o `useCan` já está importado no arquivo, linha 42):

```tsx
          <div className="flex items-center gap-2">
            {can('auditoria:ver') && (
              <Button variant="outline" onClick={() => setHistoricoOpen(true)}>
                <History data-icon="inline-start" />
                Histórico
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(true)}>…</Button>
            <Button variant="destructive" onClick={() => setArchiveOpen(true)}>…</Button>
          </div>
```

```tsx
      <HistoricoDialog
        open={historicoOpen}
        onOpenChange={setHistoricoOpen}
        entity="CLIENT"
        entityId={id}
        label={client.name}
      />
```

**Modify**: `apps/web/src/app/nav.ts`

```ts
  {
    label: "Organização",
    items: [
      { to: "/colaboradores", label: "Colaboradores", icon: UserCog, permission: ["colaborador:gerenciar"] },
      { to: "/papeis", label: "Papéis", icon: ShieldCheck, permission: ["papel:gerenciar"] },
      { to: "/auditoria", label: "Auditoria", icon: ScrollText, permission: ["auditoria:ver"] },
    ],
  },
```

**Modify**: `apps/web/src/routes/router.tsx`

```tsx
          {
            element: <PermissionRoute permission={['auditoria:ver']} />,
            children: [{ path: '/auditoria', element: <AuditoriaPage /> }],
          },
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test`, `pnpm --filter api build`, `pnpm --filter api lint` — sem erros
- [ ] `pnpm --filter web build` (o `tsc -b` é o portão do frontend) e `pnpm --filter web lint` — sem erros
- [ ] `curl -H "Authorization: Bearer $TOKEN" 'localhost:3000/api/v1/audit?entity=PAYMENT&limit=5'` devolve `Paginated<AuditLog>`
- [ ] Chamar `GET /audit` com um token de colaborador **sem** a chave responde `403 Você não tem permissão para ver a auditoria.`

#### Manual Verification
- [ ] A tela `/auditoria` lista as ações da Fase 2 e da Fase 3 em ordem cronológica reversa, com pessoa, ação e registro legíveis — **nenhum** identificador técnico de enum aparece cru
- [ ] Filtrar por entidade `Cobrança` + ação `Deu baixa` + período restringe a lista, e os filtros sobrevivem a navegar para outra tela e voltar (estão na URL)
- [ ] Uma linha de cron aparece com o badge "Rotina automática" e sem nome de pessoa
- [ ] O botão "Detalhes" mostra o diff no formato `campo: antes → depois`, com `—` onde havia `null`
- [ ] No detalhe de um cliente, "Histórico" abre o diálogo com as entradas daquele cliente; o botão **não** aparece para quem não tem `auditoria:ver`
- [ ] Um papel customizado criado **antes** desta fase continua sem a chave (não houve backfill) e não vê o item "Auditoria" na navegação
- [ ] O owner vê o item; um segundo owner não vê nenhuma linha do primeiro
- [ ] Tema claro e escuro; a tabela rola horizontalmente em tela estreita sem estourar o corpo da página

**⏸ PAUSE**: Fase 8B concluída. Confirmar antes de iniciar a Fase 8C.

---

## Testing Strategy

### Unit Tests

- `audit.service.spec.ts` — o coração da fase. Instanciação direta com `prisma`, `admin` e `cls` mockados. Cobre: autor vindo do CLS, ausência de contexto, propagação de exceção no caminho humano, supressão de exceção no caminho de sistema, montagem do `diff` com `extra`.
- `audit-diff.spec.ts` — teste puro: sem mudança → `null`; campo omitido não vaza; `Decimal`/`Date` normalizados; campo presente só de um lado.
- `access.guard.spec.ts` — atualizado: o contexto é publicado no CLS além de `req.access`.
- Specs de service existentes (`payments`, `contracts`, `proposals`, `collaborators`, `roles`) — ganham o `AuditService` mockado e ao menos uma asserção de registro cada.
- Specs dos dois jobs — `markOverdue`/`expireOverdue` mockados devolvendo array; asserção de uma chamada `registrarPeloSistema` por linha afetada, com o `ownerId` **da linha**.

O padrão do repositório é instanciação direta com `jest.Mocked<Repository>`; não há `Test.createTestingModule`, teste de controller nem e2e — não introduzir nenhum dos três aqui.

### Integration Tests

Sem suíte e2e. A verificação de integração que **precisa** de olho humano, por não ter cobertura possível em unitário:

- **Atomicidade**: provocar erro depois do `registrar` e confirmar que nenhuma linha de trilha sobrevive.
- **RLS e grants**: os dois testes de `psql` da Fase 1 (fail-closed no `SELECT`/`INSERT` sem contexto; `permission denied` no `UPDATE`).
- **Cross-owner nos crons**: duas contas com cobranças vencidas, conferindo que cada linha de trilha nasce com o `ownerId` certo.

### Migration & Rollback

- **Aplicar**: `prisma migrate deploy`. A tabela nasce vazia — não há backfill possível nem desejável (não existe histórico a reconstruir).
- **Rollback**: `DROP TABLE "AuditLog"; DROP TYPE "AuditAction"; DROP TYPE "AuditEntity"; DROP TYPE "AuditActorType";` e reverter o código. Perde-se a trilha acumulada — antes de reverter em produção, exportar (`COPY "AuditLog" TO …` como `crm_user`).
- **Ordem**: a migration pode ir **antes** do código com segurança (uma tabela a mais não afeta a API antiga). O código sem a migration, não.
- **Reversibilidade parcial**: a Fase 2 e a Fase 3 são reversíveis isoladamente removendo as chamadas — a trilha simplesmente para de crescer. A Fase 4 é puramente aditiva.

## Environment Considerations

- **CI/CD**: nenhum passo novo.
- **Migrations**: uma, `20260729100000_audit_log`. Contém o único `REVOKE` do repositório — se o banco de produção foi provisionado fora das migrations, **conferir** com `\dp "AuditLog"` que `crm_app` não ficou com `UPDATE`/`DELETE`.
- **Config/Secrets**: nenhuma variável nova.
- **Multi-environment**: em desenvolvimento os crons rodam às 3h como em produção; para testar, chamar `run()` à mão a partir de um script ou reduzir o `CronExpression` temporariamente (não commitar).
- **Volume**: uma linha por mudança sensível. Na escala atual (agência), na casa de dezenas por dia por owner. `JSONB` sem índice GIN — os filtros são por coluna, não por conteúdo do diff.
- **LGPD**: o `diff` guarda valores de negócio. `document` (CPF/CNPJ) é omitido por regra em `CAMPOS_OMITIDOS`; nome, e-mail e telefone de cliente **podem** entrar num diff de `CLIENT`. Isso é registro legítimo de tratamento, visível só a quem tem `auditoria:ver` dentro do owner — mas é um ponto a citar na política de privacidade.

## Dependencies & Risks

- **Se a gravação da trilha falhar, a ação de negócio falha** (caminho humano). É a escolha correta — trilha e mudança são atômicas —, mas significa que um erro no `AuditService` vira um `500` numa baixa de cobrança. Mitigação: a cobertura unitária do `AuditService` é a mais densa da fase, e o `diff` nunca depende de dado externo.
- **`AuditModule` global** — quebra a regra "um módulo não acessa o interior de outro" na letra, não no espírito: o `AuditService` é um recurso transversal, como o `PrismaService` e o `ClsService`, e não expõe nada de domínio. O `@Global()` está comentado no código com essa justificativa.
- **`AuditLog` cresce sem limite** — nenhuma tabela do projeto tem retenção hoje. Duas saídas quando incomodar: partição por mês (`createdAt`) ou expurgo por `crm_user` (o `REVOKE` impede que a aplicação o faça, o que é o desenho pretendido). Registrado como dívida, não resolvido aqui.
- **Enum `AuditAction` cresce a cada domínio novo** — cada valor novo exige migration (`ALTER TYPE … ADD VALUE`) e tradução em `labels.ts` no mesmo PR. É o custo consciente de ter tipo forte em vez de `String` livre.
- **Corrida no `markOverdue`** — `SELECT` e `UPDATE` separados; uma cobrança paga entre os dois geraria uma linha de trilha a mais. Às 3h, com o mesmo filtro nos dois, é aceitável e está comentado no código.
- **Dependência de ordem entre planos**: 8B deve vir **antes** de 8C. Com a auditoria pronta, as ações de arquivar/restaurar/expurgar da Fase 8C já nascem auditadas (as ações `ARQUIVAR`/`RESTAURAR`/`EXPURGAR` já existem no enum); na ordem inversa, é retrabalho. 8B não depende de 8A.

## References

- PRD: `specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md`
- Planos irmãos: `specs/plans/2026-07-26-fase-8a-sessoes.md`, `specs/plans/2026-07-26-fase-8c-lixeira.md`
- Padrões seguidos: [20260724050000_enable_rls](../../apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql) (template `owner_isolation` e suas invariantes), [20260724040000_create_app_role](../../apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql) (`ALTER DEFAULT PRIVILEGES`, o motivo do `REVOKE`)
- Precedentes: `specs/plans/2026-07-25-colaboradores-e-papeis.md:348-349` (catálogo de eventos e a regra "sem segredo"), `specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md:77` ("o registro mantém o nome de quem foi desativado")
- Escopo declarado: [ROADMAP.md:235-255](../../ROADMAP.md) · [docs/observabilidade.md](../../docs/observabilidade.md)
