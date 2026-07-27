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
