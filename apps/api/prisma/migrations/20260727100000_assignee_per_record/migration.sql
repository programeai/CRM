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
