-- Follow-up deixa de ser marca MÓVEL e passa a ser TIPO PRIMITIVO: nasce com a
-- conta, nunca é excluído, e é o único tipo que os lembretes usam.
--
-- O que muda de verdade é a AUSÊNCIA de escrita: `isFollowUp` sai dos DTOs, o
-- `PATCH /catalogos/:kind/:id` deixa de existir e `desmarcarOutrosFollowUp` é
-- removido do repositório. Depois desta migration, os únicos lugares que gravam
-- a coluna são o provisionamento da conta (`shared/default-catalogs.ts`) e as
-- migrations — nenhuma requisição alcança mais o campo.
--
-- Daí a urgência desta migration: o `PATCH { isFollowUp: false }` esteve aberto
-- desde a 20260808100000, e quem tivesse ficado com ZERO tipos marcados perderia
-- os lembretes para sempre — sem via de conserto, porque a rota que remarcava
-- some no mesmo deploy. Aqui é a última chance de normalizar o dado.
--
-- Por que não um unique parcial (`... ON ("ownerId") WHERE "isFollowUp"`): o
-- schema do Prisma não expressa índice parcial, e o fluxo do time usa
-- `prisma migrate dev` (ver README) — o índice apareceria como drift e a próxima
-- migration gerada proporia derrubá-lo. A exclusividade fica garantida por não
-- existir código que escreva a coluna, e o portão de CI a confere em
-- `prisma/fixtures/invariantes.sql`.

-- ===========================================================================
-- 1. No máximo um marcado por owner
-- ===========================================================================
-- `create` + `desmarcarOutrosFollowUp` nunca rodaram na mesma transação, então
-- duas requisições concorrentes podiam deixar dois marcados. Sobra um: o que se
-- chama 'Follow-up' tem preferência; o resto do critério é só determinismo.
UPDATE "ActivityTypeCatalog" c
   SET "isFollowUp" = false
 WHERE c."isFollowUp"
   AND c."id" <> (
     SELECT x."id"
       FROM "ActivityTypeCatalog" x
      WHERE x."ownerId" = c."ownerId"
        AND x."isFollowUp"
      ORDER BY (lower(x."name") = 'follow-up') DESC, x."active" DESC, x."id"
      LIMIT 1
   );

-- ===========================================================================
-- 2. Owner sem nenhum marcado: promove o 'Follow-up' que ele já tem
-- ===========================================================================
-- Inclusive se estiver oculto (`active = false`): um tipo primitivo invisível
-- não aparece no Select e ninguém consegue registrar follow-up.
UPDATE "ActivityTypeCatalog" c
   SET "isFollowUp" = true,
       "active"     = true
 WHERE c."id" IN (
   SELECT DISTINCT ON (t."ownerId") t."id"
     FROM "ActivityTypeCatalog" t
    WHERE lower(t."name") = 'follow-up'
      AND NOT EXISTS (
        SELECT 1
          FROM "ActivityTypeCatalog" x
         WHERE x."ownerId" = t."ownerId"
           AND x."isFollowUp"
      )
    ORDER BY t."ownerId", t."active" DESC, t."id"
 );

-- ===========================================================================
-- 3. Owner sem marcado E sem 'Follow-up': cadastra o primitivo
-- ===========================================================================
-- Fonte do nome a manter em sincronia: apps/api/src/shared/default-catalogs.ts.
-- Não colide com o unique (ownerId, name): quem já tinha o nome foi promovido no
-- passo 2, então aqui só entra owner que não o tem em nenhuma caixa.
INSERT INTO "ActivityTypeCatalog" ("id", "ownerId", "name", "isFollowUp", "active")
SELECT gen_random_uuid()::text, u."id", 'Follow-up', true, true
  FROM "User" u
 WHERE u."ownerId" IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM "ActivityTypeCatalog" x
      WHERE x."ownerId" = u."id"
        AND x."isFollowUp"
   );

-- ===========================================================================
-- 4. O primitivo está sempre utilizável
-- ===========================================================================
-- Cobre o marcado que já existia oculto (o passo 2 só toca em quem ele promove).
UPDATE "ActivityTypeCatalog"
   SET "active" = true
 WHERE "isFollowUp"
   AND NOT "active";

-- ===========================================================================
-- 5. Guard pós-backfill
-- ===========================================================================
-- Terminar com exit 0 e dado errado é o modo de falha que este projeto já pagou
-- caro: zero marcados não derruba nada, só silencia o cron de lembretes daquele
-- owner. A afirmação vale para todo owner, não só para os que foram tocados.
DO $$
DECLARE ruins TEXT;
BEGIN
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO ruins
    FROM (
      SELECT u."id" AS "ownerId",
             count(c.*) FILTER (WHERE c."isFollowUp" AND c."active") AS n
        FROM "User" u
        LEFT JOIN "ActivityTypeCatalog" c ON c."ownerId" = u."id"
       WHERE u."ownerId" IS NULL
       GROUP BY u."id"
    ) t
   WHERE t.n <> 1;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration abortada: owner com número inesperado de tipos de follow-up ativos (esperado 1): %', ruins;
  END IF;
END $$;
