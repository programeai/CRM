---
date: 2026-07-27T11:00:31-03:00
author: claude
source_prd: specs/research/2026-07-27-fase-9-notificacoes-e-lembretes.md
git_commit: 4e0f72216695f7169fead5ecb372606a777d289a
branch: main
status: implemented
tags: [spec, notifications, notificacoes, mail, crons, outbox, rls, permissions, web-topbar]
---

# Spec: Fase 9 — Notificações e lembretes

## Overview

Um módulo transversal `notifications` que entrega **três costuras separadas**: o gatilho emite um
*evento de domínio* (o fato + ids), o módulo o traduz em *conteúdo neutro* (`{ tipo, titulo, corpo,
link, dados }`), e cada *destino* renderiza o seu próprio formato. O core nunca monta HTML e nunca
sabe o que é Slack. Plugar canal novo é 1 arquivo em `infra/` + 1 linha no módulo.

A emissão acontece **dentro da transação do request** (ou pelo client admin, no cron) e grava apenas
linhas: uma `Notification` e N `NotificationDelivery` pendentes. A entrega roda **depois do commit**,
varrida por um job de minuto em minuto, com retry/backoff e status por destino. Isso não é
preferência de estilo: `prisma.db` dentro do request é um `Prisma.TransactionClient` com timeout
default de 5s, e o `OwnerContextInterceptor` não tem hook de post-commit
([owner-context.interceptor.ts:43-51](../../apps/api/src/prisma/owner-context.interceptor.ts#L43-L51)).
Um `await fetch()` ali dentro seguraria a transação de negócio aberta durante I/O de rede.

O molde arquitetural inteiro já existe no `AuditService`: par `notificar()` / `notificarPeloSistema()`,
`prisma.db` vs `admin`, módulo `@Global()` exportando só a escrita. A **divergência deliberada** é a
política de exceção — a auditoria deixa a exceção subir no caminho humano de propósito ("se a trilha
não pode ser gravada, a mudança não deve ser aplicada"); notificação é o oposto e **nunca** pode
derrubar a operação de negócio. Isso precisa estar escrito no comentário da classe, ou o próximo
leitor "conserta" para ficar igual à auditoria.

## Current State

Campo aberto — nenhuma linha de notificação em `schema.prisma`, `apps/api/src` ou `apps/web/src`. O
que já existe e será reusado: `@nestjs/schedule` montado
([app.module.ts:40](../../apps/api/src/app.module.ts#L40)), envio de e-mail com templates e dark mode
([mail/templates/layout.ts](../../apps/api/src/mail/templates/layout.ts)), os dois crons diários já
enumerando as linhas afetadas com `ownerId` e rótulo humano, e o `assigneeId` nos quatro modelos da
Fase 7B. Nenhuma dependência nova. Detalhes completos no PRD.

## Desired End State

Ao final das seis fases:

- Um sino no header com badge de não lidas, popover com a lista e "marcar como lida", atualizando por
  polling de 45s **só** na contagem.
- Seis gatilhos emitindo: `RECORD_ASSIGNED` no caminho do request, e `FOLLOW_UP_DUE`,
  `PROPOSAL_EXPIRING`, `PAYMENT_DUE`, `PAYMENT_OVERDUE`, `TASK_OVERDUE` pelos crons.
- Cada usuário com N destinos plugáveis (`IN_APP`, `EMAIL`, `WEBHOOK`, `SLACK`), opt-in como matriz
  **tipo × destino**, gerenciável no Perfil.
- Digest diário por e-mail às 7h BRT para quem tem um destino `EMAIL` ativo.
- Quatro adapters registrados num array-provider sob `NOTIFICATION_CHANNELS`; **zero** `if`/`switch`
  por canal fora do registry.
- `MailService` com um `send()` privado que **devolve resultado** e o `mail.service.spec.ts` que hoje
  não existe.

## What We're NOT Doing

- **Event bus** (`@nestjs/event-emitter`) e **motor de regras** — é a Fase 16, que declara depender
  desta ([ROADMAP.md:418](../../ROADMAP.md#L418)). A porta desta fase aceita emissão programática, que
  é o que a Fase 16 vai consumir.
- **HMAC e segredo-por-destino** no webhook — fechado em **D4**. Vai para a Fase 19 junto da máquina
  de API key com escopos e rotação. Acrescentar assinatura depois é aditivo, não quebra quem já recebe.
- **Webhook de saída do owner** (evento de negócio para sistema externo) — é a Fase 19. O
  `WebhookChannel` desta fase é destino **do usuário** (n8n/Slack pessoal). A distinção precisa estar
  escrita, ou a Fase 19 vira retrabalho.
- **Régua de cobrança ao cliente** (Fase 18), **cadência de follow-up** e **alerta de cliente inativo**
  (Fase 16), **alerta de oportunidade esfriando** (prometido no [README.md:40](../../README.md#L40),
  mas fora dos seis gatilhos do ROADMAP).
- **SSE / WebSocket** — fechado em **D3**. Conexão longa atravessando o proxy da VPS, sem precedente
  no projeto. Se a latência de 45s incomodar, é dívida registrada.
- **Política de retenção/expurgo de notificação antiga** — a auditoria também não tem
  ([audit_log migration:13-14](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L13-L14)).
  Registrado como dívida na Fase 6.
- **Corrigir o `timeZone` dos dois crons legados** — eles continuam em 3h UTC. Dívida conhecida,
  fora do escopo.
- **Janelas de antecedência configuráveis por owner** — os valores são constantes de código nesta fase.

---

## Fase 1: Fundação — outbox, registry, canal in-app e o gatilho "atribuído a você"

### Goal

Emitir de dentro da transação do request e entregar in-app, com o registry de canais funcionando e o
inbox consultável pela API — provado ponta a ponta pelo gatilho `RECORD_ASSIGNED`.

### Changes

#### Modelo de dados

**Modify**: `apps/api/prisma/schema.prisma`

Acrescentar `ACTIVITY` ao enum existente `AuditEntity` (linha 598). Reusar o enum em vez de inventar
um `NotificationEntity` paralelo é a recomendação do PRD; ele já cobre `CLIENT|DEAL|TASK|PROPOSAL|PAYMENT`
e só falta `ACTIVITY`, que os gatilhos (a) e (f) precisam.

```prisma
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
  ACTIVITY   // ← Fase 9: alvo dos gatilhos de follow-up e de atribuição
}
```

Acrescentar as back-relations em `User` (junto do bloco `:40-43`):

```prisma
model User {
  // … campos existentes …
  assignedActivities Activity[]
  invites            CollaboratorInvite[]
  notifications        Notification[]
  notificationTargets  UserNotificationTarget[]

  @@index([ownerId])
}
```

Acrescentar os três enums e os três modelos ao final do arquivo:

```prisma
// --- notificações (Fase 9) ---

/// Natureza do destino. Um usuário pode ter N destinos do MESMO kind
/// (dois e-mails, três webhooks) — por isso destino é linha, não coluna.
enum NotificationChannelKind {
  IN_APP
  EMAIL
  WEBHOOK
  SLACK
}

/// O que aconteceu. Espelha os seis gatilhos do ROADMAP.
enum NotificationType {
  FOLLOW_UP_DUE
  PROPOSAL_EXPIRING
  PAYMENT_DUE
  PAYMENT_OVERDUE
  TASK_OVERDUE
  RECORD_ASSIGNED
}

/// Estado de UMA entrega, num destino. `SKIPPED` = o canal existe mas está
/// desligado por configuração (ex.: EMAIL sem SMTP_HOST) — não é falha.
enum NotificationDeliveryStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

/// O fato notificável, já traduzido para conteúdo neutro em pt-BR. Uma linha
/// por (destinatário, evento); o fan-out para os destinos vive nas deliveries.
///
/// `title`/`body` são DENORMALIZADOS pelo mesmo motivo do `AuditLog.entityLabel`:
/// a central não faz join e o registro guarda o que era verdade na emissão —
/// renomear um cliente não reescreve a notificação de ontem.
model Notification {
  id          String       @id @default(uuid())
  ownerId     String
  /// Destinatário. CASCADE: apagar o usuário apaga as notificações dele (o
  /// oposto de `assigneeId`, que é dado de negócio do owner e usa SET NULL).
  userId      String
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  type        NotificationType
  entity      AuditEntity
  entityId    String
  /// Título curto em pt-BR ("Cobrança a vencer em 3 dias").
  title       String
  /// Uma frase de corpo em pt-BR. Texto puro — NUNCA HTML (quem renderiza é o adapter).
  body        String
  /// Caminho relativo no front (`/propostas/<id>`). Null quando não há tela de destino.
  link        String?
  /// Contexto estruturado para o adapter usar sem reparsear o corpo.
  data        Json?
  /// Idempotência dos gatilhos recorrentes: `PAYMENT_DUE:<id>:2026-08-01`.
  /// NULL no caminho do request — reatribuir um registro DEVE notificar de novo.
  /// Em Postgres, NULLs são distintos entre si, então o unique abaixo nunca
  /// colide para as notificações sem chave.
  dedupeKey   String?
  createdAt   DateTime     @default(now())
  deliveries  NotificationDelivery[]

  @@unique([userId, dedupeKey])
  @@index([ownerId, userId, createdAt])
}

/// Uma tentativa de entrega, num destino. É a linha do outbox.
///
/// `userId` e `createdAt` são denormalizados da `Notification` de propósito: por
/// **D1** o inbox filtra AQUI (`kind='IN_APP'`, `readAt IS NULL`) e ordena por
/// data, e sem a denormalização o índice não cobriria filtro + ordenação juntos.
model NotificationDelivery {
  id             String                 @id @default(uuid())
  ownerId        String
  notificationId String
  notification   Notification           @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  userId         String
  createdAt      DateTime               @default(now())
  /// SET NULL, não CASCADE: apagar um destino não pode apagar o histórico do
  /// inbox. O dispatch marca SKIPPED a pendente que ficou sem destino.
  targetId       String?
  target         UserNotificationTarget? @relation(fields: [targetId], references: [id], onDelete: SetNull)
  kind           NotificationChannelKind
  status         NotificationDeliveryStatus @default(PENDING)
  attempts       Int                    @default(0)
  nextAttemptAt  DateTime               @default(now())
  /// Mensagem de erro TRUNCADA da última tentativa. Nunca a config do destino.
  lastError      String?
  sentAt         DateTime?
  /// Só faz sentido em `kind = IN_APP` — é o "lida" da central (D1).
  readAt         DateTime?

  @@index([ownerId, userId, kind, readAt, createdAt])
  @@index([status, nextAttemptAt])
  @@index([notificationId])
}

/// Um destino de notificação de um usuário. N do mesmo `kind` são permitidos.
///
/// `config` CARREGA SEGREDO — a URL de um webhook do Slack É a credencial de
/// escrita naquele canal. Nunca vai crua na resposta da API nem em log.
model UserNotificationTarget {
  id         String                  @id @default(uuid())
  /// Denormalizado p/ RLS. A tabela fica DENTRO do RLS, como `Subscription`:
  /// só é tocada em rota autenticada (ver a nota da migration).
  ownerId    String
  userId     String
  user       User                    @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind       NotificationChannelKind
  /// Rótulo dado pelo usuário ("Meu e-mail", "n8n de casa").
  label      String
  /// IN_APP: `{}`. EMAIL: `{ "email": "…" }`. WEBHOOK/SLACK: `{ "url": "https://…" }`.
  config     Json
  /// Opt-in: quais tipos este destino recebe. Vazio = nenhum. Mesmo desenho de
  /// `Role.permissions` (String[] no próprio registro), e é o que faz a matriz
  /// de preferências ser tipo × DESTINO, não tipo × kind.
  types      NotificationType[]      @default([])
  /// WEBHOOK/SLACK só entregam depois de verificados (D4). IN_APP/EMAIL nascem true.
  verified   Boolean                 @default(false)
  active     Boolean                 @default(true)
  createdAt  DateTime                @default(now())
  updatedAt  DateTime                @updatedAt
  deliveries NotificationDelivery[]

  @@index([ownerId, userId])
}
```

**Create**: `apps/api/prisma/migrations/20260731100000_notifications/migration.sql`

Timestamp na sequência (a última é `20260730100000_soft_delete_lixeira`). Escrito à mão, como todas
desde `20260724040000`.

```sql
-- Notificações: outbox transacional + destinos plugáveis por usuário.
--
-- Notas de projeto:
--  * Template `owner_isolation` (ver 20260724050000_enable_rls): ownerId TEXT
--    denormalizado, SEM cast ::uuid; current_setting(…, true) é missing_ok →
--    contexto ausente casa zero linhas (fail-closed); USING e WITH CHECK
--    idênticos; FORCE sujeita o dono da tabela.
--  * SEM o REVOKE do AuditLog: ao contrário da trilha, notificação é mutável —
--    `readAt` e o status de entrega exigem UPDATE de crm_app.
--  * Sem GRANT explícito: o `ALTER DEFAULT PRIVILEGES` de
--    20260724040000_create_app_role já concede os quatro verbos a crm_app em
--    toda tabela criada depois por crm_user (que é quem roda as migrations).
--  * UserNotificationTarget fica DENTRO do RLS, ao lado de Subscription: é
--    tocada só em rota autenticada. O critério do repo é o contrário do de
--    Session (que nasce no login @Public e por isso fica fora).
--  * FK para "User" com ON DELETE CASCADE nos três modelos: notificação e
--    destino são dado DA PESSOA, não do owner — o oposto de `assigneeId`, que
--    usa SET NULL porque é dado de negócio da workspace.
--  * NotificationDelivery."targetId" é SET NULL de propósito: apagar um destino
--    não pode apagar o histórico da central.
--  * O índice do outbox NÃO começa por ownerId — a varredura é cross-owner pelo
--    client admin. É a mesma exceção justificada de Payment.@@index([dueDate,status]).
--  * Roda como crm_user (superuser), que bypassa RLS.

-- ALTER TYPE ... ADD VALUE roda dentro de transação no PG 12+ desde que o valor
-- novo não seja USADO na mesma transação. Aqui só é declarado.
ALTER TYPE "AuditEntity" ADD VALUE 'ACTIVITY';

CREATE TYPE "NotificationChannelKind" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK', 'SLACK');

CREATE TYPE "NotificationType" AS ENUM (
  'FOLLOW_UP_DUE', 'PROPOSAL_EXPIRING', 'PAYMENT_DUE',
  'PAYMENT_OVERDUE', 'TASK_OVERDUE', 'RECORD_ASSIGNED'
);

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "UserNotificationTarget" (
  "id"        TEXT                      NOT NULL,
  "ownerId"   TEXT                      NOT NULL,
  "userId"    TEXT                      NOT NULL,
  "kind"      "NotificationChannelKind" NOT NULL,
  "label"     TEXT                      NOT NULL,
  "config"    JSONB                     NOT NULL,
  "types"     "NotificationType"[]      NOT NULL DEFAULT ARRAY[]::"NotificationType"[],
  "verified"  BOOLEAN                   NOT NULL DEFAULT false,
  "active"    BOOLEAN                   NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)              NOT NULL,

  CONSTRAINT "UserNotificationTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id"        TEXT               NOT NULL,
  "ownerId"   TEXT               NOT NULL,
  "userId"    TEXT               NOT NULL,
  "type"      "NotificationType" NOT NULL,
  "entity"    "AuditEntity"      NOT NULL,
  "entityId"  TEXT               NOT NULL,
  "title"     TEXT               NOT NULL,
  "body"      TEXT               NOT NULL,
  "link"      TEXT,
  "data"      JSONB,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id"             TEXT                         NOT NULL,
  "ownerId"        TEXT                         NOT NULL,
  "notificationId" TEXT                         NOT NULL,
  "userId"         TEXT                         NOT NULL,
  "createdAt"      TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "targetId"       TEXT,
  "kind"           "NotificationChannelKind"    NOT NULL,
  "status"         "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER                      NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError"      TEXT,
  "sentAt"         TIMESTAMP(3),
  "readAt"         TIMESTAMP(3),

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserNotificationTarget_ownerId_userId_idx"
  ON "UserNotificationTarget"("ownerId", "userId");

-- NULLs são distintos entre si no unique do Postgres: notificação sem
-- dedupeKey (o caminho do request) nunca colide.
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key"
  ON "Notification"("userId", "dedupeKey");
CREATE INDEX "Notification_ownerId_userId_createdAt_idx"
  ON "Notification"("ownerId", "userId", "createdAt");

-- Inbox: filtra por (owner, usuário, kind, lida) e ordena por data — o índice
-- cobre as quatro colunas do WHERE mais a do ORDER BY.
CREATE INDEX "NotificationDelivery_ownerId_userId_kind_readAt_createdAt_idx"
  ON "NotificationDelivery"("ownerId", "userId", "kind", "readAt", "createdAt");
-- Outbox: varredura cross-owner. Sem ownerId na frente, de propósito.
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_notificationId_idx"
  ON "NotificationDelivery"("notificationId");

ALTER TABLE "UserNotificationTarget" ADD CONSTRAINT "UserNotificationTarget_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "UserNotificationTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (template owner_isolation) — nas TRÊS tabelas.
ALTER TABLE "UserNotificationTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserNotificationTarget" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "UserNotificationTarget"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Notification"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

ALTER TABLE "NotificationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDelivery" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "NotificationDelivery"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
```

> **Atenção — o meta-teste de RLS quebra de propósito.**
> [rls.e2e-spec.ts:89](../../apps/api/test/rls.e2e-spec.ts#L89) fixa `expect(Number(total)).toBe(15)`.
> Com três tabelas novas, vira **18**. O comentário logo acima
> ([:83-85](../../apps/api/test/rls.e2e-spec.ts#L83-L85)) diz que subir esse número é parte do
> trabalho — é o momento de confirmar que as três precisam mesmo de policy. Precisam.

#### Módulo `notifications` — a porta

**Create**: `apps/api/src/modules/notifications/domain/notification-channel.ts`

```ts
import type { NotificationChannelKind, NotificationType, Prisma } from '@prisma/client';

/** Token do array-provider dos canais. Ver o comentário do NotificationsModule. */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

/** Um destino concreto, como o adapter precisa vê-lo. */
export interface DestinoDeNotificacao {
  id: string;
  kind: NotificationChannelKind;
  /** `{}` no IN_APP, `{ email }` no EMAIL, `{ url }` no WEBHOOK/SLACK. */
  config: Prisma.JsonValue;
}

/**
 * Conteúdo neutro: o que aconteceu, em pt-BR, SEM formato de destino nenhum.
 * `corpo` é texto puro. Se algum dia aparecer HTML aqui, a costura quebrou.
 */
export interface ConteudoDeNotificacao {
  tipo: NotificationType;
  titulo: string;
  corpo: string;
  /** Caminho relativo no front (`/propostas/<id>`); o adapter prefixa o host. */
  link: string | null;
  dados: Record<string, unknown> | null;
  /** Id da entrega. Vira `X-CRM-Delivery` no webhook — é o que permite dedupe. */
  deliveryId: string;
}

/**
 * Porta única de entrega. Um adapter por destino, em `infra/`.
 *
 * `entregar` **rejeita** quando falha — é o que alimenta o retry/backoff e o
 * `NotificationDelivery.status`. Adapter que engole a exceção torna o status
 * decorativo (foi exatamente o problema do `MailService`, ver Fase 4).
 */
export interface CanalDeNotificacao {
  readonly kind: NotificationChannelKind;
  /** Contrato de "serviço opcional" (MailService/CaptchaService): sem config, desligado. */
  isEnabled(): boolean;
  entregar(destino: DestinoDeNotificacao, conteudo: ConteudoDeNotificacao): Promise<void>;
}
```

**Create**: `apps/api/src/modules/notifications/domain/notification.repository.ts`

```ts
import type { Notification, NotificationDelivery, Prisma } from '@prisma/client';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

/** Linha da central: a entrega IN_APP com o conteúdo da notificação junto. */
export type InboxItem = NotificationDelivery & { notification: Notification };

export interface InboxFilter {
  ownerId: string;
  userId: string;
  unreadOnly?: boolean;
  skip: number;
  take: number;
}

/** Entrega pendente, com tudo que o dispatch precisa — sem segunda ida ao banco. */
export type PendingDelivery = NotificationDelivery & {
  notification: Notification;
  target: { id: string; kind: NotificationChannelKind; config: Prisma.JsonValue } | null;
};

export interface NotificationRepository {
  /** Cria a notificação e as entregas num único create aninhado (request, `prisma.db`). */
  criar(data: Prisma.NotificationUncheckedCreateInput): Promise<Notification>;
  /** Idem, pelo client admin — cron cross-owner, sem `app.owner_id`. */
  criarPeloSistema(data: Prisma.NotificationUncheckedCreateInput): Promise<Notification>;
  /** Das chaves informadas, quais JÁ existem para o usuário (pré-filtro de dedupe). */
  dedupeKeysExistentes(userId: string, chaves: string[]): Promise<Set<string>>;

  findInboxAndCount(filter: InboxFilter): Promise<{ data: InboxItem[]; total: number }>;
  contarNaoLidas(ownerId: string, userId: string): Promise<number>;
  /** Marca UMA entrega IN_APP como lida. Devolve false se não é do usuário. */
  marcarLida(ownerId: string, userId: string, deliveryId: string): Promise<boolean>;
  /** Marca todas as não lidas do usuário. Devolve quantas. */
  marcarTodasLidas(ownerId: string, userId: string): Promise<number>;

  // --- outbox (client admin, cross-owner) ---
  findPendentes(now: Date, take: number): Promise<PendingDelivery[]>;
  marcarEnviada(id: string, sentAt: Date): Promise<void>;
  marcarPulada(id: string, motivo: string): Promise<void>;
  marcarFalha(id: string, attempts: number, nextAttemptAt: Date | null, erro: string): Promise<void>;
}
```

**Create**: `apps/api/src/modules/notifications/domain/notification-target.repository.ts`

```ts
import type { NotificationChannelKind, NotificationType, Prisma, UserNotificationTarget } from '@prisma/client';

export const NOTIFICATION_TARGET_REPOSITORY = Symbol('NOTIFICATION_TARGET_REPOSITORY');

export interface NotificationTargetRepository {
  /** Destinos ativos+verificados do usuário que assinaram este tipo (request). */
  findElegiveis(ownerId: string, userId: string, tipo: NotificationType):
    Promise<Pick<UserNotificationTarget, 'id' | 'kind'>[]>;
  /** Idem, pelo client admin — o cron não tem `app.owner_id`. */
  findElegiveisPeloSistema(ownerId: string, userId: string, tipo: NotificationType):
    Promise<Pick<UserNotificationTarget, 'id' | 'kind'>[]>;

  findManyByUser(ownerId: string, userId: string): Promise<UserNotificationTarget[]>;
  criar(data: Prisma.UserNotificationTargetUncheckedCreateInput): Promise<UserNotificationTarget>;
  atualizar(ownerId: string, userId: string, id: string, data: Prisma.UserNotificationTargetUpdateInput):
    Promise<UserNotificationTarget | null>;
  excluir(ownerId: string, userId: string, id: string): Promise<boolean>;

  /** Provisionamento na criação da conta / aceite de convite — client admin. */
  provisionarPadraoPeloSistema(params: {
    ownerId: string; userId: string; email: string; kinds: NotificationChannelKind[];
  }): Promise<void>;
}
```

#### Módulo `notifications` — conteúdo neutro

**Create**: `apps/api/src/modules/notifications/application/notification-content.ts`

O tradutor evento → conteúdo. Nasce com um caso; as fases 3 e 4 acrescentam os outros cinco à união.

```ts
import type { AuditEntity, NotificationType } from '@prisma/client';

/**
 * O FATO, como o gatilho o conhece — ids e rótulos, nada de texto pronto. É a
 * primeira das três costuras; `montarConteudo` faz a segunda, e o adapter a terceira.
 */
export type EventoDeNotificacao = {
  tipo: 'RECORD_ASSIGNED';
  entity: AuditEntity;
  entityId: string;
  /** Rótulo humano do registro no momento da atribuição ("Site institucional"). */
  entityLabel: string;
  /** Só quando `entity = ACTIVITY`: a timeline mora sob o cliente. */
  clientId?: string;
};

/**
 * O que o SERVIÇO sabe e o gatilho não precisa buscar. `autorNome` sai do
 * `AccessContext` do CLS e é injetado pelo `NotificationsService` — o gatilho
 * nunca o passa, senão os quatro pontos de emissão teriam de ler o CLS sozinhos
 * (era exatamente a duplicação que este parâmetro elimina).
 *
 * `null` no caminho do cron e, no futuro, numa regra da Fase 16: ninguém agiu.
 */
export interface ContextoDeEmissao {
  autorNome: string | null;
}

export interface ConteudoNeutro {
  tipo: NotificationType;
  entity: AuditEntity;
  entityId: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
}

/** Rótulo do registro em pt-BR. Espelha `AUDIT_ENTITY_LABELS` do apps/web. */
const ENTIDADE: Record<AuditEntity, string> = {
  CLIENT: 'o cliente', CONTACT: 'o contato', DEAL: 'a oportunidade',
  PROPOSAL: 'a proposta', PROJECT: 'o projeto', TASK: 'a demanda',
  CONTRACT: 'o contrato', PAYMENT: 'a cobrança', ROLE: 'o papel',
  USER: 'o colaborador', SUBSCRIPTION: 'a assinatura', ACTIVITY: 'a atividade',
};

/**
 * Caminho no FRONT, relativo. Nem todo registro tem tela própria: oportunidade
 * abre o quadro e demanda abre "Minhas demandas" — é onde a pessoa acha o item.
 */
export function linkDoRegistro(
  entity: AuditEntity, entityId: string, clientId?: string,
): string | null {
  switch (entity) {
    case 'CLIENT':   return `/clientes/${entityId}`;
    case 'ACTIVITY': return clientId ? `/clientes/${clientId}/timeline` : null;
    case 'DEAL':     return '/pipeline';
    case 'TASK':     return '/demandas';
    case 'PROPOSAL': return `/propostas/${entityId}`;
    case 'PAYMENT':  return '/financeiro';
    case 'PROJECT':  return `/projetos/${entityId}`;
    default:         return null;
  }
}

/** Evento de domínio → conteúdo neutro em pt-BR. Texto puro, NUNCA HTML. */
export function montarConteudo(
  evento: EventoDeNotificacao,
  contexto: ContextoDeEmissao,
): ConteudoNeutro {
  switch (evento.tipo) {
    case 'RECORD_ASSIGNED':
      return {
        tipo: 'RECORD_ASSIGNED',
        entity: evento.entity,
        entityId: evento.entityId,
        title: `Atribuíram ${ENTIDADE[evento.entity]} a você`,
        // Sem autor conhecido (cron, ou uma regra da Fase 16), a frase é
        // impessoal em vez de inventar um sujeito.
        body: contexto.autorNome
          ? `${contexto.autorNome} definiu você como responsável por ${evento.entityLabel}.`
          : `Você foi definido como responsável por ${evento.entityLabel}.`,
        link: linkDoRegistro(evento.entity, evento.entityId, evento.clientId),
        data: { entity: evento.entity, entityId: evento.entityId },
      };
  }
}
```

#### Módulo `notifications` — o serviço transversal

**Create**: `apps/api/src/modules/notifications/notifications.service.ts`

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { NotificationChannelKind, Prisma } from '@prisma/client';
import { ACCESS_CONTEXT, type AccessContext } from '../access/domain/access-context';
import { NOTIFICATION_REPOSITORY, type NotificationRepository } from './domain/notification.repository';
import {
  NOTIFICATION_TARGET_REPOSITORY, type NotificationTargetRepository,
} from './domain/notification-target.repository';
import { montarConteudo, type EventoDeNotificacao } from './application/notification-content';

/** Emissão no caminho de requisição HTTP. */
export interface EntradaDeNotificacao {
  /** Destinatário. É `User.id`, NÃO `ownerId` — é a única entidade do sistema
   *  endereçada por pessoa, e é por isso que o gatilho precisa derivá-lo. */
  userId: string;
  evento: EventoDeNotificacao;
}

/** Emissão fora do request (cron): `ownerId` explícito e dedupe. */
export interface EntradaDeSistema extends EntradaDeNotificacao {
  ownerId: string;
  /** Idempotência do gatilho recorrente. Ver `NotificationsRemindersJob`. */
  dedupeKey?: string;
}

/**
 * Emissão de notificação. Mesmo desenho de duas superfícies do `AuditService`:
 * `notificar` roda por `prisma.db` (dentro da transação do request) e
 * `notificarPeloSistema` pelo client admin (cron cross-owner, sem `app.owner_id`).
 *
 * **DIVERGÊNCIA DELIBERADA em relação ao AuditService — não "conserte" para ficar
 * igual.** A auditoria deixa a exceção subir no caminho humano de propósito: se a
 * trilha não pode ser gravada, a mudança não deve ser aplicada. Aqui é o oposto —
 * uma notificação que falha **não pode** derrubar a operação de negócio que a
 * disparou. Os DOIS métodos engolem a exceção e logam.
 *
 * O que roda dentro da transação é só banco: um SELECT nos destinos (tabela
 * pequena e indexada) e um create aninhado. **Zero I/O de rede** — a transação
 * do request usa o timeout default do Prisma (5s), e a entrega de verdade
 * acontece depois do commit, varrida pelo `NotificationsDispatchJob`.
 *
 * `notificar` carrega DUAS regras que valem para qualquer gatilho do caminho
 * humano, e é por isso que elas moram aqui e não em cada ponto de emissão:
 *  1. **Ninguém é notificado da própria ação.** Quem acabou de atribuir o
 *     registro a si mesmo não precisa de aviso — estava olhando a tela.
 *  2. **O autor vem do CLS**, não do gatilho. `AccessContext.userName` já está
 *     resolvido; fazer cada service lê-lo seria injetar `ClsService` em quatro
 *     módulos de negócio para repetir a mesma linha.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    @Inject(NOTIFICATION_TARGET_REPOSITORY) private readonly targets: NotificationTargetRepository,
    private readonly cls: ClsService,
  ) {}

  async notificar(entrada: EntradaDeNotificacao): Promise<void> {
    const access = this.cls.get<AccessContext>(ACCESS_CONTEXT);
    if (!access) {
      this.logger.warn({
        evento: 'notificacao.sem_contexto',
        msg: 'Tentativa de notificar sem contexto de acesso.',
        tipo: entrada.evento.tipo,
      });
      return;
    }
    // Regra 1. Antes de qualquer ida ao banco: o caso mais comum de um gatilho
    // de request é a pessoa agindo sobre o próprio registro.
    if (entrada.userId === access.userId) return;
    try {
      const destinos = await this.targets.findElegiveis(
        access.ownerId, entrada.userId, entrada.evento.tipo,
      );
      if (destinos.length === 0) return;
      await this.repo.criar(
        this.montarLinha(access.ownerId, entrada.userId, entrada.evento, destinos, null, {
          autorNome: access.userName,   // regra 2
        }),
      );
    } catch (erro) {
      this.falhou(entrada.evento.tipo, erro);
    }
  }

  async notificarPeloSistema(entrada: EntradaDeSistema): Promise<void> {
    try {
      const destinos = await this.targets.findElegiveisPeloSistema(
        entrada.ownerId, entrada.userId, entrada.evento.tipo,
      );
      if (destinos.length === 0) return;
      await this.repo.criarPeloSistema(
        this.montarLinha(
          entrada.ownerId, entrada.userId, entrada.evento, destinos, entrada.dedupeKey ?? null,
          // Fora do request não há ator humano — é a razão de `autorNome` ser
          // anulável e de o conteúdo ter a variante impessoal.
          { autorNome: null },
        ),
      );
    } catch (erro) {
      // P2002 = corrida no dedupe (o pré-filtro do job já cobre o caso normal).
      // Notificação repetida evitada não é erro; qualquer outra falha é.
      if ((erro as { code?: string }).code === 'P2002') return;
      this.falhou(entrada.evento.tipo, erro);
    }
  }

  /** A notificação e as N entregas num único create aninhado (uma ida ao banco). */
  private montarLinha(
    ownerId: string,
    userId: string,
    evento: EventoDeNotificacao,
    destinos: { id: string; kind: NotificationChannelKind }[],
    dedupeKey: string | null,
    contexto: ContextoDeEmissao,
  ): Prisma.NotificationUncheckedCreateInput {
    const conteudo = montarConteudo(evento, contexto);
    return {
      ownerId,
      userId,
      type: conteudo.tipo,
      entity: conteudo.entity,
      entityId: conteudo.entityId,
      title: conteudo.title,
      body: conteudo.body,
      link: conteudo.link,
      data: (conteudo.data ?? undefined) as Prisma.InputJsonValue | undefined,
      dedupeKey,
      deliveries: {
        create: destinos.map((d) => ({
          ownerId, userId, targetId: d.id, kind: d.kind,
        })),
      },
    };
  }

  /** Nunca loga título/corpo: eles carregam nome de cliente e valor de cobrança,
   *  e o Grafana é publicado na internet (docs/observabilidade.md:149-152). */
  private falhou(tipo: string, erro: unknown): void {
    this.logger.error(
      { evento: 'notificacao.emissao_falhou', msg: 'Falha ao emitir notificação.', tipo },
      erro instanceof Error ? erro.stack : undefined,
    );
  }
}
```

#### Módulo `notifications` — dispatcher e job de varredura

**Create**: `apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts`

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannelKind } from '@prisma/client';
import {
  NOTIFICATION_CHANNELS, type CanalDeNotificacao,
} from '../domain/notification-channel';
import {
  NOTIFICATION_REPOSITORY, type NotificationRepository, type PendingDelivery,
} from '../domain/notification.repository';

/** Espera entre tentativas, em minutos. O tamanho do array é o MÁXIMO de tentativas. */
const BACKOFF_MIN = [1, 5, 30, 120, 480];

export interface ResultadoDoLote {
  entregues: number;
  falhas: number;
  puladas: number;
}

@Injectable()
export class NotificationsDispatcherService {
  private readonly logger = new Logger(NotificationsDispatcherService.name);
  private readonly registry: Map<NotificationChannelKind, CanalDeNotificacao>;

  constructor(
    @Inject(NOTIFICATION_CHANNELS) canais: CanalDeNotificacao[],
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {
    this.registry = new Map(canais.map((c) => [c.kind, c]));
  }

  /**
   * Entrega um lote. `Promise.allSettled`: um destino que falha não derruba os
   * outros — nem os do mesmo usuário, nem os dos outros owners do lote.
   */
  async despacharLote(pendentes: PendingDelivery[]): Promise<ResultadoDoLote> {
    const r: ResultadoDoLote = { entregues: 0, falhas: 0, puladas: 0 };
    const resultados = await Promise.allSettled(
      pendentes.map((p) => this.despachar(p)),
    );
    for (const res of resultados) {
      if (res.status === 'rejected') { r.falhas++; continue; }
      if (res.value === 'SENT') r.entregues++;
      else if (res.value === 'SKIPPED') r.puladas++;
      else r.falhas++;
    }
    return r;
  }

  private async despachar(p: PendingDelivery): Promise<'SENT' | 'SKIPPED' | 'FAILED'> {
    const canal = this.registry.get(p.kind);
    if (!canal) {
      await this.repo.marcarPulada(p.id, 'Canal não registrado.');
      return 'SKIPPED';
    }
    if (!canal.isEnabled()) {
      await this.repo.marcarPulada(p.id, 'Canal desabilitado por configuração.');
      return 'SKIPPED';
    }
    if (!p.target) {
      // O destino foi apagado depois da emissão (FK é SET NULL).
      await this.repo.marcarPulada(p.id, 'Destino removido.');
      return 'SKIPPED';
    }

    try {
      await canal.entregar(
        { id: p.target.id, kind: p.target.kind, config: p.target.config },
        {
          tipo: p.notification.type,
          titulo: p.notification.title,
          corpo: p.notification.body,
          link: p.notification.link,
          dados: p.notification.data as Record<string, unknown> | null,
          deliveryId: p.id,
        },
      );
      await this.repo.marcarEnviada(p.id, new Date());
      return 'SENT';
    } catch (erro) {
      const attempts = p.attempts + 1;
      const espera = BACKOFF_MIN[attempts - 1];
      const proxima = espera == null
        ? null // esgotou: FAILED definitivo
        : new Date(Date.now() + espera * 60_000);
      await this.repo.marcarFalha(p.id, attempts, proxima, this.mensagem(erro));
      // Sem título/corpo/config no log — o Grafana é público.
      this.logger.error({
        evento: 'notificacao.entrega_falhou',
        msg: 'Falha ao entregar notificação num destino.',
        canal: p.kind,
        entregaId: p.id,
        tentativa: attempts,
        definitiva: proxima === null,
      });
      return 'FAILED';
    }
  }

  /** Trunca em 500: `lastError` é diagnóstico, não dump. */
  private mensagem(erro: unknown): string {
    return (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
  }
}
```

**Create**: `apps/api/src/modules/notifications/application/notifications-dispatch.job.ts`

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NOTIFICATION_REPOSITORY, type NotificationRepository } from '../domain/notification.repository';
import { NotificationsDispatcherService } from './notifications-dispatcher.service';

/** Teto por rodada. Com 1 rodada por minuto dá vazão de 12k entregas/hora. */
const LOTE = 200;

/**
 * Varredura do outbox. É o mecanismo de dispatch porque **não há hook de
 * post-commit**: o `OwnerContextInterceptor` devolve `from($transaction(...))` e
 * nada roda entre o commit e a resposta. A alternativa seria um `tap()` depois da
 * transação, no arquivo mais crítico do projeto (o mesmo que carrega a ordem dos
 * guards marcada como "não altere"). Job é a escolha barata e reversível.
 *
 * `name:` explícito — os dois crons legados não têm, e a Fase 9 acrescenta três.
 */
@Injectable()
export class NotificationsDispatchJob {
  private readonly logger = new Logger(NotificationsDispatchJob.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    private readonly dispatcher: NotificationsDispatcherService,
  ) {}

  @Cron('* * * * *', { name: 'notificacoes-dispatch' })
  async run(): Promise<void> {
    const pendentes = await this.repo.findPendentes(new Date(), LOTE);
    if (pendentes.length === 0) return;
    const r = await this.dispatcher.despacharLote(pendentes);
    // Log AGREGADO por lote, com guard > 0 — o padrão dos dois jobs existentes.
    this.logger.log({
      evento: 'notificacao.lote_entregue',
      msg: 'Lote de notificações despachado.',
      quantidade: pendentes.length,
      entregues: r.entregues,
      falhas: r.falhas,
      puladas: r.puladas,
    });
  }
}
```

#### Módulo `notifications` — canal in-app

**Create**: `apps/api/src/modules/notifications/infra/in-app.channel.ts`

```ts
import { Injectable } from '@nestjs/common';
import type { NotificationChannelKind } from '@prisma/client';
import type {
  CanalDeNotificacao, ConteudoDeNotificacao, DestinoDeNotificacao,
} from '../domain/notification-channel';

/**
 * Canal in-app. Por **D1** o in-app é um canal como os outros, não um caminho
 * privilegiado: a central é `Notification ⋈ NotificationDelivery(kind='IN_APP')`
 * e o `readAt` mora na entrega.
 *
 * `entregar` é um no-op que sucede — para o in-app, **existir na tabela É a
 * entrega**. O job só vira o status para `SENT`, e a central lê por `kind`, sem
 * filtrar por status: a notificação aparece no sino no instante do commit, não
 * um minuto depois. O adapter existe mesmo assim, para que o registry não tenha
 * exceção e "desligar o in-app" seja desativar um destino como qualquer outro.
 */
@Injectable()
export class InAppChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'IN_APP';

  isEnabled(): boolean {
    return true;
  }

  entregar(_destino: DestinoDeNotificacao, _conteudo: ConteudoDeNotificacao): Promise<void> {
    return Promise.resolve();
  }
}
```

#### Módulo `notifications` — repositórios, leitura, API

**Create**: `apps/api/src/modules/notifications/infra/prisma-notification.repository.ts`

Implementa `NotificationRepository`. Regras não-negociáveis:
- `criar`, `findInboxAndCount`, `contarNaoLidas`, `marcarLida`, `marcarTodasLidas` → `this.prisma.db.*`
  com `ownerId` **e** `userId` explícitos no `where` (a convenção de todo repositório do projeto; a
  policy é a segunda barreira, não a primeira).
- `criarPeloSistema`, `dedupeKeysExistentes`, `findPendentes`, `marcarEnviada/Pulada/Falha` →
  `this.admin.*`, com o comentário `// Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).`
- `findInboxAndCount` filtra `{ ownerId, userId, kind: 'IN_APP' }` (+ `readAt: null` se `unreadOnly`),
  ordena `createdAt: 'desc'`, `include: { notification: true }`. **Nunca** filtra por `status` — ver
  o comentário do `InAppChannel`.
- `marcarLida` usa `updateMany({ where: { id, ownerId, userId, kind: 'IN_APP', readAt: null } })` e
  devolve `count > 0`; assim uma entrega de outra pessoa devolve `false` em vez de vazar existência.
- `findPendentes`: `where { status: 'PENDING', nextAttemptAt: { lte: now } }`, `orderBy: { nextAttemptAt: 'asc' }`,
  `take`, `include: { notification: true, target: { select: { id: true, kind: true, config: true } } }`.
- `marcarFalha(id, attempts, nextAttemptAt, erro)`: `status` vira `'FAILED'` quando `nextAttemptAt`
  é `null`, senão continua `'PENDING'` com o `nextAttemptAt` novo.

**Create**: `apps/api/src/modules/notifications/infra/prisma-notification-target.repository.ts`

- `findElegiveis(ownerId, userId, tipo)`: `this.prisma.db.userNotificationTarget.findMany({ where: { ownerId, userId, active: true, verified: true, types: { has: tipo } }, select: { id: true, kind: true } })`.
- `findElegiveisPeloSistema`: idêntico, por `this.admin`.
- `provisionarPadraoPeloSistema`: `createMany` dos kinds pedidos, com `types: TIPOS_PADRAO`,
  `verified: true`, `active: true`, e `config` `{}` no `IN_APP` / `{ email }` no `EMAIL`.

**Create**: `apps/api/src/modules/notifications/application/notifications-query.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { NOTIFICATION_REPOSITORY, type NotificationRepository } from '../domain/notification.repository';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { ListNotificationsQueryDto } from '../api/dto/list-notifications-query.dto';

@Injectable()
export class NotificationsQueryService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {}

  async list(ownerId: string, userId: string, query: ListNotificationsQueryDto) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findInboxAndCount({
      ownerId, userId, unreadOnly: query.unreadOnly, skip, take,
    });
    return paginated(data.map(paraItem), total, page, limit);
  }

  async contarNaoLidas(ownerId: string, userId: string) {
    return { count: await this.repo.contarNaoLidas(ownerId, userId) };
  }

  marcarLida(ownerId: string, userId: string, deliveryId: string) {
    return this.repo.marcarLida(ownerId, userId, deliveryId);
  }

  async marcarTodasLidas(ownerId: string, userId: string) {
    return { updated: await this.repo.marcarTodasLidas(ownerId, userId) };
  }
}

/** Achata a entrega + notificação num item de central. O front não vê o modelo cru. */
function paraItem(d: InboxItem) {
  return {
    id: d.id,                       // id da ENTREGA — é o que "marcar como lida" recebe
    type: d.notification.type,
    entity: d.notification.entity,
    entityId: d.notification.entityId,
    title: d.notification.title,
    body: d.notification.body,
    link: d.notification.link,
    readAt: d.readAt,
    createdAt: d.createdAt,
  };
}
```

**Create**: `apps/api/src/modules/notifications/api/dto/list-notifications-query.dto.ts`

```ts
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'Filtro de não lidas inválido.' })
  unreadOnly?: boolean;
}
```

**Create**: `apps/api/src/modules/notifications/api/notifications.controller.ts`

```ts
import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { NotificationsQueryService } from '../application/notifications-query.service';
import { CurrentOwnerId, CurrentUserId } from '../../../shared/current-user.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

/**
 * Central de notificações. **Sem `@RequirePermission`, de propósito**: a caixa é
 * do próprio usuário, como o Perfil e `GET /workspace/members`. Uma chave aqui
 * significaria "papel que pode receber notificação", que não é um conceito do
 * produto. O recorte é `userId` + `ownerId`, sempre os dois.
 *
 * Rotas estáticas antes das paramétricas — convenção do projeto.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsQueryService) {}

  @Get()
  list(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(ownerId, userId, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentOwnerId() ownerId: string, @CurrentUserId() userId: string) {
    return this.notifications.contarNaoLidas(ownerId, userId);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentOwnerId() ownerId: string, @CurrentUserId() userId: string) {
    return this.notifications.marcarTodasLidas(ownerId, userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const ok = await this.notifications.marcarLida(ownerId, userId, id);
    // 404 (não 403): notificação de outra pessoa não deve nem revelar que existe.
    if (!ok) throw new NotFoundException('Notificação não encontrada.');
    return { ok: true };
  }
}
```

**Create**: `apps/api/src/modules/notifications/notifications.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsQueryService } from './application/notifications-query.service';
import { NotificationsDispatcherService } from './application/notifications-dispatcher.service';
import { NotificationsDispatchJob } from './application/notifications-dispatch.job';
import { NotificationsController } from './api/notifications.controller';
import { NOTIFICATION_CHANNELS, type CanalDeNotificacao } from './domain/notification-channel';
import { NOTIFICATION_REPOSITORY } from './domain/notification.repository';
import { NOTIFICATION_TARGET_REPOSITORY } from './domain/notification-target.repository';
import { PrismaNotificationRepository } from './infra/prisma-notification.repository';
import { PrismaNotificationTargetRepository } from './infra/prisma-notification-target.repository';
import { InAppChannel } from './infra/in-app.channel';

/**
 * Global pelo mesmo motivo do `AuditModule`: a **emissão** é transversal e cruza
 * módulos que não têm (nem devem ter) dependência entre si — clients, pipeline,
 * projects, activities, finance, proposals. Exporta **só** o `NotificationsService`:
 * a leitura (controller + repositórios) é assunto interno deste módulo.
 *
 * O array-provider `NOTIFICATION_CHANNELS` é **padrão novo no repo** — não há um
 * único `useFactory` em `apps/` hoje, e os providers não-triviais são todos
 * `useClass`. Foi escolhido conscientemente: o Nest não tem multi-injeção por
 * token (como o Angular), e esta é a forma idiomática de compor a lista sem
 * biblioteca. O ganho é o contrato desta fase — **plugar um canal novo é 1
 * arquivo em `infra/` + 1 linha no `inject` abaixo**, e o `if`/`switch` por canal
 * fica PROIBIDO fora do `Map` do `NotificationsDispatcherService`.
 *
 * Os adapters precisam estar **também** em `providers`: é de lá que o `inject`
 * os resolve.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsQueryService,
    NotificationsDispatcherService,
    NotificationsDispatchJob,
    InAppChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (...canais: CanalDeNotificacao[]) => canais,
      inject: [InAppChannel],
    },
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    { provide: NOTIFICATION_TARGET_REPOSITORY, useClass: PrismaNotificationTargetRepository },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

**Modify**: [apps/api/src/app.module.ts:56](../../apps/api/src/app.module.ts#L56)

Registrar o módulo global logo depois do `AuditModule`, que é o seu par arquitetural.

```ts
    PrismaModule,
    AccessModule,
    AuditModule,
    NotificationsModule,   // ← @Global(), junto do AuditModule pelo mesmo motivo
    AuthModule,
```

#### Provisionamento dos destinos padrão

Sem destino, ninguém recebe nada — e por **D1** isso vale inclusive para o in-app.

**Modify**: [apps/api/src/modules/users/users.service.ts:73-86](../../apps/api/src/modules/users/users.service.ts#L73-L86) e [:115-139](../../apps/api/src/modules/users/users.service.ts#L115-L139)

`UserNotificationTarget` tem RLS e o cadastro não tem contexto de owner — o destino entra no **mesmo
nested create** do `User`, pelo client admin, exatamente como `Subscription`, `Role` e `PipelineStage`
já fazem. Atômico, sem `$transaction` explícito.

```ts
/**
 * Destinos de notificação padrão da conta nova. O in-app é um canal como os
 * outros (D1): sem esta linha o sino nunca receberia nada. `ownerId` = `id` do
 * próprio usuário, porque owner tem `User.ownerId` nulo — ele É a workspace.
 *
 * Tem RLS e o cadastro não tem contexto de owner → entra pelo client admin, no
 * mesmo nested create do `User`, pela mesma razão de `Subscription` e `Role`.
 */
private defaultNotificationTargets(email: string) {
  return [
    { kind: 'IN_APP' as const, label: 'Central de notificações', config: {},
      types: TIPOS_PADRAO, verified: true },
    { kind: 'EMAIL'  as const, label: 'E-mail da conta', config: { email },
      types: TIPOS_PADRAO, verified: true },
  ];
}

async create(data: { name: string; email: string; passwordHash: string }) {
  const user = await this.admin.user.create({
    data: {
      ...data,
      acceptedAt: new Date(),
      subscription: { create: this.trialSubscription() },
      ownedRoles: { create: this.systemRole() },
      pipelineStages: { create: this.defaultStages() },
      // `ownerId` do destino não pode sair daqui (o id ainda não existe) — é
      // preenchido logo abaixo, no único ponto do projeto onde ele é conhecido.
    },
  });
  await this.provisionarDestinos(user.id, user.email);
  this.logStagesProvisioned(user.id);
  return user;
}
```

> **Nota de implementação para o /code**: o `ownerId` do destino é o `id` do
> próprio usuário recém-criado, que não existe antes do `create`. Logo o destino
> **não** cabe no nested create — é um `createMany` logo depois, pelo mesmo
> client admin. Extraia num `private async provisionarDestinos(userId, email)`
> reusado pelos três pontos (`create`, `createWithOAuth`, aceite de convite) e
> emita `{ evento: 'notificacao.destinos_provisionados', ownerId, userId, quantidade }`.
> `TIPOS_PADRAO` = todos os seis tipos, exportado de
> `modules/notifications/domain/notification-target.repository.ts`.

**Modify**: [apps/api/src/modules/collaborators/application/invites.service.ts:94-125](../../apps/api/src/modules/collaborators/application/invites.service.ts#L94-L125)

O colaborador só vira gente de verdade no aceite (`acceptedAt` preenchido). É lá que ele ganha os
destinos, com `ownerId: invite.ownerId` — não o próprio id.

```ts
    // Rota @Public(): sem contexto de owner. Mesmo caminho de sistema da trilha
    // logo abaixo — client admin, ownerId explícito.
    await this.targets.provisionarPadraoPeloSistema({
      ownerId: invite.ownerId,
      userId: invite.userId,
      email: invite.user.email,
      kinds: ['IN_APP', 'EMAIL'],
    });
    await this.audit.registrarPeloSistema({ /* … como está … */ });
```

`InvitesService` injeta `@Inject(NOTIFICATION_TARGET_REPOSITORY)`. Como `NotificationsModule` é
`@Global()`, o token está disponível sem `imports:` — mas ele precisa ser **exportado**. Acrescente
`NOTIFICATION_TARGET_REPOSITORY` ao `exports` do `NotificationsModule`, com o comentário de que é a
única exceção ao "exporta só a escrita", e existe porque o provisionamento nasce fora deste módulo.

#### Gatilho (f) — registro atribuído a você

Os oito pontos são exatamente as oito chamadas de `members.assertMember(ownerId, dto.assigneeId)`.

**Nada é extraído para `shared/`.** As duas regras que apareceriam repetidas — "não notifique quem
agiu" e "o autor sai do CLS" — moram no `NotificationsService` (ver o comentário da classe). O que
sobra em cada service é irredutivelmente local: qual `AuditEntity` ele é, o que ele considera rótulo
humano, e como ele descobre que o responsável **mudou** (que é diferente nos quatro). Nenhum service
injeta `ClsService`; todos injetam só `NotificationsService`, que já vem do módulo `@Global()`.

**Create**: `apps/api/src/shared/assignee-changed.ts`

O único trecho genuinamente idêntico nos quatro `update` — e ele não precisa de DI nenhuma, então é
função pura em `shared/`, ao lado de `record-scope.ts` e `soft-delete.ts`.

```ts
/**
 * O `assigneeId` mudou neste PATCH?
 *
 * `undefined` no DTO significa "não mexi neste campo" — reenviar o MESMO
 * responsável também não é atribuição nova, e sem esta segunda comparação um
 * `PATCH` que só troca o título dispararia notificação. `null` é atribuição
 * removida: mudou, mas não há quem notificar (quem chama já trata).
 *
 * Vale para os quatro modelos com responsável; em `Client` o valor chega por
 * spread do DTO, não por linha própria, mas a comparação é a mesma.
 */
export function assigneeMudou(
  novo: string | null | undefined,
  anterior: string | null,
): novo is string {
  return novo !== undefined && novo !== anterior && novo !== null;
}
```

**Modify**: [apps/api/src/modules/pipeline/application/deals.service.ts:72-118](../../apps/api/src/modules/pipeline/application/deals.service.ts#L72-L118)

```ts
  async create(ownerId: string, dto: CreateDealDto): Promise<DealWithClient> {
    await this.clients.findOne(ownerId, dto.clientId);
    await this.members.assertMember(ownerId, dto.assigneeId);
    // … stage/position como está …
    const criado = await this.repo.create({ /* … como está … */ });
    // Gatilho (f). DEPOIS da escrita e na MESMA transação do request: a
    // notificação commita junto com a atribuição, ou nenhuma das duas commita.
    // Auto-atribuição é descartada dentro do `notificar`.
    if (dto.assigneeId) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED', entity: 'DEAL',
          entityId: criado.id, entityLabel: criado.title,
        },
      });
    }
    return criado;
  }

  async update(ownerId: string, id: string, dto: UpdateDealDto): Promise<DealWithClient> {
    const antes = await this.loadOwned(ownerId, id);   // hoje o retorno é descartado
    await this.members.assertMember(ownerId, dto.assigneeId);
    const atualizado = await this.repo.update(id, { /* … como está … */ });
    if (assigneeMudou(dto.assigneeId, antes.assigneeId)) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED', entity: 'DEAL',
          entityId: id, entityLabel: atualizado.title,
        },
      });
    }
    return atualizado;
  }
