-- Atribuição de anúncio na captação de lead: de qual clique o lead veio.
--
-- Colunas nulas e aditivas: nenhum backfill. E nada de RLS a fazer — a policy
-- `owner_isolation` de "Client" é `FOR ALL` sobre a expressão
-- `"ownerId" = current_setting('app.owner_id', true)`, sem enumerar coluna, e
-- privilégio de tabela no Postgres cobre coluna futura. Mesmo caminho de
-- `20260727100000_assignee_per_record` e `20260805100000_lead_source_catalog`,
-- que acrescentaram coluna a "Client" depois do `enable_rls` sem emitir policy
-- nem GRANT. A contagem-âncora de `test/rls.e2e-spec.ts` continua em 27.
--
-- SEM ÍNDICE de propósito, ao contrário de `account_deletion`: lá o índice
-- servia a uma varredura diária real. Aqui nada FILTRA por atribuição nesta
-- fase (relatório por campanha é fase futura), e índice sem consulta é escrita
-- mais lenta em toda ingestão de lead em troca de nada.
--
-- `fbclidAt` é TIMESTAMP(3): o `fbc` da Conversions API precisa do instante em
-- MILISSEGUNDOS, e `timestamp(3)` é exatamente essa precisão.
ALTER TABLE "Client" ADD COLUMN "fbclid"      TEXT;
ALTER TABLE "Client" ADD COLUMN "fbclidAt"    TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "fbp"         TEXT;
ALTER TABLE "Client" ADD COLUMN "gclid"       TEXT;
ALTER TABLE "Client" ADD COLUMN "utmSource"   TEXT;
ALTER TABLE "Client" ADD COLUMN "utmMedium"   TEXT;
ALTER TABLE "Client" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "Client" ADD COLUMN "utmContent"  TEXT;
ALTER TABLE "Client" ADD COLUMN "utmTerm"     TEXT;
ALTER TABLE "Client" ADD COLUMN "landingUrl"  TEXT;
