-- Índices dos gatilhos de prazo da Fase 9. As três varreduras são CROSS-OWNER
-- (client admin, sem app.owner_id), então o índice NÃO começa por ownerId — é a
-- mesma exceção justificada de Payment.@@index([dueDate,status]), que já existe.
--
-- Sem eles, o cron diário faz seq scan em Activity, Task e Proposal.
--  * Roda como crm_user (superuser), que bypassa RLS.

CREATE INDEX "Activity_scheduledFor_completedAt_idx" ON "Activity"("scheduledFor", "completedAt");
CREATE INDEX "Task_dueDate_status_idx"               ON "Task"("dueDate", "status");
CREATE INDEX "Proposal_validUntil_status_idx"        ON "Proposal"("validUntil", "status");
