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
