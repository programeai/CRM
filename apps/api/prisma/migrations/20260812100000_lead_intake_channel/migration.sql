CREATE TABLE "LeadIntakeChannel" (
  "id"         TEXT NOT NULL,
  "ownerId"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "assigneeId" TEXT,
  "sourceId"   TEXT,
  "keyId"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadIntakeChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadIntakeChannel_ownerId_name_key" ON "LeadIntakeChannel"("ownerId", "name");
CREATE UNIQUE INDEX "LeadIntakeChannel_keyId_key" ON "LeadIntakeChannel"("keyId");
CREATE INDEX "LeadIntakeChannel_ownerId_idx" ON "LeadIntakeChannel"("ownerId");
CREATE INDEX "LeadIntakeChannel_sourceId_idx" ON "LeadIntakeChannel"("sourceId");

ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- RESTRICT: excluir uma fonte de lead em uso não apaga a configuração do canal.
ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "LeadSourceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_keyId_fkey"
  FOREIGN KEY ("keyId") REFERENCES "IntegrationKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS por ownerId (molde de 20260805100000_lead_source_catalog)
ALTER TABLE "LeadIntakeChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadIntakeChannel" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "LeadIntakeChannel"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadIntakeChannel" TO crm_app;
