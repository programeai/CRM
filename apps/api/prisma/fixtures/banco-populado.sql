-- Fixture de banco POVOADO, usada só pelo portão de CI
-- `scripts/validar-migrations-com-dados.sh`. Não vai para produção nem para o
-- seed de desenvolvimento.
--
-- Por que ela existe
-- ------------------
-- Migration é validada hoje contra banco recém-criado: o `global-setup.ts` do
-- e2e cria o banco e roda `migrate deploy` numa base vazia, e só depois semeia.
-- Isso deixa passar a classe de bug mais caro que existe em migration — a que
-- só aparece quando há dado. Foi assim que 20260726120000_pipeline_stages_per_owner
-- passou verde no CI e derrubou a API em produção por 11 horas: ela replica os
-- estágios do funil por owner com um CROSS JOIN sobre `User`, e num banco sem
-- nenhum User o CROSS JOIN não insere linha nenhuma — o índice único que ela
-- violava nunca era tocado.
--
-- Por que ela usa SÓ colunas do init
-- ----------------------------------
-- O script insere esta fixture logo depois de 20260721002325_init e antes de
-- todas as outras migrations, para que TODA migration seguinte rode contra dado
-- real. Se a fixture usasse colunas criadas depois, ela quebraria no ponto de
-- inserção. Então aqui só existe o que o init já criou — nada de `ownerId` em
-- Deal (vem de 20260724025450_denormalize_owner_id) nem de `User.ownerId` (vem
-- de 20260725120000_add_collaborators_and_roles).
--
-- Consequência a manter em mente: acrescentar coluna NOT NULL sem default a uma
-- destas tabelas fará este portão ficar vermelho. Isso é o portão funcionando —
-- em produção a mesma migration falharia igual. O conserto é dar default ou
-- fazer o backfill na migration, não enfraquecer a fixture.

-- Dois owners: um só não pega bug que aparece na fronteira entre workspaces
-- (dado de um owner vazando para o outro, cópia por owner que colide entre si).
INSERT INTO "User" ("id", "name", "email", "passwordHash") VALUES
  ('11111111-1111-4111-8111-111111111111', 'Agência Um',   'um@exemplo.test',   'hash-de-fixture-nao-e-senha'),
  ('22222222-2222-4222-8222-222222222222', 'Agência Dois',  'dois@exemplo.test', 'hash-de-fixture-nao-e-senha');

INSERT INTO "Client" ("id", "ownerId", "name", "tags", "updatedAt") VALUES
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Cliente do Um',   '{}', CURRENT_TIMESTAMP),
  ('c2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Cliente do Dois', '{}', CURRENT_TIMESTAMP);

-- Os sete estágios com os MESMOS nomes que 20260725130000_seed_default_pipeline_stages
-- plantaria. Com a tabela já povoada, aquela migration corretamente não faz nada
-- (ela só age em tabela vazia) — que é exatamente o estado de um banco de
-- produção onde alguém já usou o funil.
INSERT INTO "PipelineStage" ("id", "name", "order", "isWon", "isLost") VALUES
  ('e0000000-0000-4000-8000-000000000000', 'Novo lead',           0, false, false),
  ('e0000000-0000-4000-8000-000000000001', 'Contato feito',       1, false, false),
  ('e0000000-0000-4000-8000-000000000002', 'Reunião/Diagnóstico', 2, false, false),
  ('e0000000-0000-4000-8000-000000000003', 'Proposta enviada',    3, false, false),
  ('e0000000-0000-4000-8000-000000000004', 'Negociação',          4, false, false),
  ('e0000000-0000-4000-8000-000000000005', 'Ganhou',              5, true,  false),
  ('e0000000-0000-4000-8000-000000000006', 'Perdeu',              6, false, true);

-- Deals dos DOIS owners, apontando para estágios diferentes do catálogo global.
-- São eles que forçam a migration de funil por owner a religar cada deal à cópia
-- do seu próprio owner — e que fariam a FK ON DELETE RESTRICT estourar se a
-- ordem dos passos estivesse errada.
INSERT INTO "Deal" ("id", "clientId", "stageId", "title", "serviceType", "position", "updatedAt") VALUES
  ('d1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-000000000000', 'Site institucional', 'WEBSITE', 0, CURRENT_TIMESTAMP),
  ('d1111111-1111-4111-8111-111111111112', 'c1111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-000000000004', 'Tráfego pago',       'PAID_TRAFFIC', 1, CURRENT_TIMESTAMP),
  ('d2222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222222',
   'e0000000-0000-4000-8000-000000000000', 'Landing page',       'WEBSITE', 0, CURRENT_TIMESTAMP);
