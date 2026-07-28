-- ===========================================================================
-- 1. Tabela
-- ===========================================================================
CREATE TABLE "IntegrationKey" (
  "id"         TEXT NOT NULL,
  "ownerId"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "keyHash"    TEXT NOT NULL,
  "prefix"     TEXT NOT NULL,
  "scopes"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationKey_keyHash_key" ON "IntegrationKey"("keyHash");
CREATE INDEX "IntegrationKey_ownerId_idx" ON "IntegrationKey"("ownerId");
ALTER TABLE "IntegrationKey" ADD CONSTRAINT "IntegrationKey_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 2. Enums da auditoria — a emissão e a rotação de chave entram na trilha
-- ===========================================================================
ALTER TYPE "AuditEntity" ADD VALUE 'INTEGRATION';
ALTER TYPE "AuditAction" ADD VALUE 'ROTACIONAR';

-- ===========================================================================
-- 3. RLS por ownerId (molde de 20260805100000_lead_source_catalog)
-- ===========================================================================
ALTER TABLE "IntegrationKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationKey" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "IntegrationKey"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "IntegrationKey" TO crm_app;
