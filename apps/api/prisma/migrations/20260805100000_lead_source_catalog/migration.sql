-- Fontes de lead deixam de ser um enum fechado e passam a ser catálogo por
-- owner, com RLS. Primeira das quatro migrations da Fase 13-A.
--
-- Notas de projeto (idênticas às de 20260726120000_pipeline_stages_per_owner):
--  * ownerId é TEXT → comparação texto=texto, SEM cast ::uuid.
--  * ids são TEXT (@default(uuid())) → gen_random_uuid()::text.
--  * `WHERE u."ownerId" IS NULL` é o predicado canônico de "é owner".
--  * Roda como crm_user (superuser), que bypassa RLS — sem set_config aqui.
--
-- Por que a coluna antiga só cai no passo 5: o backfill do passo 4 lê
-- `Client."source"`. E `DROP TYPE "LeadSource"` só depois do DROP COLUMN,
-- porque a coluna ainda depende do tipo.

-- ===========================================================================
-- 0. Guard de integridade
-- ===========================================================================
-- Client.ownerId é coluna sem FK: nada no banco garante que aponta para um
-- owner real. A semeadura abaixo parte de `User WHERE "ownerId" IS NULL`, então
-- um Client com ownerId fora desse conjunto ficaria sem catálogo para onde
-- apontar e perderia silenciosamente a origem no backfill.
DO $$
DECLARE orfaos INT;
BEGIN
  SELECT count(*) INTO orfaos
    FROM "Client" c
   WHERE NOT EXISTS (
     SELECT 1 FROM "User" u WHERE u."id" = c."ownerId" AND u."ownerId" IS NULL
   );
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % cliente(s) com "ownerId" que não corresponde a um owner em "User". Corrija os dados antes de aplicar.',
      orfaos;
  END IF;
END $$;

-- ===========================================================================
-- 1. Tabela do catálogo
-- ===========================================================================
CREATE TABLE "LeadSourceCatalog" (
  "id"      TEXT    NOT NULL,
  "ownerId" TEXT    NOT NULL,
  "name"    TEXT    NOT NULL,
  "active"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "LeadSourceCatalog_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- 2. Semeia o catálogo padrão por owner
-- ===========================================================================
-- Os nomes são os rótulos pt-BR que hoje vivem em apps/web/src/lib/labels.ts —
-- é o mesmo conteúdo, saindo de compile-time para dado. Fonte a manter em
-- sincronia: apps/api/src/shared/default-catalogs.ts.
INSERT INTO "LeadSourceCatalog" ("id", "ownerId", "name")
SELECT gen_random_uuid()::text, u."id", v.name
  FROM "User" u
 CROSS JOIN (VALUES
   ('Indicação'),
   ('Tráfego pago'),
   ('Orgânico'),
   ('Prospecção ativa'),
   ('Outro')
 ) AS v(name)
 WHERE u."ownerId" IS NULL;

-- ===========================================================================
-- 3. Coluna FK nulável
-- ===========================================================================
ALTER TABLE "Client" ADD COLUMN "sourceId" TEXT;

-- ===========================================================================
-- 4. Backfill: literal do enum → linha do catálogo DO PRÓPRIO OWNER
-- ===========================================================================
-- `cat."ownerId" = c."ownerId"` é o que impede o vazamento entre workspaces que
-- o casamento por nome poderia causar (a invariante conferida em
-- prisma/fixtures/invariantes.sql).
UPDATE "Client" c
   SET "sourceId" = cat."id"
  FROM (VALUES
    ('REFERRAL',     'Indicação'),
    ('PAID_TRAFFIC', 'Tráfego pago'),
    ('ORGANIC',      'Orgânico'),
    ('OUTBOUND',     'Prospecção ativa'),
    ('OTHER',        'Outro')
  ) AS m(enum_value, name)
  JOIN "LeadSourceCatalog" cat ON cat."name" = m.name
 WHERE c."source"::text  = m.enum_value
   AND cat."ownerId"     = c."ownerId";

-- ===========================================================================
-- 5. Guard pós-backfill, e só então derrubar a coluna e o tipo
-- ===========================================================================
-- Cliente que TINHA origem e ficou sem FK é backfill silenciosamente incompleto:
-- a coluna é nulável, então nada no banco reclamaria depois do DROP.
DO $$
DECLARE perdidos INT;
BEGIN
  SELECT count(*) INTO perdidos
    FROM "Client"
   WHERE "source" IS NOT NULL AND "sourceId" IS NULL;
  IF perdidos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % cliente(s) com origem preenchida não encontraram linha no catálogo do próprio owner.',
      perdidos;
  END IF;
END $$;

ALTER TABLE "Client" DROP COLUMN "source";
DROP TYPE "LeadSource";

-- ===========================================================================
-- 6. Índices e FKs
-- ===========================================================================
CREATE UNIQUE INDEX "LeadSourceCatalog_ownerId_name_key" ON "LeadSourceCatalog"("ownerId", "name");
CREATE INDEX "LeadSourceCatalog_ownerId_idx" ON "LeadSourceCatalog"("ownerId");
ALTER TABLE "LeadSourceCatalog" ADD CONSTRAINT "LeadSourceCatalog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Client_sourceId_idx" ON "Client"("sourceId");
-- RESTRICT: excluir uma fonte em uso responde 409 no service, não apaga dado.
ALTER TABLE "Client" ADD CONSTRAINT "Client_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "LeadSourceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- 7. RLS por ownerId (molde de 20260724050000_enable_rls)
-- ===========================================================================
ALTER TABLE "LeadSourceCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadSourceCatalog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "LeadSourceCatalog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadSourceCatalog" TO crm_app;
