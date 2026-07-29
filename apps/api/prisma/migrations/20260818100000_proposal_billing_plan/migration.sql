-- Plano de cobrança na proposta --------------------------------------------
-- Aditiva e nullable: proposta já gravada não tem plano, e continuará gerando
-- contrato pela tela de conferência preenchida à mão. Obrigatório é o
-- CreateProposalDto, não a coluna — par assimétrico deliberado.
ALTER TABLE "Proposal" ADD COLUMN "billingType" "BillingType";
ALTER TABLE "Proposal" ADD COLUMN "startOffsetDays" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "billingDay" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "durationMonths" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "downPaymentPercent" DECIMAL(5,2);
ALTER TABLE "Proposal" ADD COLUMN "downPaymentAmount" DECIMAL(12,2);
ALTER TABLE "Proposal" ADD COLUMN "downPaymentOffsetDays" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "installments" INTEGER;

-- Um contrato por proposta -------------------------------------------------
-- Troca de constraint com dado dentro. `CREATE UNIQUE INDEX` reprova se
-- produção já tiver duas linhas com o mesmo proposalId, e reprova com mensagem
-- crua do Postgres ("could not create unique index") que não diz QUAL proposta.
-- Falhar antes, nomeando a proposta e a contagem, é melhor que desempatar
-- sozinho qual contrato "vale": essa escolha é do owner, não da migration.
DO $$
DECLARE duplicadas TEXT;
BEGIN
  SELECT string_agg(t."proposalId" || ' (' || t.n || ' contratos)', ', ')
    INTO duplicadas
    FROM (
      SELECT "proposalId", count(*) AS n
        FROM "Contract"
       WHERE "proposalId" IS NOT NULL
       GROUP BY "proposalId"
      HAVING count(*) > 1
    ) t;
  IF duplicadas IS NOT NULL THEN
    RAISE EXCEPTION
      'Há proposta(s) com mais de um contrato: %. Cancele ou desvincule os contratos excedentes antes de aplicar esta migration.',
      duplicadas;
  END IF;
END $$;

-- NULLs são distintos no Postgres: este índice vale "no máximo um contrato por
-- proposta" E "quantos contratos se quiser sem proposta". Nenhum índice parcial
-- é necessário, e por isso o @unique cabe no schema do Prisma (sem SQL-only,
-- sem risco de `migrate dev` propor derrubá-lo por drift).
CREATE UNIQUE INDEX "Contract_proposalId_key" ON "Contract"("proposalId");
