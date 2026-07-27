-- Tipos de serviço deixam de ser enum fechado e passam a ser catálogo por owner.
-- Terceira das quatro migrations da Fase 13-A, e a única com FK NOT NULL.
--
-- Não existe caminho "nulável primeiro" para a coluna final: `ADD COLUMN NOT
-- NULL` sem default falha com dado dentro. A ordem obrigatória é a da 7A:
-- coluna nulável → backfill → guard → SET NOT NULL. E o guard aqui não é
-- opcional: um único NULL sobrevivente faria o SET NOT NULL abortar no meio da
-- migration, com a coluna antiga já derrubada em Deal mas não em Proposal.
--
-- Por isso o SET NOT NULL das TRÊS tabelas vem antes de qualquer DROP COLUMN.
--
-- ⚠️ 'Tráfego pago' é também um nome do catálogo de fontes de lead
-- (PAID_TRAFFIC existia nos DOIS enums). São tabelas diferentes: não há
-- colisão, mas busca-e-substitui cega no literal ou no rótulo corrompe o outro
-- catálogo.

-- ===========================================================================
-- 0. Guard de integridade nas três tabelas
-- ===========================================================================
-- Deal/Proposal/Project.ownerId são colunas sem FK: nada garante que apontam
-- para um owner real, e a semeadura parte de `User WHERE "ownerId" IS NULL`.
DO $$
DECLARE d INT; p INT; j INT;
BEGIN
  SELECT count(*) INTO d FROM "Deal" x
   WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = x."ownerId" AND u."ownerId" IS NULL);
  SELECT count(*) INTO p FROM "Proposal" x
   WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = x."ownerId" AND u."ownerId" IS NULL);
  SELECT count(*) INTO j FROM "Project" x
   WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = x."ownerId" AND u."ownerId" IS NULL);
  IF d + p + j > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % deal(s), % proposta(s) e % projeto(s) com "ownerId" que não corresponde a um owner em "User". Corrija os dados antes de aplicar.',
      d, p, j;
  END IF;
END $$;

-- ===========================================================================
-- 1. Tabela do catálogo
-- ===========================================================================
CREATE TABLE "ServiceCatalog" (
  "id"      TEXT    NOT NULL,
  "ownerId" TEXT    NOT NULL,
  "name"    TEXT    NOT NULL,
  "active"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ServiceCatalog_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- 2. Semeia o catálogo padrão por owner
-- ===========================================================================
-- Fonte a manter em sincronia: apps/api/src/shared/default-catalogs.ts.
INSERT INTO "ServiceCatalog" ("id", "ownerId", "name")
SELECT gen_random_uuid()::text, u."id", v.name
  FROM "User" u
 CROSS JOIN (VALUES
   ('Software'),
   ('Website'),
   ('Tráfego pago')
 ) AS v(name)
 WHERE u."ownerId" IS NULL;

-- ===========================================================================
-- 3. Três colunas FK NULÁVEIS
-- ===========================================================================
ALTER TABLE "Deal"     ADD COLUMN "serviceTypeId" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "serviceTypeId" TEXT;
ALTER TABLE "Project"  ADD COLUMN "serviceTypeId" TEXT;

-- ===========================================================================
-- 4. Backfill das três, com o mesmo mapa enum→nome
-- ===========================================================================
-- `cat."ownerId" = <tabela>."ownerId"` é o que impede o vazamento entre
-- workspaces que o casamento por nome poderia causar.
UPDATE "Deal" d
   SET "serviceTypeId" = cat."id"
  FROM (VALUES
    ('SOFTWARE',     'Software'),
    ('WEBSITE',      'Website'),
    ('PAID_TRAFFIC', 'Tráfego pago')
  ) AS m(enum_value, name)
  JOIN "ServiceCatalog" cat ON cat."name" = m.name
 WHERE d."serviceType"::text = m.enum_value
   AND cat."ownerId"         = d."ownerId";

UPDATE "Proposal" p
   SET "serviceTypeId" = cat."id"
  FROM (VALUES
    ('SOFTWARE',     'Software'),
    ('WEBSITE',      'Website'),
    ('PAID_TRAFFIC', 'Tráfego pago')
  ) AS m(enum_value, name)
  JOIN "ServiceCatalog" cat ON cat."name" = m.name
 WHERE p."serviceType"::text = m.enum_value
   AND cat."ownerId"         = p."ownerId";

UPDATE "Project" j
   SET "serviceTypeId" = cat."id"
  FROM (VALUES
    ('SOFTWARE',     'Software'),
    ('WEBSITE',      'Website'),
    ('PAID_TRAFFIC', 'Tráfego pago')
  ) AS m(enum_value, name)
  JOIN "ServiceCatalog" cat ON cat."name" = m.name
 WHERE j."serviceType"::text = m.enum_value
   AND cat."ownerId"         = j."ownerId";

-- ===========================================================================
-- 5. Guard: nenhuma das três pode ter sobrado NULL
-- ===========================================================================
-- A coluna antiga é NOT NULL, então TODA linha tinha valor — qualquer NULL aqui
-- é backfill incompleto.
DO $$
DECLARE d INT; p INT; j INT;
BEGIN
  SELECT count(*) INTO d FROM "Deal"     WHERE "serviceTypeId" IS NULL;
  SELECT count(*) INTO p FROM "Proposal" WHERE "serviceTypeId" IS NULL;
  SELECT count(*) INTO j FROM "Project"  WHERE "serviceTypeId" IS NULL;
  IF d + p + j > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % deal(s), % proposta(s) e % projeto(s) não encontraram tipo de serviço no catálogo do próprio owner.',
      d, p, j;
  END IF;
END $$;

-- ===========================================================================
-- 6. SET NOT NULL nas três, ANTES de qualquer DROP COLUMN
-- ===========================================================================
ALTER TABLE "Deal"     ALTER COLUMN "serviceTypeId" SET NOT NULL;
ALTER TABLE "Proposal" ALTER COLUMN "serviceTypeId" SET NOT NULL;
ALTER TABLE "Project"  ALTER COLUMN "serviceTypeId" SET NOT NULL;

-- ===========================================================================
-- 7. Só então derrubar as colunas antigas e o tipo
-- ===========================================================================
ALTER TABLE "Deal"     DROP COLUMN "serviceType";
ALTER TABLE "Proposal" DROP COLUMN "serviceType";
ALTER TABLE "Project"  DROP COLUMN "serviceType";
DROP TYPE "ServiceType";

-- ===========================================================================
-- 8. Índices e FKs
-- ===========================================================================
CREATE UNIQUE INDEX "ServiceCatalog_ownerId_name_key" ON "ServiceCatalog"("ownerId", "name");
CREATE INDEX "ServiceCatalog_ownerId_idx" ON "ServiceCatalog"("ownerId");
ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "ServiceCatalog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Deal_serviceTypeId_idx"     ON "Deal"("serviceTypeId");
CREATE INDEX "Proposal_serviceTypeId_idx" ON "Proposal"("serviceTypeId");
CREATE INDEX "Project_serviceTypeId_idx"  ON "Project"("serviceTypeId");

-- RESTRICT: excluir um tipo em uso responde 409 no service, não apaga dado.
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_serviceTypeId_fkey"
  FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_serviceTypeId_fkey"
  FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_serviceTypeId_fkey"
  FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- 9. RLS por ownerId (molde de 20260724050000_enable_rls)
-- ===========================================================================
ALTER TABLE "ServiceCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceCatalog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "ServiceCatalog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "ServiceCatalog" TO crm_app;
