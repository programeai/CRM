CREATE TYPE "ConsentSubjectType" AS ENUM ('CLIENT', 'CONTACT');

-- ===========================================================================
-- Livro-razão de consentimento. APPEND-ONLY, e isso é exigência da lei, não
-- preferência de modelagem: o art. 8º § 5º manda que a revogação preserve
-- "ratificados os tratamentos realizados sob amparo do consentimento
-- anteriormente manifestado" — sobrescrever a linha apagaria a prova de que o
-- consentimento existiu, e o § 2º põe o ônus dessa prova no controlador.
--
-- Uma linha POR FINALIDADE (art. 8º § 4º: "as autorizações genéricas … serão
-- nulas"). Nunca um booleano agregado de "aceitou tudo".
-- ===========================================================================
CREATE TABLE "ConsentRecord" (
  "id"                TEXT NOT NULL,
  "ownerId"           TEXT NOT NULL,
  "subjectType"       "ConsentSubjectType" NOT NULL,
  "subjectId"         TEXT NOT NULL,
  -- Chave do catálogo de finalidades (`domain/consent-purpose.ts`).
  "purpose"           TEXT NOT NULL,
  -- `true` = consentiu; `false` = revogou. A revogação é LINHA NOVA.
  "granted"           BOOLEAN NOT NULL,
  -- Versão do texto apresentado ao titular (art. 9º § 1º e art. 8º § 6º:
  -- alteração das informações obriga a re-informar). Sem isto não há como dizer
  -- A QUE o titular consentiu.
  "textVersion"       TEXT NOT NULL,
  -- Como se manifestou ("formulario-site", "whatsapp", "telefone", "presencial").
  -- Art. 8º caput + guia de cookies da ANPD: a evidência do COMO faz parte da
  -- comprovação.
  "channel"           TEXT NOT NULL,
  -- Evidência livre: id do envio do formulário, print, número do protocolo.
  "evidence"          TEXT,
  -- Prazo de retenção INFORMADO ao titular. A ausência dessa informação "viola a
  -- exigência legal de que o consentimento deve ser informado" (guia da ANPD).
  "informedRetention" TEXT,
  -- Quem registrou (colaborador do owner). Sem FK: apagar o usuário não pode
  -- apagar a prova — mesma decisão de `AuditLog.actorId`.
  "recordedByUserId"  TEXT,
  "recordedByName"    TEXT NOT NULL,
  -- Quando o titular se manifestou, que pode ser ANTES de alguém digitar.
  "occurredAt"        TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsentRecord_ownerId_subjectType_subjectId_purpose_idx"
  ON "ConsentRecord"("ownerId", "subjectType", "subjectId", "purpose", "occurredAt");
CREATE INDEX "ConsentRecord_ownerId_createdAt_idx" ON "ConsentRecord"("ownerId", "createdAt");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "ConsentRecord"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Append-only NO BANCO, não por disciplina de código: molde exato do `AuditLog`.
-- Um livro-razão que a própria aplicação pode reescrever não é prova de nada.
GRANT SELECT, INSERT ON "ConsentRecord" TO crm_app;
REVOKE UPDATE, DELETE ON "ConsentRecord" FROM crm_app;
