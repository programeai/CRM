-- Invariantes conferidas depois que TODAS as migrations rodaram sobre a fixture
-- de `banco-populado.sql`. Rodadas pelo portão de CI
-- `scripts/validar-migrations-com-dados.sh`.
--
-- "A migration não estourou" é um portão fraco: migration de backfill pode
-- terminar com exit 0 e deixar o dado errado — deal apontando para o estágio de
-- outro owner, coluna nova nula onde deveria ter sido preenchida. Um erro desses
-- não derruba a API; ele corrompe silenciosamente e aparece semanas depois.
-- Cada bloco abaixo é uma afirmação que precisa valer com dado real.
--
-- RAISE EXCEPTION aborta com exit code diferente de zero, que é o que reprova o
-- passo no CI. A mensagem tem de dizer o que está errado e quanto — quem lê o
-- log vermelho não tem o banco à mão.

-- ---------------------------------------------------------------------------
-- Funil por owner (20260726120000_pipeline_stages_per_owner)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sem_owner  INT;
  cruzados   INT;
  por_owner  TEXT;
BEGIN
  -- Nenhum estágio pode ter sobrado no catálogo global.
  SELECT count(*) INTO sem_owner FROM "PipelineStage" WHERE "ownerId" IS NULL;
  IF sem_owner > 0 THEN
    RAISE EXCEPTION 'Sobrou % estágio(s) de funil sem ownerId — a replicação por owner não limpou o catálogo global.', sem_owner;
  END IF;

  -- Nenhum deal pode apontar para o estágio de outro owner. É o vazamento entre
  -- workspaces que a replicação poderia causar ao casar os estágios por nome.
  SELECT count(*) INTO cruzados
    FROM "Deal" d
    JOIN "PipelineStage" s ON s."id" = d."stageId"
   WHERE s."ownerId" <> d."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % deal(s) apontando para estágio de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;

  -- Cada owner da fixture tem de ter recebido os sete estágios.
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO por_owner
    FROM (SELECT "ownerId", count(*) AS n FROM "PipelineStage" GROUP BY "ownerId") t
   WHERE t.n <> 7;
  IF por_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de estágios (esperado 7): %', por_owner;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Denormalização de ownerId (20260724025450_denormalize_owner_id)
-- ---------------------------------------------------------------------------
-- Todo Deal precisa ter herdado o ownerId do seu Client. Um NULL aqui significa
-- backfill incompleto — e como Deal.ownerId não tem FK, nada no banco reclamaria.
DO $$
DECLARE orfaos INT;
BEGIN
  SELECT count(*) INTO orfaos
    FROM "Deal" d
    JOIN "Client" c ON c."id" = d."clientId"
   WHERE d."ownerId" IS DISTINCT FROM c."ownerId";
  IF orfaos > 0 THEN
    RAISE EXCEPTION 'Há % deal(s) com ownerId diferente do ownerId do próprio cliente.', orfaos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS continua de pé nas tabelas de dado do owner
-- ---------------------------------------------------------------------------
-- Migration que recria tabela pode derrubar policy sem ninguém notar: o app
-- segue funcionando (roda como superuser nas migrations) e o isolamento morre em
-- silêncio. Confere que as tabelas centrais seguem com RLS habilitado E forçado.
DO $$
DECLARE sem_rls TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO sem_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('Client', 'Deal', 'PipelineStage')
     AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE);
  IF sem_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela(s) sem RLS habilitado e forçado: %', sem_rls;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Notificações (20260731100000_notifications)
-- ---------------------------------------------------------------------------
-- As três tabelas nascem com RLS habilitado, forçado E com policy. Aqui não há
-- backfill a conferir (a migration é aditiva e as tabelas nascem vazias), mas o
-- que ela cria é justamente o isolamento — e `Notification` é a única tabela do
-- sistema endereçada por PESSOA dentro da workspace, então um RLS ausente aqui
-- vazaria a caixa de um colaborador para outro owner sem nada reclamar.
DO $$
DECLARE
  sem_rls    TEXT;
  sem_policy TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO sem_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('Notification', 'NotificationDelivery', 'UserNotificationTarget')
     AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE);
  IF sem_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela(s) de notificação sem RLS habilitado e forçado: %', sem_rls;
  END IF;

  -- RLS habilitado sem policy nenhuma casa zero linhas: fail-closed silencioso,
  -- que faria o sino ficar permanentemente vazio em produção.
  SELECT string_agg(t.nome, ', ') INTO sem_policy
    FROM (VALUES ('Notification'), ('NotificationDelivery'), ('UserNotificationTarget')) AS t(nome)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.nome AND p.policyname = 'owner_isolation'
   );
  IF sem_policy IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela(s) de notificação sem a policy owner_isolation: %', sem_policy;
  END IF;
END $$;
