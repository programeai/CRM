-- Motivos de perda deixam de ser texto livre e passam a ser catálogo por owner.
-- Segunda das quatro migrations da Fase 13-A.
--
-- Diferente das outras três, aqui NÃO há enum de origem: cada owner tem strings
-- próprias, digitadas à mão. A estratégia:
--   * semeia o catálogo padrão ATIVO (passo 2);
--   * importa cada string distinta já gravada como item DESATIVADO (passo 2b);
--   * religa os deals por nome, casefolded (passo 4).
-- Assim o histórico fica 100% preservado e legível, e o Select do produto mostra
-- só a lista padrão — o owner reativa o que quiser. Um motivo digitado que
-- coincida com um nome padrão (ex.: "preço") cai no item padrão ativo, e é isso
-- que se quer.

-- ===========================================================================
-- 0. Guard de integridade: Deal.ownerId tem de apontar para um owner real.
-- ===========================================================================
DO $$
DECLARE orfaos INT;
BEGIN
  SELECT count(*) INTO orfaos
    FROM "Deal" d
   WHERE NOT EXISTS (
     SELECT 1 FROM "User" u WHERE u."id" = d."ownerId" AND u."ownerId" IS NULL
   );
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % oportunidade(s) com "ownerId" que não corresponde a um owner em "User".',
      orfaos;
  END IF;
END $$;

-- ===========================================================================
-- 1. Tabela
-- ===========================================================================
CREATE TABLE "LostReasonCatalog" (
  "id"      TEXT    NOT NULL,
  "ownerId" TEXT    NOT NULL,
  "name"    TEXT    NOT NULL,
  "active"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "LostReasonCatalog_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- 2. Catálogo padrão, ATIVO, por owner (fonte: shared/default-catalogs.ts)
-- ===========================================================================
INSERT INTO "LostReasonCatalog" ("id", "ownerId", "name")
SELECT gen_random_uuid()::text, u."id", v.name
  FROM "User" u
 CROSS JOIN (VALUES
   ('Preço'), ('Prazo'), ('Sem resposta'), ('Escolheu concorrente'),
   ('Sem verba'), ('Fora do perfil'), ('Outro')
 ) AS v(name)
 WHERE u."ownerId" IS NULL;

-- ===========================================================================
-- 2b. Importa o histórico como itens DESATIVADOS
-- ===========================================================================
-- O GROUP BY lower(btrim(...)) dedupe por owner ignorando caixa e espaço nas
-- pontas; min() escolhe uma grafia determinística entre as variantes. O NOT
-- EXISTS evita duplicar um motivo que já é um dos padrões (aí o deal cai no
-- item ativo, no passo 4).
INSERT INTO "LostReasonCatalog" ("id", "ownerId", "name", "active")
SELECT gen_random_uuid()::text, t."ownerId", t.name, false
  FROM (
    SELECT d."ownerId", min(btrim(d."lostReason")) AS name
      FROM "Deal" d
     WHERE d."lostReason" IS NOT NULL AND btrim(d."lostReason") <> ''
     GROUP BY d."ownerId", lower(btrim(d."lostReason"))
  ) t
 WHERE NOT EXISTS (
   SELECT 1 FROM "LostReasonCatalog" c
    WHERE c."ownerId" = t."ownerId" AND lower(c."name") = lower(t.name)
 );

-- ===========================================================================
-- 3. Coluna FK nulável
-- ===========================================================================
ALTER TABLE "Deal" ADD COLUMN "lostReasonId" TEXT;

-- ===========================================================================
-- 4. Backfill por nome casefolded, dentro do próprio owner
-- ===========================================================================
UPDATE "Deal" d
   SET "lostReasonId" = c."id"
  FROM "LostReasonCatalog" c
 WHERE c."ownerId"    = d."ownerId"
   AND lower(c."name") = lower(btrim(d."lostReason"))
   AND d."lostReason" IS NOT NULL
   AND btrim(d."lostReason") <> '';

-- ===========================================================================
-- 5. Guard pós-backfill e drop da coluna de texto
-- ===========================================================================
DO $$
DECLARE perdidos INT;
BEGIN
  SELECT count(*) INTO perdidos
    FROM "Deal"
   WHERE "lostReason" IS NOT NULL
     AND btrim("lostReason") <> ''
     AND "lostReasonId" IS NULL;
  IF perdidos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % oportunidade(s) com motivo de perda não encontraram linha no catálogo do próprio owner.',
      perdidos;
  END IF;
END $$;

ALTER TABLE "Deal" DROP COLUMN "lostReason";

-- ===========================================================================
-- 6. Índices e FKs (molde da Fase 1)
-- ===========================================================================
CREATE UNIQUE INDEX "LostReasonCatalog_ownerId_name_key" ON "LostReasonCatalog"("ownerId", "name");
CREATE INDEX "LostReasonCatalog_ownerId_idx" ON "LostReasonCatalog"("ownerId");
ALTER TABLE "LostReasonCatalog" ADD CONSTRAINT "LostReasonCatalog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Deal_lostReasonId_idx" ON "Deal"("lostReasonId");
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_lostReasonId_fkey"
  FOREIGN KEY ("lostReasonId") REFERENCES "LostReasonCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- 7. RLS (molde de 20260724050000_enable_rls)
-- ===========================================================================
ALTER TABLE "LostReasonCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LostReasonCatalog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "LostReasonCatalog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "LostReasonCatalog" TO crm_app;
