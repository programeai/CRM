-- Estágios padrão do pipeline.
--
-- Os estágios são globais (sem ownerId) e só existiam via `prisma/seed.ts`, que
-- roda apenas em desenvolvimento. Em produção o Kanban nascia vazio e nenhuma
-- oportunidade podia ser criada (`firstStage()` → "Nenhum estágio configurado").
-- Esta migration planta os mesmos 7 estágios do seed.
--
-- Só age quando a tabela está vazia: quem já configurou o próprio funil não tem
-- nada sobrescrito nem estágio novo aparecendo do nada.
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
