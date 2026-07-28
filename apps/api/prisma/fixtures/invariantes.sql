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

-- ---------------------------------------------------------------------------
-- Catálogo de fontes de lead (20260805100000_lead_source_catalog)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cruzados  INT;
  por_owner TEXT;
BEGIN
  -- Nenhum cliente pode apontar para a fonte de OUTRO owner. É o vazamento
  -- entre workspaces que o casamento por nome no backfill poderia causar.
  SELECT count(*) INTO cruzados
    FROM "Client" c
    JOIN "LeadSourceCatalog" s ON s."id" = c."sourceId"
   WHERE s."ownerId" <> c."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % cliente(s) apontando para fonte de lead de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;

  -- Cada owner da fixture tem de ter recebido as cinco fontes padrão.
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO por_owner
    FROM (SELECT "ownerId", count(*) AS n FROM "LeadSourceCatalog" GROUP BY "ownerId") t
   WHERE t.n <> 5;
  IF por_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de fontes de lead (esperado 5): %', por_owner;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Catálogo de motivos de perda (20260806100000_lost_reason_catalog)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cruzados  INT;
  por_owner TEXT;
BEGIN
  -- Nenhuma oportunidade pode apontar para o motivo de OUTRO owner. O backfill
  -- casa por nome casefolded, então é aqui que o isolamento é conferido.
  SELECT count(*) INTO cruzados
    FROM "Deal" d
    JOIN "LostReasonCatalog" m ON m."id" = d."lostReasonId"
   WHERE m."ownerId" <> d."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % oportunidade(s) apontando para motivo de perda de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;

  -- Cada owner tem de ter recebido ao menos os 7 padrões (pode ter mais, se o
  -- histórico de texto livre trouxe motivos importados como desativados).
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO por_owner
    FROM (SELECT "ownerId", count(*) AS n FROM "LostReasonCatalog" GROUP BY "ownerId") t
   WHERE t.n < 7;
  IF por_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com menos motivos de perda que os 7 padrões: %', por_owner;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Catálogo de tipos de serviço (20260807100000_service_catalog)
-- ---------------------------------------------------------------------------
-- Esta é a migration que a fixture de dois owners exercita de verdade: os 3
-- Deal de `banco-populado.sql` têm `serviceType` literal em owners diferentes.
DO $$
DECLARE
  d INT; p INT; j INT;
  nulos     INT;
  por_owner TEXT;
BEGIN
  -- Nenhum registro pode apontar para o tipo de serviço de OUTRO owner.
  SELECT count(*) INTO d
    FROM "Deal" x JOIN "ServiceCatalog" c ON c."id" = x."serviceTypeId"
   WHERE c."ownerId" <> x."ownerId";
  SELECT count(*) INTO p
    FROM "Proposal" x JOIN "ServiceCatalog" c ON c."id" = x."serviceTypeId"
   WHERE c."ownerId" <> x."ownerId";
  SELECT count(*) INTO j
    FROM "Project" x JOIN "ServiceCatalog" c ON c."id" = x."serviceTypeId"
   WHERE c."ownerId" <> x."ownerId";
  IF d + p + j > 0 THEN
    RAISE EXCEPTION
      'Há % deal(s), % proposta(s) e % projeto(s) apontando para tipo de serviço de OUTRO owner — isolamento por ownerId quebrado.',
      d, p, j;
  END IF;

  -- A coluna é NOT NULL no schema; um NULL aqui significaria constraint perdida.
  SELECT count(*) INTO nulos
    FROM (
      SELECT "serviceTypeId" FROM "Deal"
      UNION ALL SELECT "serviceTypeId" FROM "Proposal"
      UNION ALL SELECT "serviceTypeId" FROM "Project"
    ) t
   WHERE t."serviceTypeId" IS NULL;
  IF nulos > 0 THEN
    RAISE EXCEPTION 'Há % registro(s) sem tipo de serviço — a coluna deveria ser NOT NULL.', nulos;
  END IF;

  -- Cada owner da fixture tem de ter recebido os três serviços padrão.
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO por_owner
    FROM (SELECT "ownerId", count(*) AS n FROM "ServiceCatalog" GROUP BY "ownerId") t
   WHERE t.n <> 3;
  IF por_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de tipos de serviço (esperado 3): %', por_owner;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Catálogo de tipos de atividade (20260808100000_activity_type_catalog)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cruzados  INT;
  nulos     INT;
  por_owner TEXT;
  sem_regra TEXT;