```

**Modify**: [apps/api/src/modules/projects/application/tasks.service.ts:74-120](../../apps/api/src/modules/projects/application/tasks.service.ts#L74-L120)

Mesmo desenho, `entity: 'TASK'`, `entityLabel` = `title`. Em `update`, guarde o retorno de
`loadOwned` ([:103](../../apps/api/src/modules/projects/application/tasks.service.ts#L103), hoje descartado) para ter o `antes`.

**Modify**: [apps/api/src/modules/activities/application/activities.service.ts:23-77](../../apps/api/src/modules/activities/application/activities.service.ts#L23-L77)

`entity: 'ACTIVITY'`, e **passe `clientId`** — a timeline mora sob o cliente, e sem ele
`linkDoRegistro` devolve `null`. Atividade não tem título: `entityLabel` são os primeiros 80
caracteres de `content` (`content.slice(0, 80)`), que é o mesmo tipo de rótulo denormalizado que a
trilha já usa. O `antes` vem de `loadOwned` ([:66](../../apps/api/src/modules/activities/application/activities.service.ts#L66), hoje descartado).

**Modify**: [apps/api/src/modules/clients/application/clients.service.ts:33-93](../../apps/api/src/modules/clients/application/clients.service.ts#L33-L93)

`entity: 'CLIENT'`, `entityLabel` = `name`. Caso especial: `assigneeId` chega por **spread do DTO**
([:44](../../apps/api/src/modules/clients/application/clients.service.ts#L44) e [:86](../../apps/api/src/modules/clients/application/clients.service.ts#L86)), não por linha própria — mas `dto.assigneeId`
continua legível, e `assigneeMudou` funciona igual. O `existing` já está carregado em
[:82](../../apps/api/src/modules/clients/application/clients.service.ts#L82); é ele o `antes`, mesmo
caminho que a auditoria usa em [shared/audit-diff.ts](../../apps/api/src/shared/audit-diff.ts).

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — seção `## Notificações` antes de `## Lixeira`, com os quatro
endpoints no formato fixo (**Propósito / Auth / Body / Resposta / Erros / Handler**). Na abertura da
seção, registrar que as rotas **não exigem permissão** e por quê, no molde de
[:884-890](../../apps/api/ENDPOINTS.md#L884-L890).

**Modify**: [docs/observabilidade.md:73-93](../../docs/observabilidade.md#L73-L93) — quatro linhas na
tabela de eventos:

| Evento | Quando | Nível |
| --- | --- | --- |
| `notificacao.sem_contexto` | `notificar` chamado fora de requisição autenticada (bug de instrumentação) | `warn` |
| `notificacao.emissao_falhou` | falha ao gravar a notificação — a operação de negócio continua | `error` |
| `notificacao.entrega_falhou` | falha ao entregar num destino; `definitiva: true` quando esgotou as tentativas | `error` |
| `notificacao.lote_entregue` | rodada do dispatch, a cada minuto (só quando há pendente) | `info` |
| `notificacao.destinos_provisionados` | conta nova ou convite aceito | `info` |

#### Testes

**Create**: `apps/api/src/modules/notifications/notifications.service.spec.ts`
Instanciação direta, no molde de [audit.service.spec.ts:24-38](../../apps/api/src/modules/audit/audit.service.spec.ts#L24-L38)
(`{...} as unknown as X`, `cls as never`), títulos de `it()` em pt-BR. Casos:
- sem `AccessContext` no CLS, não grava e emite `notificacao.sem_contexto`;
- **destinatário igual ao autor não gera nada, e nem consulta os destinos** (é a regra 1, que saiu dos
  quatro services; o `expect(findElegiveis).not.toHaveBeenCalled()` é o que garante que a guarda vem
  antes da ida ao banco);
- **o `title`/`body` gravados carregam o `userName` do CLS** — o gatilho não passa autor (regra 2);
- sem destino elegível, **não** cria linha nenhuma;
- com dois destinos, cria uma `Notification` com **duas** `deliveries` aninhadas;
- **não propaga a exceção do create** (é a divergência em relação ao `AuditService` — o teste é o que
  documenta a decisão) e emite `notificacao.emissao_falhou`;
- `notificarPeloSistema` usa o client admin, grava o `dedupeKey` e produz o corpo **impessoal**
  (`autorNome: null`);
- `notificarPeloSistema` **engole P2002 sem logar erro** (dedupe não é falha).

**Create**: `apps/api/src/shared/assignee-changed.spec.ts`
Unitário puro, uma tabela de casos: `undefined` → false (campo não tocado); mesmo valor → false
(PATCH que só mexeu no título); `null` → false (removeu o responsável, não há quem notificar);
valor novo sobre `null` → true; valor novo sobre outro valor → true.

**Create**: `apps/api/src/modules/notifications/application/notifications-dispatcher.service.spec.ts`
- canal não registrado → `SKIPPED`;
- `isEnabled() === false` → `SKIPPED`, e o `entregar` **não** é chamado;
- destino nulo (apagado depois da emissão) → `SKIPPED`;
- sucesso → `marcarEnviada`;
- falha na 1ª tentativa → `marcarFalha` com `nextAttemptAt` ≈ +1min e `status` seguindo `PENDING`;
- falha na 5ª → `nextAttemptAt: null` (FAILED definitivo);
- **um destino que rejeita não impede o outro de ser entregue** (é o `Promise.allSettled`);
- o `lastError` é truncado em 500.

**Create**: `apps/api/src/modules/notifications/application/notification-content.spec.ts`
Unitário puro: `linkDoRegistro` para os sete casos (incluindo `ACTIVITY` sem `clientId` → `null`),
`montarConteudo` devolvendo texto pt-BR **sem tag HTML** (asserção `not.toMatch(/<[a-z]/i)`), e as
**duas variantes de corpo** — com `autorNome` ("Fulana definiu você…") e com `null` ("Você foi
definido…").

**Modify**: [apps/api/test/rls.e2e-spec.ts:89](../../apps/api/test/rls.e2e-spec.ts#L89) — `toBe(15)` → `toBe(18)`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma validate` — o schema é válido
- [x] `pnpm --filter api exec prisma migrate deploy` + `prisma generate` — a migration aplica e o
      client é regerado. **Nota**: por decisão do usuário nesta sessão, `db:reset` (destrutivo) não é
      mais usado nem em desenvolvimento — o comando real usado foi `migrate deploy`, não-destrutivo,
      que aplicou a migration `20260731100000_notifications` de forma limpa sobre o banco local
- [x] `pnpm --filter api test` — os specs novos (`notifications.service`, `assignee-changed`,
      `notifications-dispatcher.service`, `notification-content`) passam, junto com os 4 specs de
      service existentes atualizados (deals/tasks/activities/clients) — 324 testes, 39 suítes
- [x] `pnpm --filter api test:e2e` — o meta-teste de RLS passa com **18** policies e o
      fail-closed continua verde
- [x] `pnpm --filter api lint` — sem erro novo (2 erros pré-existentes em `main.ts`, não tocado
      nesta fase, permanecem fora de escopo)
- [x] `pnpm --filter api build` — compila

#### Manual Verification
- [ ] Criar uma conta nova e conferir no banco que ela nasceu com dois `UserNotificationTarget`
      (`IN_APP` e `EMAIL`), ambos `verified: true` e com os seis tipos em `types`
- [ ] Com dois usuários da mesma workspace (owner + colaborador), atribuir uma demanda do owner ao
      colaborador; `GET /notifications` **como o colaborador** traz a linha, e como o owner não traz
- [ ] Atribuir um registro **a si mesmo** não gera notificação nenhuma
- [ ] `GET /notifications/unread-count` reflete a contagem; `POST /notifications/:id/read` zera; a
      mesma chamada com o id de outra pessoa responde `404`
- [ ] Em até um minuto, a `NotificationDelivery` do `IN_APP` sai de `PENDING` para `SENT`, e a linha
      `notificacao.lote_entregue` aparece no log — mas a notificação **já aparecia** no `GET` antes disso
- [ ] `psql` como `crm_app` **sem** `set_config('app.owner_id', …)`: `SELECT * FROM "Notification"`
      devolve zero linhas (fail-closed) nas três tabelas novas

**⏸ PAUSE**: Depois da verificação automatizada, parar para a confirmação humana dos testes manuais
antes de seguir para a Fase 2.

---

## Fase 2: Central de notificações na interface

### Goal

Sino com badge no header, popover com a lista, marcar como lida — consumindo o que a Fase 1 já produz.

### Changes

**Create**: `apps/web/src/features/notificacoes/api/types.ts`

```ts
import type { NOTIFICATION_TYPE_LABELS, AUDIT_ENTITY_LABELS } from '@/lib/labels';

/** O map de rótulos é também a fonte do tipo — mesmo padrão da auditoria. */
export type NotificationType = keyof typeof NOTIFICATION_TYPE_LABELS;
export type NotificationEntity = keyof typeof AUDIT_ENTITY_LABELS;

export interface Notificacao {
  /** Id da ENTREGA — é ele que "marcar como lida" recebe. */
  id: string;
  type: NotificationType;
  entity: NotificationEntity;
  entityId: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
```

**Create**: `apps/web/src/features/notificacoes/api/notificacoes.api.ts`

Molde de [audit.api.ts:1-12](../../apps/web/src/features/auditoria/api/audit.api.ts#L1-L12).

```ts
import { api } from '@/lib/api';
// `Paginated` mora em `features/clientes/api/types` e é importado de lá por todas
// as features paginadas, inclusive a auditoria (audit.api.ts:2). Não é bonito —
// o tipo deveria estar em `lib/` — mas é o precedente, e mover o arquivo é uma
// mudança transversal que não pertence a esta fase.
import type { Paginated } from '@/features/clientes/api/types';
import type { Notificacao } from './types';

export const notificacoesApi = {
  list: (params: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<Paginated<Notificacao>>('/notifications', { params }).then((r) => r.data),
  unreadCount: () =>
    api.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  read: (id: string) => api.post(`/notifications/${id}/read`).then((r) => r.data),
  readAll: () => api.post('/notifications/read-all').then((r) => r.data),
};
```

**Create**: `apps/web/src/features/notificacoes/api/hooks.ts`

```ts
/** Sem SSE nem WebSocket (D3): a contagem se atualiza por polling. */
const INTERVALO_MS = 45_000;

export function useNaoLidas() {
  return useQuery({
    queryKey: queryKeys.notificacoes.unreadCount,
    queryFn: () => notificacoesApi.unreadCount(),
    // SÓ AQUI. O QueryClient é criado sem `defaultOptions` (main.tsx:13) e assim
    // deve continuar — pôr refetchInterval global faria a aplicação inteira
    // repolar. Este é o único hook com custo de polling do projeto.
    refetchInterval: INTERVALO_MS,
  });
}

export function useNotificacoes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.notificacoes.list({ limit: 10 }),
    queryFn: () => notificacoesApi.list({ limit: 10 }),
    // Só busca a lista quando o popover abre — precedente do PerfilDialog:124.
    enabled: options?.enabled ?? true,
  });
}

function invalidateNotificacoes(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.notificacoes.all });
}

export function useMarcarLida() { /* mutation → invalidateNotificacoes */ }
export function useMarcarTodasLidas() { /* idem */ }
```

**Create**: `apps/web/src/features/notificacoes/SinoDeNotificacoes.tsx`

`Popover` (já existe em `components/ui/popover.tsx`) + `Button variant="ghost" size="icon"` com o
ícone `Bell` do lucide + um `Badge` absoluto quando `count > 0` (mostrando `9+` acima de 9). Lista
com `Skeleton` no carregamento e `Empty` no vazio ([empty.tsx:97-104](../../apps/web/src/components/ui/empty.tsx#L97-L104)).
Item: título em `font-medium`, corpo em `text-muted-foreground`, data relativa, e um ponto teal
(`bg-primary`) quando não lida. Clicar no item marca como lida e navega para `link` (quando houver).
Rolagem por `max-h-96 overflow-y-auto` — **não** existe `scroll-area.tsx` no projeto, e o padrão é
esse ([dialog.tsx:98](../../apps/web/src/components/ui/dialog.tsx#L98)). Toast e extração de erro
ficam no componente, com `extractApiMessage` ([api-error.ts:7](../../apps/web/src/lib/api-error.ts#L7)).

**Modify**: [apps/web/src/app/AppLayout.tsx:120-121](../../apps/web/src/app/AppLayout.tsx#L120-L121)

```tsx
          <div className="ml-auto flex items-center gap-1">
            <SinoDeNotificacoes />
            <Tooltip>
```

O `PopoverTrigger` recebe o botão por **`render=`**, não `asChild` — é a API do base-ui, como em
[:141-156](../../apps/web/src/app/AppLayout.tsx#L141-L156).

**Modify**: [apps/web/src/lib/query-keys.ts](../../apps/web/src/lib/query-keys.ts)

```ts
  notificacoes: {
    all: ['notificacoes'] as const,
    list: (params: object) => ['notificacoes', 'list', params] as const,
    unreadCount: ['notificacoes', 'unread-count'] as const,
  },
```

**Modify**: [apps/web/src/lib/labels.ts:153](../../apps/web/src/lib/labels.ts#L153)

Acrescentar `ACTIVITY: 'Atividade'` a `AUDIT_ENTITY_LABELS` (o enum ganhou o valor na Fase 1 — a
regra do [apps/web/CLAUDE.md](../../apps/web/CLAUDE.md) exige a tradução no mesmo PR), e o bloco novo:

```ts
// --- notificações (Fase 9) ---

export const NOTIFICATION_TYPE_LABELS = {
  FOLLOW_UP_DUE: 'Follow-up de hoje',
  PROPOSAL_EXPIRING: 'Proposta a expirar',
  PAYMENT_DUE: 'Cobrança a vencer',
  PAYMENT_OVERDUE: 'Cobrança vencida',
  TASK_OVERDUE: 'Demanda atrasada',
  RECORD_ASSIGNED: 'Atribuído a você',
} as const;
export const translateNotificationType = make(NOTIFICATION_TYPE_LABELS);
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — `tsc -b` + build de produção, sem erro
- [x] `pnpm --filter web lint` — oxlint sem erro (só os avisos pré-existentes de
      `only-export-components` em arquivos não tocados)

#### Manual Verification
- [ ] Com uma notificação não lida, o badge aparece no sino; com dez ou mais, mostra `9+`
- [ ] Abrir o popover carrega a lista; fechado, a query da lista **não** roda (só a da contagem)
- [ ] Clicar num item marca como lida (o ponto some, o badge decrementa) e navega para o registro
- [ ] "Marcar todas como lidas" zera o badge
- [ ] Sem notificação nenhuma, aparece o estado vazio, não uma lista em branco
- [ ] Uma notificação criada em outra aba aparece no badge em até ~45s sem recarregar a página
- [ ] Tema claro e escuro: nenhuma cor hard-coded, o ponto de não lida usa `bg-primary`

**⏸ PAUSE**: Parar para a confirmação humana antes de seguir para a Fase 3.

---

## Fase 3: Gatilhos de prazo (crons)

### Goal

Os cinco gatilhos restantes emitindo, com destinatário derivado (**D2**), janelas fixas e dedupe.

### Changes

#### Índices que faltam

**Modify**: `apps/api/prisma/schema.prisma` — três `@@index` novos. Uma varredura cross-owner por
`scheduledFor` / `validUntil` / `dueDate` faz seq scan hoje: só `Payment` tem `@@index([dueDate, status])`.

```prisma
model Activity {
  // …
  @@index([clientId, createdAt])
  @@index([ownerId])
  @@index([ownerId, assigneeId])
  @@index([scheduledFor, completedAt])   // ← gatilho (a), varredura cross-owner
}

model Task {
  // …
  @@index([dueDate, status])             // ← gatilho (e), cross-owner
}

model Proposal {
  // …
  @@index([validUntil, status])          // ← gatilho (b), cross-owner
}
```

**Create**: `apps/api/prisma/migrations/20260801100000_notification_trigger_indexes/migration.sql`

```sql
-- Índices dos gatilhos de prazo da Fase 9. As três varreduras são CROSS-OWNER
-- (client admin, sem app.owner_id), então o índice NÃO começa por ownerId — é a
-- mesma exceção justificada de Payment.@@index([dueDate,status]), que já existe.
--
-- Sem eles, o cron diário faz seq scan em Activity, Task e Proposal.
--  * Roda como crm_user (superuser), que bypassa RLS.

CREATE INDEX "Activity_scheduledFor_completedAt_idx" ON "Activity"("scheduledFor", "completedAt");
CREATE INDEX "Task_dueDate_status_idx"               ON "Task"("dueDate", "status");
CREATE INDEX "Proposal_validUntil_status_idx"        ON "Proposal"("validUntil", "status");
```

#### Read model dos gatilhos

**Create**: `apps/api/src/modules/notifications/domain/notification-triggers.repository.ts`

```ts
export const NOTIFICATION_TRIGGERS_REPOSITORY = Symbol('NOTIFICATION_TRIGGERS_REPOSITORY');

/**
 * Uma linha a notificar, com o destinatário JÁ DERIVADO (D2). A derivação vive no
 * repositório porque ela é um join — `Proposal → Deal|Client → assigneeId`,
 * `Payment → Contract → Client → assigneeId` — e resolvê-la no service
 * significaria N+1 consultas num cron cross-owner.
 */
export interface AlvoDeLembrete {
  ownerId: string;
  /** Destinatário derivado; nunca nulo (o fallback final é o owner). */
  userId: string;
  entityId: string;
  /** Rótulo humano do registro ("PROP-2026-0042", "Mensalidade 08/2026"). */
  label: string;
  clienteNome: string;
  /** A data que motivou o lembrete — compõe o `dedupeKey`. */
  dataAlvo: Date;
  /** Só em PAYMENT_DUE. */
  valor?: number;
}

export interface NotificationTriggersRepository {
  /** (a) FOLLOW_UP: `type=FOLLOW_UP`, não concluído, `scheduledFor` HOJE. */
  followUpsDoDia(de: Date, ate: Date): Promise<AlvoDeLembrete[]>;
  /** (b) `status IN (SENT, NEGOTIATING)`, `validUntil` em (agora, agora+Nd]. */
  propostasAExpirar(de: Date, ate: Date): Promise<AlvoDeLembrete[]>;
  /** (c) `status=PENDING`, `dueDate` em (agora, agora+Nd]. */
  cobrancasAVencer(de: Date, ate: Date): Promise<AlvoDeLembrete[]>;
  /** (e) `status != DONE`, `dueDate < agora`, **`archivedAt IS NULL`**. */
  demandasAtrasadas(agora: Date): Promise<AlvoDeLembrete[]>;
}
```

**Create**: `apps/api/src/modules/notifications/infra/prisma-notification-triggers.repository.ts`

Todas as quatro consultas por `this.admin` (cron cross-owner). Notas obrigatórias:

- **Escalar, não join, para a workspace.** As queries do dashboard resolvem o owner por join
  (`client: { ownerId }`); aqui use o **escalar `ownerId`** de cada modelo, que é o que os dois crons
  já fazem — é a única forma que aproveita os índices novos.
- **(e) precisa de `archivedAt: null`** (o `ATIVO` de [shared/soft-delete.ts:11](../../apps/api/src/shared/soft-delete.ts#L11)),
  senão notifica demanda que está na lixeira. `Task` tem soft delete; `Activity` **não** tem.
- **Derivação (D2)**, com fallback final no owner (`ownerId` **é** o `User.id` do owner, porque owner
  tem `User.ownerId` nulo):

```ts
// (a) FOLLOW_UP — Activity tem assigneeId próprio.
select: { id, ownerId, content, assigneeId, scheduledFor, client: { select: { name: true } } }
userId: a.assigneeId ?? a.ownerId

// (b) Proposal — não tem assigneeId. Deal primeiro, Client depois, owner por último.
include: { deal: { select: { assigneeId } }, client: { select: { name, assigneeId } } }
userId: p.deal?.assigneeId ?? p.client.assigneeId ?? p.ownerId

// (c) Payment — não tem assigneeId; a cadeia é contract → client.
include: { contract: { select: { client: { select: { name, assigneeId } } } } }
userId: p.contract.client.assigneeId ?? p.ownerId

// (e) Task — tem assigneeId próprio.
select: { id, ownerId, title, dueDate, assigneeId, project: { select: { client: { select: { name } } } } }
userId: t.assigneeId ?? t.ownerId
```

#### Conteúdo dos cinco tipos

**Modify**: `apps/api/src/modules/notifications/application/notification-content.ts`

Estender a união `EventoDeNotificacao` com os cinco membros restantes e o `switch` de `montarConteudo`.
Texto pt-BR, valores monetários com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`
e datas com `toLocaleDateString('pt-BR')`. Exemplos do corpo:

- `FOLLOW_UP_DUE` — título `Follow-up agendado para hoje`, corpo
  `Follow-up com <cliente>: <trecho do conteúdo>.`
- `PROPOSAL_EXPIRING` — `A proposta <número> para <cliente> expira em <data>.`
- `PAYMENT_DUE` — `<descrição> de <cliente>, <valor>, vence em <data>.`
- `PAYMENT_OVERDUE` — `<descrição> de <cliente>, <valor>, venceu em <data>.`
- `TASK_OVERDUE` — `A demanda <título> (<cliente>) passou do prazo em <data>.`

#### O job dos lembretes

**Create**: `apps/api/src/modules/notifications/application/notifications-reminders.job.ts`

```ts
/**
 * Antecedência dos gatilhos de prazo. Constantes de código nesta fase — janelas
 * configuráveis por owner ficam para depois (acrescentariam um quarto modelo e
 * uma tela a uma fase que já é larga).
 */
const DIAS_PROPOSTA = 3;
const DIAS_COBRANCA = 3;

/**
 * Gatilhos (a), (b), (c) e (e). Roda às 6h BRT, uma hora antes do digest, para
 * que o resumo do dia já inclua o que este job emitiu.
 *
 * `name:` e `timeZone:` explícitos: os dois crons legados não declaram nenhum dos
 * dois (`EVERY_DAY_AT_3AM` = 3h UTC = meia-noite BRT) e essa dívida fica onde
 * está — mas nada novo nasce com ela.
 */
@Cron('0 6 * * *', { name: 'notificacoes-lembretes', timeZone: 'America/Sao_Paulo' })
async run(): Promise<void> {
  const agora = new Date();
  const emitidas =
    (await this.emitir('FOLLOW_UP_DUE',     await this.repo.followUpsDoDia(inicioDoDia(agora), fimDoDia(agora)))) +
    (await this.emitir('PROPOSAL_EXPIRING', await this.repo.propostasAExpirar(agora, maisDias(agora, DIAS_PROPOSTA)))) +
    (await this.emitir('PAYMENT_DUE',       await this.repo.cobrancasAVencer(agora, maisDias(agora, DIAS_COBRANCA)))) +
    (await this.emitir('TASK_OVERDUE',      await this.repo.demandasAtrasadas(agora)));

  if (emitidas > 0) {
    this.logger.log({
      evento: 'notificacoes.lembretes_emitidos',
      msg: 'Lembretes de prazo emitidos pela rotina diária.',
      quantidade: emitidas,
    });
  }
}

/**
 * Pré-filtra pelo `dedupeKey` e emite o que sobrou. Sem isso, um cron diário
 * notificaria a MESMA cobrança todo dia até ela vencer — a chave carrega a
 * data-alvo, então cada item avisa uma vez só. O unique do banco
 * (`Notification_userId_dedupeKey_key`) é o backstop da corrida, não o mecanismo:
 * uma insert que falha dentro de um lote é mais cara que um SELECT antes dele.
 *
 * `try/catch` POR ITEM é obrigatório: nenhum dos dois jobs existentes tem
 * try/catch, e uma falha no meio do `for` mataria o resto do lote.
 */
private async emitir(tipo: NotificationType, alvos: AlvoDeLembrete[]): Promise<number> { … }
```

`dedupeKey` = `` `${tipo}:${alvo.entityId}:${alvo.dataAlvo.toISOString().slice(0, 10)}` ``.

**Modify**: `apps/api/src/modules/notifications/notifications.module.ts` — registrar
`NotificationsRemindersJob` e o par `{ provide: NOTIFICATION_TRIGGERS_REPOSITORY, useClass: … }`.

#### Os dois crons existentes passam a notificar

**Modify**: [apps/api/src/modules/finance/domain/payment.repository.ts:58-63](../../apps/api/src/modules/finance/domain/payment.repository.ts#L58-L63)

O `select` atual não carrega valor, prazo nem cliente — a notificação precisa dos três.

```ts
/** Cobrança marcada como vencida pela rotina — a trilha e a notificação juntas. */
export interface PaymentVencido {
  id: string;
  ownerId: string;
  description: string;
  dueDate: Date;
  amount: number;
  clienteNome: string;
  /** Derivado por `contract → client` (D2). Null → o gatilho cai no owner. */
  assigneeId: string | null;
}
```

**Modify**: [prisma-payment.repository.ts:221-236](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L221-L236) —
o `select` do `markOverdue` ganha `dueDate`, `amount` e
`contract: { select: { client: { select: { name: true, assigneeId: true } } } }`. O padrão
select-then-updateMany e a nota de corrida ficam como estão.

**Modify**: [apps/api/src/modules/finance/application/finance-billing.job.ts:31-46](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L31-L46)

```ts
    for (const p of vencidas) {
      await this.audit.registrarPeloSistema({ /* … como está … */ });
      // Gatilho (d). `notificarPeloSistema` já engole a própria exceção, então
      // não precisa de try/catch aqui — mas a trilha ACIMA também não tem, e é
      // ela que abortaria o lote se falhasse. Não mexa nessa ordem.
      await this.notifications.notificarPeloSistema({
        ownerId: p.ownerId,
        userId: p.assigneeId ?? p.ownerId,
        dedupeKey: `PAYMENT_OVERDUE:${p.id}`,
        evento: {
          tipo: 'PAYMENT_OVERDUE',
          entityId: p.id,
          descricao: p.description,
          clienteNome: p.clienteNome,
          valor: p.amount,
          dataAlvo: p.dueDate,
        },
      });
    }
```

> **Idempotência, declarada**: o `updateMany` commita `PENDING → OVERDUE` **antes** do loop. Se o
> processo cair no meio, a reexecução não reencontra nada (o filtro `status: 'PENDING'` já não casa) e
> as notificações que faltaram **se perdem**. É o mesmo comportamento que a trilha de auditoria já tem
> desde a Fase 8B, e mudá-lo exigiria emitir dentro da mesma operação que muda o status. O `dedupeKey`
> aqui protege o caso oposto — um reprocessamento manual não duplica.

**Modify**: [apps/api/src/modules/proposals/domain/proposal.repository.ts:22-28](../../apps/api/src/modules/proposals/domain/proposal.repository.ts#L22-L28) e
[prisma-proposal.repository.ts:134-153](../../apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts#L134-L153) —
`PropostaExpirada` ganha `clienteNome` e `assigneeId` (derivado por `deal ?? client`, D2).

**Modify**: [apps/api/src/modules/proposals/application/proposals-expiration.job.ts:23-36](../../apps/api/src/modules/proposals/application/proposals-expiration.job.ts#L23-L36) —
o mesmo desenho, com `tipo: 'PROPOSAL_EXPIRING'` e `dedupeKey: \`PROPOSAL_EXPIRED:${p.id}\``.

> **Nota de escopo**: o job de expiração notifica a proposta **já expirada**; o
> `NotificationsRemindersJob` notifica a que **vai** expirar em 3 dias. São dois momentos do mesmo
> gatilho (b), e o `dedupeKey` diferente (`PROPOSAL_EXPIRING:` vs `PROPOSAL_EXPIRED:`) garante que a
> pessoa receba os dois avisos, não um só.

#### Documentação

**Modify**: [docs/observabilidade.md:73-93](../../docs/observabilidade.md#L73-L93) — acrescentar
`notificacoes.lembretes_emitidos` (`info`, rotina diária das 6h BRT).

#### Testes

**Create**: `apps/api/src/modules/notifications/application/notifications-reminders.job.spec.ts`
Molde de [finance-billing.job.spec.ts](../../apps/api/src/modules/finance/application/finance-billing.job.spec.ts):
mock exaustivo do repositório e **janela recalculada em vez de fake timers**. Casos:
- os quatro gatilhos são consultados e emitem;
- alvo cujo `dedupeKey` já existe **não** é emitido de novo;
- uma emissão que lança **não** interrompe o restante do lote (é o `try/catch` por item);
- lote vazio **não** emite o log agregado (guard `> 0`);
- o `dedupeKey` composto carrega a data-alvo em ISO curto.

**Modify**: os specs existentes de `finance-billing.job` e `proposals-expiration.job` — o mock de
`NotificationsService` entra no construtor, e um caso novo assere que `notificarPeloSistema` é chamado
uma vez por linha, com o `userId` derivado (e caindo no `ownerId` quando não há responsável).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma validate`
- [x] `pnpm --filter api exec prisma migrate deploy` — as duas migrations aplicam em sequência
      (**não** `db:reset`: por decisão do usuário, banco não é mais resetado)
- [x] `scripts/validar-migrations-com-dados.sh` — portão novo do repo: as duas migrations aplicam
      sobre banco **populado**, e a invariante nova confere RLS + policy nas três tabelas
- [x] `pnpm --filter api test` — o spec novo e os dois modificados passam
- [x] `pnpm --filter api test:e2e`
- [x] `pnpm --filter api lint && pnpm --filter api build`

#### Manual Verification
- [ ] Semear uma cobrança com `dueDate` daqui a 2 dias, disparar o job à mão e conferir que o
      responsável do cliente (não o owner) recebeu `PAYMENT_DUE`
- [ ] Rodar o mesmo job **duas vezes seguidas**: a segunda não cria notificação nova (dedupe)
- [ ] Cobrança de um cliente **sem responsável**: a notificação vai para o owner
- [ ] Uma demanda arquivada (`archivedAt` preenchido) e atrasada **não** gera `TASK_OVERDUE`
- [ ] `EXPLAIN ANALYZE` das quatro consultas do cron usa os índices novos (nenhum `Seq Scan` nas três
      tabelas), com o banco de desenvolvimento populado pelo seed
- [ ] O log da rodada traz `notificacoes.lembretes_emitidos` com a quantidade — e **nenhum** título ou
      nome de cliente

**⏸ PAUSE**: Parar para a confirmação humana antes de seguir para a Fase 4.

---

## Fase 4: Canal de e-mail, destinos e digest diário

### Goal

O segundo canal real, com o `MailService` finalmente capaz de dizer se o envio deu certo, e o digest
diário. É aqui que a API de destinos e preferências nasce.

### Changes

#### `MailService` — o bloqueio (3)

**Modify**: [apps/api/src/mail/mail.service.ts:51-149](../../apps/api/src/mail/mail.service.ts#L51-L149)

Hoje os dois métodos são **copy-paste idêntico** ([:75-92](../../apps/api/src/mail/mail.service.ts#L75-L92) ≡ [:130-147](../../apps/api/src/mail/mail.service.ts#L130-L147)) de um `try/catch` que engole a
falha e devolve `Promise<void>`. Um `EmailChannel` que delegasse a eles **não conseguiria** distinguir
enviado de falhou, e o `NotificationDelivery.status` viraria ficção.

```ts
/** O que aconteceu com um envio. `disabled` não é falha — é SMTP ausente. */
export type ResultadoDeEnvio = { status: 'sent' } | { status: 'disabled' };

/**
 * Envio genérico. Ao contrário de `sendPasswordReset`/`sendCollaboratorInvite`,
 * **propaga** a exceção do SMTP: quem chama decide se engole (os dois fluxos de
 * link, que têm fallback pela interface) ou se registra a falha e reagenda (o
 * `EmailChannel`, cujo retry depende de saber que falhou).
 *
 * Devolver `disabled` em vez de lançar mantém o contrato de "serviço opcional":
 * sem `SMTP_HOST`, nada é enviado e ninguém quebra.
 */
private async send(to: string, conteudo: EmailContent): Promise<ResultadoDeEnvio> {
  if (!this.isEnabled()) return { status: 'disabled' };
  await this.getTransporter().sendMail({
    from: this.from, to, subject: conteudo.subject, text: conteudo.text, html: conteudo.html,
  });
  return { status: 'sent' };
}

/** Envio de notificação. Propaga a falha — é o que alimenta o retry do outbox. */
async sendNotification(to: string, conteudo: EmailContent): Promise<ResultadoDeEnvio> {
  return this.send(to, conteudo);
}

async sendDigest(to: string, conteudo: EmailContent): Promise<ResultadoDeEnvio> {
  return this.send(to, conteudo);
}
```

`sendPasswordReset` e `sendCollaboratorInvite` passam a delegar ao `send()`, mantendo **exatamente**
o comportamento externo de hoje: o `warn` `email.smtp_desabilitado` com o link só fora de produção, e
o `try/catch` que engole com `email.envio_falhou`. **Não mude o contrato deles nesta fase** — os dois
têm fallback pela interface ([invites.service.ts:50-51](../../apps/api/src/modules/collaborators/application/invites.service.ts#L50-L51))
e mexer neles é risco sem ganho.

**Create**: `apps/api/src/mail/mail.service.spec.ts`

[apps/api/CLAUDE.md:100-111](../../apps/api/CLAUDE.md#L100-L111) exige spec que **instancie de
verdade** o adapter de infraestrutura — e este arquivo não existe hoje. É dívida a fechar agora, que
o e-mail passa a ser caminho de produto. Mocke `nodemailer.createTransport` (a fronteira externa), não
o `MailService`. Casos:
- sem `SMTP_HOST`, `send` devolve `{ status: 'disabled' }` e **não** cria transporter;
- com SMTP, `sendMail` recebe `from`/`to`/`subject`/`text`/`html`;
- o transporter é criado **uma vez** em dois envios (é lazy e memoizado);
- `sendNotification` **propaga** a exceção do SMTP;
- `sendPasswordReset` **não** propaga e emite `email.envio_falhou`;
- `sendPasswordReset` sem SMTP emite `email.smtp_desabilitado` e, com `NODE_ENV=production`, **não**
  inclui a `resetUrl` no log.

#### Canal de e-mail

**Create**: `apps/api/src/mail/templates/notification.template.ts` (+ `.spec.ts`)

Contrato `EmailContent`, montado com os helpers de [layout.ts](../../apps/api/src/mail/templates/layout.ts):
`paragraph`, `button` (para o `link`), `divider`. **`paragraph()` recebe HTML cru** — todo dado de
negócio interpolado passa por `escapeHtml`, como faz
[collaborator-invite.template.ts:41](../../apps/api/src/mail/templates/collaborator-invite.template.ts#L41).
O spec inclui um caso de injeção (título com `<script>` sai escapado), no molde de
[password-reset.template.spec.ts](../../apps/api/src/mail/templates/password-reset.template.spec.ts).

**Create**: `apps/api/src/modules/notifications/infra/email.channel.ts`

```ts
/**
 * Canal de e-mail. `isEnabled()` delega ao `MailService`, que já implementa o
 * contrato de "serviço opcional": sem `SMTP_HOST`, o canal é desligado e o
 * dispatch marca a entrega como SKIPPED — não como falha, e sem retry.
 */
@Injectable()
export class EmailChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'EMAIL';
  constructor(private readonly mail: MailService, private readonly config: ConfigService) {}

  isEnabled(): boolean { return this.mail.isEnabled(); }

  async entregar(destino: DestinoDeNotificacao, conteudo: ConteudoDeNotificacao): Promise<void> {
    const { email } = destino.config as { email?: string };
    if (!email) throw new Error('Destino de e-mail sem endereço configurado.');
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const r = await this.mail.sendNotification(email, notificationEmail({ conteudo, appUrl }));
    // `disabled` só chega aqui numa corrida (isEnabled passou e a config sumiu).
    if (r.status !== 'sent') throw new Error('SMTP indisponível no momento do envio.');
  }
}
```

**Modify**: `apps/api/src/modules/notifications/notifications.module.ts` — `imports: [MailModule]`.
`MailModule` **não** é `@Global()` ([mail.module.ts](../../apps/api/src/mail/mail.module.ts), 5
linhas), então precisa ser importado explicitamente. Acrescentar `EmailChannel` a `providers` e ao
`inject` do array-provider.

#### Digest diário

**Modify**: [apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts:27-38](../../apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts#L27-L38)

O `select` devolve só `{ id, name, isOwner }` — o digest precisa do e-mail. **Não** acrescente `email`
ao `WorkspaceMember`: ele alimenta o seletor de responsável, e vazar e-mail de colega numa rota sem
permissão é mudança de superfície. Acrescente um método novo:

```ts
/** Membros com e-mail, para envio em lote. NÃO é o que `GET /workspace/members`
 *  devolve — aquela rota é pública para qualquer sessão e não deve vazar e-mail. */
findManyByOwnerWithEmail(ownerId: string): Promise<(WorkspaceMember & { email: string })[]>;
```

**Create**: `apps/api/src/mail/templates/digest.template.ts` (+ `.spec.ts`) — resumo agrupado por
tipo, com contagem e até 5 itens por grupo, `escapeHtml` em tudo que é dado de negócio, e um `button`
para a central.

**Create**: `apps/api/src/modules/notifications/application/notifications-digest.job.ts`

```ts
/**
 * Digest diário. 7h no fuso de São Paulo, não 7h UTC: os crons legados usam
 * `EVERY_DAY_AT_3AM` sem `timeZone`, o que em UTC dá meia-noite BRT — um "resumo
 * do dia" à meia-noite estaria errado na prática. Não há `TZ` no compose nem no
 * Dockerfile, então o container é UTC e o `timeZone:` é obrigatório.
 */
@Cron('0 7 * * *', { name: 'notificacoes-digest', timeZone: 'America/Sao_Paulo' })
```

Para cada usuário com destino `EMAIL` ativo, junta as notificações das últimas 24h e envia **uma**
mensagem. `try/catch` por usuário. Log agregado `{ evento: 'digest.enviado', quantidade, falhas }`;
falha individual em `digest.envio_falhou` com `usuarioId`, **sem** o e-mail e **sem** os títulos.

#### API de destinos e preferências

**Create**: `apps/api/src/modules/notifications/application/notification-targets.service.ts` e os DTOs.

Rotas novas em `NotificationsController` (todas sem `@RequirePermission`, como o inbox):

| Rota | Propósito |
|---|---|
| `GET /notifications/targets` | Destinos do usuário logado |
| `POST /notifications/targets` | Cria um destino |
| `PATCH /notifications/targets/:id` | Renomeia, liga/desliga, muda os `types` |
| `DELETE /notifications/targets/:id` | Remove |

**A `config` nunca volta crua.** O serializador devolve um resumo por kind — `IN_APP` → `null`,
`EMAIL` → o endereço, `WEBHOOK`/`SLACK` → só o **host** da URL (`hooks.slack.com`), nunca o caminho,
que é a credencial. É a regra de [apps/api/CLAUDE.md:51](../../apps/api/CLAUDE.md#L51) aplicada a um
campo `Json` que carrega segredo.

Nesta fase o `POST` aceita apenas `kind: 'EMAIL'` (`IN_APP` já vem provisionado e não é criável);
`WEBHOOK`/`SLACK` chegam na Fase 6, atrás de permissão. O `DELETE` recusa o último destino `IN_APP`
com `422 Não é possível remover a central de notificações. Desative-a, se preferir não receber.` —
apagá-lo deixaria o sino permanentemente vazio sem explicação.

**Modify**: `apps/api/ENDPOINTS.md` — os quatro endpoints na seção `## Notificações`, deixando
explícito na Resposta que a `config` volta resumida.

**Modify**: [docs/observabilidade.md:73-93](../../docs/observabilidade.md#L73-L93) — `digest.enviado`
(`info`) e `digest.envio_falhou` (`error`).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — inclusive o `mail.service.spec.ts` novo
- [x] `pnpm --filter api test:e2e`
- [x] `pnpm --filter api lint && pnpm --filter api build`

#### Manual Verification
- [ ] Com Mailpit (ou SMTP de teste) configurado, atribuir um registro a alguém e receber **dois**
      resultados: a linha no sino e o e-mail na caixa
- [ ] **Sem** `SMTP_HOST`: a entrega `EMAIL` vira `SKIPPED` (não `FAILED`), não é retentada, e o
      `IN_APP` continua funcionando normalmente
- [ ] Derrubar o SMTP no meio: a entrega vira `PENDING` com `attempts: 1` e `nextAttemptAt` ≈ +1min,
      e é reentregue quando o SMTP volta
- [ ] Disparar o digest à mão: chega **um** e-mail com o resumo agrupado, e quem não tem destino
      `EMAIL` ativo não recebe nada
- [ ] `GET /notifications/targets` **não** devolve a `config` crua de nenhum destino
- [ ] Um título de notificação com `<script>alert(1)</script>` chega escapado no HTML do e-mail
- [ ] Nenhuma linha de log contém e-mail de destinatário, título ou nome de cliente

**⏸ PAUSE**: Parar para a confirmação humana antes de seguir para a Fase 5.

---

## Fase 5: Preferências e destinos na interface

### Goal

A matriz tipo × destino e a gestão dos destinos, dentro do Perfil.

### Changes

**Create**: `apps/web/src/features/notificacoes/PreferenciasDeNotificacao.tsx`

Uma seção no `PerfilDialog`, no molde de
[SessoesAtivas.tsx:13-148](../../apps/web/src/features/perfil/SessoesAtivas.tsx#L13-L148) — que já é
a tela de configuração por usuário do projeto. Um cartão por destino (rótulo, kind traduzido, resumo
da config, toggle de ativo) e, dentro dele, a lista dos seis tipos com um controle por linha.

**Toggle**: use `Checkbox` ([components/ui/checkbox.tsx](../../apps/web/src/components/ui/checkbox.tsx)).
**Não existe `switch.tsx`** no projeto e criar o primitivo é trabalho de design system, não desta
fase — [apps/web/CLAUDE.md:52](../../apps/web/CLAUDE.md#L52) manda usar o equivalente existente antes
de replicar o nativo, e checkbox é semanticamente correto para uma matriz de opt-in.

**Modify**: [apps/web/src/features/perfil/PerfilDialog.tsx:124](../../apps/web/src/features/perfil/PerfilDialog.tsx#L124)

```tsx
          <SessoesAtivas enabled={open} />
          <PreferenciasDeNotificacao enabled={open} />
```

`enabled={open}` pelo mesmo motivo do `SessoesAtivas`: a query só roda quando o diálogo abre.

**Modify**: `apps/web/src/features/notificacoes/api/` — `types.ts`, `notificacoes.api.ts` e `hooks.ts`
ganham os destinos (`useDestinos`, `useCriarDestino`, `useAtualizarDestino`, `useExcluirDestino`),
com `invalidateQueries` no `onSuccess` e toast no componente.

**Modify**: [apps/web/src/lib/labels.ts](../../apps/web/src/lib/labels.ts)

```ts
export const NOTIFICATION_CHANNEL_KIND_LABELS = {
  IN_APP: 'Central de notificações',
  EMAIL: 'E-mail',
  WEBHOOK: 'Webhook',
  SLACK: 'Slack',
} as const;
export const translateNotificationChannelKind = make(NOTIFICATION_CHANNEL_KIND_LABELS);
```

**Modify**: [apps/web/src/lib/query-keys.ts](../../apps/web/src/lib/query-keys.ts) —
`notificacoes.targets: ['notificacoes', 'targets'] as const`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build`
- [x] `pnpm --filter web lint`

#### Manual Verification
- [ ] Abrir o Perfil mostra os dois destinos provisionados, com os seis tipos marcados
- [ ] Desmarcar `PAYMENT_DUE` no destino `EMAIL` e salvar: uma cobrança a vencer chega só no sino
- [ ] Desativar o destino `IN_APP`: notificação nova não aparece mais no sino, e as antigas continuam
      na lista (o histórico não some)
- [ ] Tentar excluir o destino `IN_APP` responde a mensagem em pt-BR do `422`, não um erro genérico
- [ ] Cadastrar um segundo destino `EMAIL` (outro endereço) e receber nos dois
- [ ] O resumo da config aparece mascarado, nunca a URL ou o token completo
- [ ] Todo texto em pt-BR; nenhum identificador de enum cru na tela

**⏸ PAUSE**: Parar para a confirmação humana antes de seguir para a Fase 6.

---

## Fase 6: Canais `WEBHOOK` e `SLACK`

### Goal

Os dois adapters externos, atrás de permissão e das travas de **D4**. É a única superfície de
exfiltração da fase, isolada de propósito — sai sem afetar o resto se você quiser adiar.

### Changes

#### Permissão

**Modify**: [apps/api/src/shared/permissions.ts:167](../../apps/api/src/shared/permissions.ts#L167)

Uma chave nova, na categoria `'Organização'`, no molde de `auditoria:ver`
([:147-153](../../apps/api/src/shared/permissions.ts#L147-L153)). `IN_APP` e `EMAIL` continuam sem
chave, como o Perfil.

```ts
  {
    key: 'notificacao:integrar',
    label: 'Integrar notificações',
    description:
      'Enviar as próprias notificações para um webhook ou canal do Slack. O conteúdo carrega nome de cliente e valor de cobrança',
    category: 'Organização',
  },
```

O 403 sai derivado do `label` pelo [access.guard.ts:71-76](../../apps/api/src/modules/access/access.guard.ts#L71-L76):
*"Você não tem permissão para integrar notificações."*

#### Travas de segurança

**Create**: `apps/api/src/modules/notifications/application/webhook-url.ts`

```ts
/**
 * Validação da URL de destino. É a trava que importa nesta feature, e o motivo é
 * o contrário do intuitivo: o risco NÃO é alguém forjar um corpo falso para o
 * receptor — é um colaborador apontar o webhook para um servidor dele e sifonar
 * nome de cliente e valor de cobrança. Contra isso agem permissão + HTTPS +
 * bloqueio de IP privado + `verified`; assinatura HMAC não faria nada (por isso
 * ela fica para a Fase 19, junto da máquina de segredo com rotação).
 *
 *  - HTTPS obrigatório;
 *  - resolve o host e recusa loopback, link-local, privado e reservado (SSRF);
 *  - recusa porta fora de 443.
 */
export async function validarUrlDeWebhook(url: string): Promise<void>;
```

Mensagens em pt-BR (`UnprocessableEntityException`): *"O endereço precisa usar HTTPS."*, *"Este
endereço aponta para a rede interna e não pode ser usado."*

O destino nasce `verified: false` e `active: false`; `POST /notifications/targets/:id/verify` envia um
ping e só então marca `verified: true`. **Nenhuma entrega sai para destino não verificado** — o
`findElegiveis` já filtra por `verified: true` desde a Fase 1.

#### Os dois adapters

**Create**: `apps/api/src/modules/notifications/infra/webhook.channel.ts`

`POST` do conteúdo neutro cru (`{ tipo, titulo, corpo, link, dados }`), com timeout de 10s
(`AbortSignal.timeout`) e os cabeçalhos:

```
Content-Type: application/json
X-CRM-Delivery: <deliveryId>
X-CRM-Timestamp: <epoch>
User-Agent: CRM-ProgrameAi/1.0
```

O `X-CRM-Delivery` é o que deixa o receptor **deduplicar** — necessário, porque o outbox tem retry.
Sem assinatura e sem segredo nesta fase (**D4**). Rejeita fora da faixa 2xx, com o status no erro.

**Create**: `apps/api/src/modules/notifications/infra/slack.channel.ts`

Mesmo transporte, corpo `{ text: "*<titulo>*\n<corpo>\n<link|Abrir no CRM>" }` no formato *mrkdwn*
do Slack, com escape dos três caracteres que o Slack trata (`&`, `<`, `>`).

**Modify**: `apps/api/src/modules/notifications/notifications.module.ts` — os dois em `providers` e
no `inject`. **É a prova do contrato**: dois canais novos, dois arquivos, duas linhas.

#### API e interface

**Modify**: `NotificationsController` — `POST /notifications/targets` passa a aceitar
`kind: 'WEBHOOK' | 'SLACK'`, com `@RequirePermission('notificacao:integrar')` **no método**, não na
classe (as demais rotas continuam livres). Rota nova `POST /notifications/targets/:id/verify`, com a
mesma chave.

**Modify**: `apps/web/src/features/notificacoes/PreferenciasDeNotificacao.tsx` — o formulário de
destino webhook aparece só com `can('notificacao:integrar')` ([use-can.ts:13-32](../../apps/web/src/hooks/use-can.ts#L13-L32)),
com um aviso em pt-BR de que **a URL é o segredo** e de que o conteúdo carrega dado de cliente.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — a rota de verificação, o payload de cada `kind`, e um parágrafo
declarando que **a URL é a credencial**: quem a tiver escreve no canal.

**Modify**: [ROADMAP.md:461-462](../../ROADMAP.md#L461-L462) — nota na Fase 19 separando o
`WebhookChannel` desta fase (destino **do usuário**) do webhook de saída **do owner** (evento de
negócio para sistema externo). Sem isso a Fase 19 vira retrabalho.

**Modify**: [ROADMAP.md:276-290](../../ROADMAP.md#L276-L290) — marcar a Fase 9 como entregue, linkar
este plano e **corrigir a nota de complexidade**: são três modelos, não dois. A divergência é
consciente e é o preço de "N destinos por usuário"; o documento não deve mentir sobre o tamanho da fase.

**Modify**: `docs/observabilidade.md` — registrar a dívida de retenção: `Notification` e
`NotificationDelivery` crescem sem limite e não há política de expurgo (a auditoria também não tem).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — o spec de `validarUrlDeWebhook` cobre HTTPS ausente, `localhost`,
      `127.0.0.1`, `10.0.0.1`, `169.254.169.254` (metadata de cloud) e `[::1]`, mais porta fora de
      443, host que resolve para IP interno (rebinding) e host que não resolve
- [x] `pnpm --filter api test:e2e`
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter web build && pnpm --filter web lint`

#### Manual Verification
- [ ] Colaborador **sem** `notificacao:integrar` recebe `403` em pt-BR ao criar destino webhook, e o
      formulário nem aparece na interface
- [ ] `http://` é recusado; `https://127.0.0.1/x` é recusado; `https://169.254.169.254/…` é recusado
- [ ] Um webhook do Slack real recebe a mensagem formatada, com o título em negrito e o link clicável
- [ ] Destino criado e **não verificado** não recebe entrega nenhuma
- [ ] Duas entregas da mesma notificação (forçando um retry) chegam com o **mesmo** `X-CRM-Delivery`
- [ ] `GET /notifications/targets` devolve só o host do webhook, nunca o caminho
- [ ] Nenhuma URL de webhook aparece em log nenhum, em nenhum nível

**⏸ PAUSE**: Confirmação humana final. Depois, o commit `docs()` de fechamento da fase e a marcação
deste plano como `implemented`, no padrão de entrega das fases anteriores (`a8526fa`, `ab04344`,
`d33c00f`).

---

## Testing Strategy

### Unit Tests

Instanciação direta, sem `Test.createTestingModule` — ele aparece em **um** arquivo do projeto
([test/helpers/app.ts](../../apps/api/test/helpers/app.ts), bootstrap e2e). Títulos de `it()` em pt-BR
descrevendo a regra, no molde de [audit.service.spec.ts](../../apps/api/src/modules/audit/audit.service.spec.ts).

- **`NotificationsService`** — as duas superfícies, a ausência de contexto, as duas regras genéricas
  (auto-notificação descartada, autor vindo do CLS) e sobretudo **que a exceção não sobe**. Esse
  último teste é o que documenta a divergência em relação ao `AuditService`; sem ele, alguém
  "corrige" a classe para ficar igual à auditoria e passa a derrubar operação de negócio.
- **`NotificationsDispatcherService`** — o registry, os três caminhos de `SKIPPED`, o backoff, o
  esgotamento, e que **um destino que falha não impede os outros**.
- **`notification-content.ts`** — unitário puro. Além do texto, uma asserção de que **não há tag HTML**
  no corpo: é a costura que separa o core do adapter, e ela quebra em silêncio.
- **`NotificationsRemindersJob`** — janela recalculada em vez de fake timers (o precedente é
  [finance-billing.job.spec.ts](../../apps/api/src/modules/finance/application/finance-billing.job.spec.ts)),
  dedupe, e o `try/catch` por item.
- **`MailService`** — mockando `nodemailer`, não o próprio service. [CLAUDE.md:100-111](../../apps/api/CLAUDE.md#L100-L111):
  para o adapter em si, mockar o adapter é testar o mock.
- **Templates** — unitários puros, cada um com um caso de injeção.

Mockar o Prisma nos specs de regra é o certo. Os repositórios Prisma **não** ganham spec unitário —
eles são cobertos pelo e2e de isolamento.

### Integration Tests

- **[rls.e2e-spec.ts](../../apps/api/test/rls.e2e-spec.ts)** — a âncora de policies vai a **18** e o
  meta-teste "toda tabela com `ownerId` tem RLS ligado, forçado e com policy" passa a cobrir as três
  tabelas novas automaticamente. Acrescentar um caso ao bloco *"owner não alcança dado de outro
  owner"*: `GET /notifications` de um owner nunca traz notificação de outro.
- **Colaborador** — um caso no bloco existente: o colaborador enxerga a **própria** caixa, não a do
  owner. É o único lugar do sistema onde "os dados do owner" não é a resposta certa, e vale um teste
  explícito.
- Nenhuma rota nova é `@Public()`, então nada entra no `auth.e2e-spec.ts`. **Se** a Fase 4 ganhar um
  descadastro do digest por token, aí sim entra, no mesmo PR ([CLAUDE.md:106-111](../../apps/api/CLAUDE.md#L106-L111)).

### Migration & Rollback

- Duas migrations, aplicadas por `prisma migrate deploy` no entrypoint do container (que já aborta o
  start quando falha — `app.migracao_falhou`).
- **Sem backfill**: as tabelas começam vazias no dia do deploy, como a trilha de auditoria.
- **`ALTER TYPE "AuditEntity" ADD VALUE 'ACTIVITY'` não tem rollback** em Postgres — valor de enum não
  se remove. É aditivo e inofensivo (nada usa `ACTIVITY` na trilha antes desta fase), mas é o único
  passo irreversível do plano e vale saber disso antes de aplicar.
- **Rollback das tabelas**: `DROP TABLE "NotificationDelivery", "Notification", "UserNotificationTarget";`
  mais os três `DROP TYPE`. Nenhuma tabela existente perde coluna, então derrubar as três não afeta
  dado de negócio nenhum.
- **Rollback de código**: os três jobs novos param de rodar assim que o container volta à imagem
  anterior. As linhas `PENDING` que ficarem no outbox são inertes.
- **Ordem entre as fases**: a Fase 1 precisa estar em produção antes da 2 (o front chama rotas que só
  existem depois dela). As fases 3–6 são independentes entre si.

## Environment Considerations

- **CI/CD**: nenhum passo novo. O deploy já roda `prisma migrate deploy` e já confere que a API
  responde antes de concluir (`5b96e13`).
- **Migrations**: duas, `20260731100000_notifications` e `20260801100000_notification_trigger_indexes`.
  Os timestamps são escritos à mão, um dia por migration, `HHMMSS=100000` — a convenção desde
  `20260724040000`.
- **Config/Secrets**: **nenhuma variável nova**. O digest e o `EmailChannel` usam o bloco SMTP que já
  existe e já é opcional ([env.validation.ts:42-49](../../apps/api/src/config/env.validation.ts#L42-L49)),
  e o `FRONTEND_URL` já é obrigatório ([:14](../../apps/api/src/config/env.validation.ts#L14)).
- **Multi-environment**: em desenvolvimento, sem `SMTP_HOST`, o canal `EMAIL` fica desligado e as
  entregas viram `SKIPPED` — o in-app continua funcionando sozinho, que é o ponto do `isEnabled()`.
  Em produção o digest depende do SMTP e **não tem** o escape de UX que o convite tem (o painel
  devolvendo o link): sem SMTP, ele simplesmente não existe.
- **Fuso**: não há `TZ` no compose nem no Dockerfile, logo o container roda em UTC. Os dois jobs desta
  fase que têm hora do dia declaram `timeZone: 'America/Sao_Paulo'` explicitamente.
- **Cron**: cinco rotinas passam a conviver. As três novas têm `name:` e horários escalonados
  (dispatch a cada minuto, lembretes 6h BRT, digest 7h BRT); as duas legadas ficam sem `name:` em
  3h UTC, como estão.

## Dependencies & Risks

- **Nenhuma dependência nova.** `@nestjs/schedule ^6.1.3`, `nodemailer ^9.0.3`, `nestjs-cls ^6.2.1` e
  `@prisma/client ^6.19.3` já estão instalados; o array-provider é API padrão do Nest.
- **O array-provider é padrão novo no repo** — zero `useFactory` em `apps/` hoje. Risco baixo (é API
  documentada do framework), mitigado pelo comentário de bloco no módulo. O risco real é de **erosão**:
  alguém acrescentar um `if (kind === 'SLACK')` fora do registry e desfazer o contrato. O comentário
  proíbe explicitamente, e o teste do dispatcher cobre o caminho genérico.
- **Volume de e-mail.** Não há fila, retry de provedor, rate limit nem `pool: true` no transporter, e
  o throttle que existe é HTTP ([auth.controller.ts:100](../../apps/api/src/modules/auth/auth.controller.ts#L100)) —
  um cron não passa por guard nenhum. O único freio é o limite do provedor SMTP. Com poucos owners
  isso é irrelevante; a partir de algumas centenas de usuários, o digest das 7h vira um pico. O `LOTE`
  de 200 por rodada do dispatch é o teto que existe hoje — monitorar `notificacao.lote_entregue`.
- **Crescimento sem expurgo.** `Notification` e `NotificationDelivery` crescem para sempre. Dívida
  registrada na Fase 6, no mesmo lugar onde a auditoria já registrou a dela.
- **Perda de notificação no gatilho (d).** Documentada acima: o `updateMany` commita antes do loop.
  Herdado do desenho da Fase 8B, aceito conscientemente.
- **Timeout da transação do request.** A emissão acrescenta um SELECT e um create aninhado à transação
  de negócio, que usa o timeout default do Prisma (5s, não configurado em lugar nenhum do projeto).
  Duas operações indexadas não chegam perto disso — mas é a razão pela qual **nenhum I/O de rede** pode
  entrar no `notificar()`, nem agora nem depois.
- **`prisma.db` no request é `TransactionClient`**: não tem `$transaction`, `$connect` nem `$on`. Se
  algum caminho novo precisar de transação própria, ele **não** pode rodar no request.
- **A Fase 16 vai consumir esta porta.** `NotificationsService.notificar` precisa continuar aceitando
  emissão programática arbitrária, não só os seis gatilhos fixos — a união `EventoDeNotificacao` é o
  ponto de extensão, e fechá-la em torno dos seis tipos seria um erro que só aparece daqui a duas fases.

## References

- PRD: [specs/research/2026-07-27-fase-9-notificacoes-e-lembretes.md](../research/2026-07-27-fase-9-notificacoes-e-lembretes.md)
- Escopo e ordem: [ROADMAP.md:269-290](../../ROADMAP.md#L269-L290)
- Escopo herdado (o `assigneeId` que o gatilho (f) usa): [specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md:82](./2026-07-26-fase-7b-responsavel-por-registro.md#L82)
- Molde arquitetural: [specs/plans/2026-07-26-fase-8b-auditoria.md](./2026-07-26-fase-8b-auditoria.md)
- Convenção de log e o catálogo de eventos: [docs/observabilidade.md:68-175](../../docs/observabilidade.md#L68-L175)
- Regras obrigatórias: [apps/api/CLAUDE.md](../../apps/api/CLAUDE.md) · [apps/web/CLAUDE.md](../../apps/web/CLAUDE.md)
- Padrões (livro): *Transactional Outbox* e *Channel Adapter*, em Hohpe & Woolf, **Enterprise
  Integration Patterns**. Nenhum código externo foi copiado.
</content>
</invoke>
