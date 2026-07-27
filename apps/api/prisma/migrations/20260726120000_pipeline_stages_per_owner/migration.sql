-- Estágios do funil deixam de ser um catálogo global da instância e passam a ser
-- dado por owner, com RLS. Resgata o débito declarado em
-- specs/research/2026-07-23-rls-por-ownerid.md:202.
--
-- Notas de projeto:
--  * ownerId é TEXT → comparação texto=texto, SEM cast ::uuid.
--  * PipelineStage.id é TEXT (@default(uuid())) → gen_random_uuid()::text.
--  * Roda como crm_user (superuser), que bypassa RLS — não é preciso setar
--    app.owner_id aqui.
--  * A ordem é obrigatória: derrubar o unique global de "name" → criar as
--    cópias → religar os Deal → apagar as originais. O unique precisa cair
--    primeiro porque as cópias repetem os nomes do template; e o DELETE precisa
--    vir por último porque Deal_stageId_fkey é ON DELETE RESTRICT.

-- ===========================================================================
-- 0. Guard de integridade
-- ===========================================================================
-- Deal.ownerId é coluna sem FK: nada no banco garante que aponta para um owner
-- real. A replicação abaixo parte de `User WHERE "ownerId" IS NULL`, então um
-- Deal com ownerId fora desse conjunto ficaria sem cópia de estágio para onde
-- apontar — e o DELETE do passo 5 estouraria na FK no meio da migration.
-- Melhor abortar aqui, com mensagem clara.
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
      'Migration abortada: % oportunidade(s) com "ownerId" que não corresponde a um owner em "User". Corrija os dados antes de aplicar.',
      orfaos;
  END IF;
END $$;

-- ===========================================================================
-- 1. Coluna nullable (o ADD COLUMN NOT NULL do Prisma falharia com dados)
-- ===========================================================================
ALTER TABLE "PipelineStage" ADD COLUMN "ownerId" TEXT;

-- ===========================================================================
-- 2. Template de partida
-- ===========================================================================
-- As linhas com "ownerId" nulo são o catálogo global que existe hoje (plantado
-- por 20260725130000_seed_default_pipeline_stages, possivelmente já renomeado /
-- reordenado / acrescido por quem chegou primeiro). Se a tabela estiver vazia
-- (ex.: banco recriado do zero, sem owners ainda), planta os 7 padrões para a
-- replicação ter de onde partir — sem owner, os passos 4-5 não fazem nada e o
-- passo 5 limpa tudo, deixando a tabela vazia e correta.
INSERT INTO "PipelineStage" ("id", "name", "order", "isWon", "isLost")
SELECT gen_random_uuid()::text, v.name, v.ordem, v.is_won, v.is_lost
FROM (VALUES
  ('Novo lead',            0, false, false),
  ('Contato feito',        1, false, false),
  ('Reunião/Diagnóstico',  2, false, false),
  ('Proposta enviada',     3, false, false),
  ('Negociação',           4, false, false),
  ('Ganhou',               5, true,  false),
  ('Perdeu',               6, false, true)
) AS v(name, ordem, is_won, is_lost)
WHERE NOT EXISTS (SELECT 1 FROM "PipelineStage");

-- ===========================================================================
-- 3. Derrubar o unique global de "name"
-- ===========================================================================
-- Precisa cair ANTES da replicação: `PipelineStage_name_key` é UNIQUE("name")
-- em coluna única, e o passo 4 insere cópias com os MESMOS nomes do template,
-- que ainda está na tabela. Com o índice de pé, a primeira cópia já estoura —
-- e só estoura onde existe owner, por isso um banco vazio (dev/CI) passava.
--
-- O passo 5 casa por "name" e depende de o template não ter nomes repetidos:
-- isso continua garantido, porque as linhas de template existentes nasceram sob
-- este índice. O unique composto entra no passo 7, depois da limpeza.
DROP INDEX "PipelineStage_name_key";

-- ===========================================================================
-- 4. Replicar o template por owner
-- ===========================================================================
-- `WHERE u."ownerId" IS NULL` é o predicado canônico de "é owner" (colaborador
-- tem ownerId preenchido e herda o funil do owner, não ganha o próprio).
-- Owner sem nenhum deal também recebe: a origem é "User", não "Deal".
-- O CTE lê o snapshot do início da statement, então não enxerga as linhas que
-- este próprio INSERT cria.
WITH owners AS (
  SELECT "id" AS owner_id FROM "User" WHERE "ownerId" IS NULL
),
template AS (
  SELECT "name", "order", "isWon", "isLost"
    FROM "PipelineStage"
   WHERE "ownerId" IS NULL
)
INSERT INTO "PipelineStage" ("id", "ownerId", "name", "order", "isWon", "isLost")
SELECT gen_random_uuid()::text, o.owner_id, t."name", t."order", t."isWon", t."isLost"
  FROM owners o
 CROSS JOIN template t;

-- ===========================================================================
-- 5. Religar cada Deal à cópia do seu próprio owner
-- ===========================================================================
-- O casamento é por "name". Os nomes do template são distintos entre si (o
-- unique global vigorou durante toda a vida dessas linhas), e o filtro
-- `clone."ownerId" = d."ownerId"` isola um único owner, então o join produz
-- exatamente uma linha por deal.
UPDATE "Deal" d
   SET "stageId" = clone."id"
  FROM "PipelineStage" orig
  JOIN "PipelineStage" clone ON clone."name" = orig."name"
 WHERE d."stageId"     = orig."id"
   AND orig."ownerId"  IS NULL
   AND clone."ownerId" = d."ownerId";

-- Nenhum Deal aponta mais para o template → a FK ON DELETE RESTRICT não bloqueia.
DELETE FROM "PipelineStage" WHERE "ownerId" IS NULL;

-- ===========================================================================
-- 6. NOT NULL + índice + FK
-- ===========================================================================
ALTER TABLE "PipelineStage" ALTER COLUMN "ownerId" SET NOT NULL;
CREATE INDEX "PipelineStage_ownerId_idx" ON "PipelineStage"("ownerId");
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 7. Unique composta (o global caiu no passo 3)
-- ===========================================================================
CREATE UNIQUE INDEX "PipelineStage_ownerId_name_key" ON "PipelineStage"("ownerId", "name");

-- ===========================================================================
-- 8. RLS por ownerId (molde de 20260724050000_enable_rls)
-- ===========================================================================
--  * current_setting('app.owner_id', true): o `true` é missing_ok → contexto
--    ausente vira NULL → policy casa zero linhas (FAIL-CLOSED), nunca erro.
--  * USING e WITH CHECK idênticos: leitura e escrita presas ao mesmo owner.
--  * FORCE: sujeita até o dono da tabela; crm_user (superuser) continua
--    bypassando por ser superuser — é o que mantém migrations e seed.
ALTER TABLE "PipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineStage" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "PipelineStage"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- GRANT explícito para a role da aplicação. O ALTER DEFAULT PRIVILEGES de
-- 20260724040000_create_app_role já cobre, mas repetimos para a migration ser
-- autossuficiente em bancos provisionados à mão.
GRANT SELECT, INSERT, UPDATE, DELETE ON "PipelineStage" TO crm_app;
