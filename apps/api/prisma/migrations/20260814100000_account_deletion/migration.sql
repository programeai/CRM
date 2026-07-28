-- Fase 19-A: encerramento de conta agendado, com carência.
--
-- Colunas nulas e aditivas: nenhum backfill. O índice serve à varredura do
-- `AccountPurgeJob` (um `WHERE "deletionScheduledFor" <= now()` diário sobre
-- `User`), que sem ele seria seq scan.
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt"  TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletionScheduledFor" TIMESTAMP(3);

CREATE INDEX "User_deletionScheduledFor_idx" ON "User"("deletionScheduledFor");
