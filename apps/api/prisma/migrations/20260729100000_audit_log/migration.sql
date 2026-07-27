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
