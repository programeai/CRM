-- Tipos de atividade deixam de ser enum fechado e passam a ser catálogo por
-- owner. Quarta e última migration da Fase 13-A.
--
-- Espinha da 20260807100000_service_catalog (FK NOT NULL, uma tabela só). O que
-- é próprio daqui: a coluna `isFollowUp` é semeada junto, porque `FOLLOW_UP`
-- nunca foi só rótulo — é REGRA. O cron de lembretes (cross-owner, pelo client
-- admin) e o dashboard filtravam pelo literal do enum; a partir daqui filtram
-- pela coluna. Zero item marcado num owner = zero lembrete, em silêncio: daí o
-- guard do passo 5b.

-- ===========================================================================
-- 0. Guard de integridade
-- ===========================================================================
DO $$
DECLARE orfaos INT;
BEGIN
  SELECT count(*) INTO orfaos
    FROM "Activity" a
   WHERE NOT EXISTS (
     SELECT 1 FROM "User" u WHERE u."id" = a."ownerId" AND u."ownerId" IS NULL
   );
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % atividade(s) com "ownerId" que não corresponde a um owner em "User". Corrija os dados antes de aplicar.',
      orfaos;
  END IF;
END $$;

-- ===========================================================================
-- 1. Tabela do catálogo
-- ===========================================================================
CREATE TABLE "ActivityTypeCatalog" (
  "id"         TEXT    NOT NULL,
  "ownerId"    TEXT    NOT NULL,
  "name"       TEXT    NOT NULL,
  "isFollowUp" BOOLEAN NOT NULL DEFAULT false,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ActivityTypeCatalog_pkey" PRIMARY KEY ("id")
);

-- ===========================================================================
-- 2. Semeia por owner, com o flag de regra
-- ===========================================================================
-- Fonte a manter em sincronia: apps/api/src/shared/default-catalogs.ts.
INSERT INTO "ActivityTypeCatalog" ("id", "ownerId", "name", "isFollowUp")
SELECT gen_random_uuid()::text, u."id", v.name, v.is_follow_up
  FROM "User" u
 CROSS JOIN (VALUES
   ('Anotação',  false),
   ('Ligação',   false),
   ('Reunião',   false),
   ('E-mail',    false),
   ('WhatsApp',  false),
   ('Follow-up', true)
 ) AS v(name, is_follow_up)
 WHERE u."ownerId" IS NULL;

-- ===========================================================================
-- 3. Coluna FK NULÁVEL
-- ===========================================================================
ALTER TABLE "Activity" ADD COLUMN "typeId" TEXT;

-- ===========================================================================
-- 4. Backfill: literal do enum → linha do catálogo DO PRÓPRIO OWNER
-- ===========================================================================
UPDATE "Activity" a
   SET "typeId" = cat."id"
  FROM (VALUES
    ('NOTE',      'Anotação'),
    ('CALL',      'Ligação'),
    ('MEETING',   'Reunião'),
    ('EMAIL',     'E-mail'),
    ('WHATSAPP',  'WhatsApp'),
    ('FOLLOW_UP', 'Follow-up')
  ) AS m(enum_value, name)
  JOIN "ActivityTypeCatalog" cat ON cat."name" = m.name
 WHERE a."type"::text  = m.enum_value
   AND cat."ownerId"   = a."ownerId";

-- ===========================================================================
-- 5. Guard pós-backfill: a coluna antiga é NOT NULL, então TODA linha tinha
--    valor — qualquer NULL aqui é backfill incompleto.
-- ===========================================================================
DO $$
DECLARE perdidas INT;
BEGIN
  SELECT count(*) INTO perdidas FROM "Activity" WHERE "typeId" IS NULL;
  IF perdidas > 0 THEN
    RAISE EXCEPTION
      'Migration abortada: % atividade(s) não encontraram tipo no catálogo do próprio owner.',
      perdidas;
  END IF;
END $$;

-- ===========================================================================
-- 5b. Guard extra desta migration: cada owner precisa ter EXATAMENTE UM tipo
--     com isFollowUp. O cron depende disso; zero marcados apagaria os
--     lembretes em silêncio.
-- ===========================================================================
DO $$
DECLARE ruins TEXT;
BEGIN
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO ruins
    FROM (
      SELECT "ownerId", count(*) FILTER (WHERE "isFollowUp") AS n
        FROM "ActivityTypeCatalog" GROUP BY "ownerId"
    ) t
   WHERE t.n <> 1;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de tipos marcados como follow-up (esperado 1): %', ruins;
  END IF;
END $$;

-- ===========================================================================
-- 6. SET NOT NULL, depois derrubar a coluna antiga e o tipo
-- ===========================================================================
ALTER TABLE "Activity" ALTER COLUMN "typeId" SET NOT NULL;
ALTER TABLE "Activity" DROP COLUMN "type";
DROP TYPE "ActivityType";

-- ===========================================================================
-- 7. Índices e FKs
-- ===========================================================================
CREATE UNIQUE INDEX "ActivityTypeCatalog_ownerId_name_key" ON "ActivityTypeCatalog"("ownerId", "name");
CREATE INDEX "ActivityTypeCatalog_ownerId_idx" ON "ActivityTypeCatalog"("ownerId");
-- O cron cross-owner filtra por `type: { isFollowUp: true }` — este índice é o
-- que evita varrer o catálogo inteiro de todos os owners a cada rodada.
CREATE INDEX "ActivityTypeCatalog_isFollowUp_idx" ON "ActivityTypeCatalog"("isFollowUp");
ALTER TABLE "ActivityTypeCatalog" ADD CONSTRAINT "ActivityTypeCatalog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Activity_typeId_idx" ON "Activity"("typeId");
-- RESTRICT: excluir um tipo em uso responde 409 no service, não apaga dado.
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "ActivityTypeCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- 8. RLS por ownerId (molde de 20260724050000_enable_rls)
-- ===========================================================================
-- Nota: o cron de lembretes roda pelo client ADMIN (crm_user, superuser), que
-- bypassa RLS — é o que permite a varredura cross-owner de `followUpsDoDia`
-- alcançar o catálogo de todos os owners.
ALTER TABLE "ActivityTypeCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityTypeCatalog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "ActivityTypeCatalog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "ActivityTypeCatalog" TO crm_app;
