-- Versionamento de proposta volta a funcionar ------------------------------
-- `Proposal.number` identifica a CADEIA, não a linha: todas as versões de uma
-- proposta compartilham o mesmo número e se distinguem por `version`. O
-- `UNIQUE (number)` do init contradizia isso — `ProposalsService.newVersion`
-- grava o mesmo `number` com `version + 1` e batia em P2002 SEMPRE, então
-- `POST /proposals/:id/new-version` respondia 500 em toda proposta, desde
-- sempre. O unique correto é o PAR.

-- Troca de constraint com dado dentro. O par não pode ter duplicata antes de
-- virar único; falhar aqui, nomeando a cadeia, é melhor que a mensagem crua do
-- Postgres ("could not create unique index"), que não diz QUAL proposta.
-- Na prática o SELECT não deve achar nada: como o versionamento nunca
-- funcionou, não existe nenhuma linha com `version > 1` em lugar nenhum.
DO $$
DECLARE duplicadas TEXT;
BEGIN
  SELECT string_agg(t.number || ' v' || t.version || ' (' || t.n || ' linhas)', ', ')
    INTO duplicadas
    FROM (
      SELECT number, version, count(*) AS n
        FROM "Proposal"
       GROUP BY number, version
      HAVING count(*) > 1
    ) t;
  IF duplicadas IS NOT NULL THEN
    RAISE EXCEPTION
      'Há proposta(s) com o mesmo número E versão: %. Renumere ou remova as duplicatas antes de aplicar esta migration.',
      duplicadas;
  END IF;
END $$;

-- A ordem importa: cria o índice novo ANTES de derrubar o antigo, para não
-- existir janela sem nenhuma garantia de unicidade sobre `number`.
CREATE UNIQUE INDEX "Proposal_number_version_key" ON "Proposal"("number", "version");
DROP INDEX "Proposal_number_key";