BEGIN
  -- Nenhuma atividade pode apontar para o tipo de OUTRO owner.
  SELECT count(*) INTO cruzados
    FROM "Activity" a JOIN "ActivityTypeCatalog" c ON c."id" = a."typeId"
   WHERE c."ownerId" <> a."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % atividade(s) apontando para tipo de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;

  -- A coluna é NOT NULL no schema.
  SELECT count(*) INTO nulos FROM "Activity" WHERE "typeId" IS NULL;
  IF nulos > 0 THEN
    RAISE EXCEPTION 'Há % atividade(s) sem tipo — a coluna deveria ser NOT NULL.', nulos;
  END IF;

  -- Cada owner tem de ter recebido os seis tipos padrão.
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO por_owner
    FROM (SELECT "ownerId", count(*) AS n FROM "ActivityTypeCatalog" GROUP BY "ownerId") t
   WHERE t.n <> 6;
  IF por_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de tipos de atividade (esperado 6): %', por_owner;
  END IF;

  -- A invariante que MAIS importa: exatamente UM tipo marcado por owner. Zero
  -- marcados silencia o cron de lembretes daquele owner, sem erro nenhum.
  SELECT string_agg(t."ownerId" || '=' || t.n, ', ') INTO sem_regra
    FROM (
      SELECT "ownerId", count(*) FILTER (WHERE "isFollowUp") AS n
        FROM "ActivityTypeCatalog" GROUP BY "ownerId"
    ) t
   WHERE t.n <> 1;
  IF sem_regra IS NOT NULL THEN
    RAISE EXCEPTION 'Owner com número inesperado de tipos marcados como follow-up (esperado 1): %', sem_regra;
  END IF;
END $$;

-- RLS de pé nas tabelas novas (mesma razão do bloco de PipelineStage acima).
DO $$
DECLARE sem_rls TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO sem_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN (
       'LeadSourceCatalog', 'LostReasonCatalog', 'ServiceCatalog',
       'ActivityTypeCatalog', 'IntegrationKey', 'LeadIntakeChannel'
     )
     AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE);
  IF sem_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tabela(s) de catálogo sem RLS habilitado e forçado: %', sem_rls;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Canal de captação de lead (20260812100000_lead_intake_channel)
-- ---------------------------------------------------------------------------
-- Canal de captação não pode apontar para a fonte de lead de OUTRO owner.
DO $$
DECLARE cruzados INT;
BEGIN
  SELECT count(*) INTO cruzados
    FROM "LeadIntakeChannel" ch
    JOIN "LeadSourceCatalog" s ON s."id" = ch."sourceId"
   WHERE s."ownerId" <> ch."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % canal(is) de captação apontando para fonte de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Encerramento de conta (20260814100000_account_deletion)
-- ---------------------------------------------------------------------------
-- As colunas nascem nulas e a migration é aditiva, então não há backfill a
-- conferir. O que se afirma aqui é a REGRA do par, que nenhuma constraint do
-- banco expressa: os dois campos andam juntos, o agendamento é posterior ao
-- pedido, e só owner pode tê-los. Um par meio-preenchido faria o cron expurgar
-- uma conta que ninguém pediu para encerrar — o pior erro possível nesta fase.
DO $$
DECLARE
  meio_par     INT;
  fora_de_ordem INT;
  colaborador  INT;
BEGIN
  SELECT count(*) INTO meio_par FROM "User"
   WHERE ("deletionRequestedAt" IS NULL) <> ("deletionScheduledFor" IS NULL);
  IF meio_par > 0 THEN
    RAISE EXCEPTION 'Há % usuário(s) com encerramento meio-preenchido (um campo nulo e o outro não).', meio_par;
  END IF;

  SELECT count(*) INTO fora_de_ordem FROM "User"
   WHERE "deletionScheduledFor" IS NOT NULL
     AND "deletionScheduledFor" <= "deletionRequestedAt";
  IF fora_de_ordem > 0 THEN
    RAISE EXCEPTION 'Há % usuário(s) com encerramento agendado para antes do próprio pedido.', fora_de_ordem;
  END IF;

  SELECT count(*) INTO colaborador FROM "User"
   WHERE "deletionScheduledFor" IS NOT NULL AND "ownerId" IS NOT NULL;
  IF colaborador > 0 THEN
    RAISE EXCEPTION 'Há % COLABORADOR(es) com encerramento agendado — só owner encerra workspace.', colaborador;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Registro de acesso (20260815100000_access_record)
-- ---------------------------------------------------------------------------
-- Invariante ao contrário das outras: aqui o que se afirma é a AUSÊNCIA de RLS.
-- A linha nasce no login, rota @Public() que roda sem `app.owner_id`; uma policy
-- nesta tabela não daria erro — ela gravaria zero linha e o login responderia
-- sucesso, e o CRM ficaria em descumprimento do Marco Civil em silêncio. Uma
-- migration futura que ligue RLS em bloco reprova aqui, que é o objetivo.
DO $$
DECLARE com_rls BOOL;
BEGIN
  SELECT c.relrowsecurity INTO com_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'AccessRecord';
  IF com_rls IS NULL THEN
    RAISE EXCEPTION 'Tabela "AccessRecord" não existe — a migration de registro de acesso não aplicou.';
  END IF;
  IF com_rls THEN
    RAISE EXCEPTION 'Tabela "AccessRecord" está com RLS habilitado — o login roda sem app.owner_id e passaria a gravar zero linha em silêncio.';
  END IF;
END $$;
