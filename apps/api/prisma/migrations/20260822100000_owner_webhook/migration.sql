-- ===========================================================================
-- 1. Enum de status da entrega. Próprio, e não `NotificationDeliveryStatus`:
--    reusar acoplaria duas features que o roadmap manda não confundir, e
--    `SKIPPED` (canal desligado por configuração) não existe aqui.
-- ===========================================================================
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- ===========================================================================
-- 2. Webhooks do owner
-- ===========================================================================
CREATE TABLE "OwnerWebhook" (
  "id"         TEXT NOT NULL,
  "ownerId"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "secret"     TEXT NOT NULL,
  "events"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "active"     BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerWebhook_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerWebhook_ownerId_name_key" ON "OwnerWebhook"("ownerId", "name");
CREATE INDEX "OwnerWebhook_ownerId_idx" ON "OwnerWebhook"("ownerId");
ALTER TABLE "OwnerWebhook" ADD CONSTRAINT "OwnerWebhook_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 3. Outbox
-- ===========================================================================
CREATE TABLE "OwnerWebhookDelivery" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "webhookId"     TEXT NOT NULL,
  "event"         TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "status"        "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError"     TEXT,
  "sentAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerWebhookDelivery_pkey" PRIMARY KEY ("id")
);
-- Mesmo índice do outbox de notificações: é o que a varredura filtra.
CREATE INDEX "OwnerWebhookDelivery_status_nextAttemptAt_idx"
  ON "OwnerWebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "OwnerWebhookDelivery_ownerId_createdAt_idx"
  ON "OwnerWebhookDelivery"("ownerId", "createdAt");
ALTER TABLE "OwnerWebhookDelivery" ADD CONSTRAINT "OwnerWebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "OwnerWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerWebhookDelivery" ADD CONSTRAINT "OwnerWebhookDelivery_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 4. RLS por ownerId nas DUAS tabelas (molde de 20260811100000_integration_key)
-- ===========================================================================
ALTER TABLE "OwnerWebhook" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnerWebhook" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "OwnerWebhook"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "OwnerWebhook" TO crm_app;

ALTER TABLE "OwnerWebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnerWebhookDelivery" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "OwnerWebhookDelivery"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "OwnerWebhookDelivery" TO crm_app;

-- ===========================================================================
-- 5. Auditoria: cadastro, rotação e exclusão de webhook entram na trilha
-- ===========================================================================
ALTER TYPE "AuditEntity" ADD VALUE 'WEBHOOK';
