-- Ativa Row-Level Security por ownerId nas 10 tabelas de dados.
-- User e PipelineStage ficam de fora (auth por email / estágios globais).
--
-- Notas de projeto:
--  * ownerId é TEXT → comparação texto=texto, SEM cast ::uuid.
--  * current_setting('app.owner_id', true): o `true` é missing_ok → contexto
--    ausente vira NULL → policy casa zero linhas (FAIL-CLOSED), nunca erro.
--  * USING e WITH CHECK idênticos: leitura e escrita presas ao mesmo owner.
--  * FORCE: sujeita até o dono da tabela; crm_user (superuser) continua
--    bypassando por ser superuser — é o que mantém migrations/seed/crons.

-- Client
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Client"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Contact
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Contact"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Deal
ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Deal"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Proposal
ALTER TABLE "Proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Proposal" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Proposal"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- ProposalItem
ALTER TABLE "ProposalItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProposalItem" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "ProposalItem"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Project
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Project"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Task
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Task"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Contract
ALTER TABLE "Contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contract" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Contract"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Payment
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Payment"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Activity
ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Activity" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Activity"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
