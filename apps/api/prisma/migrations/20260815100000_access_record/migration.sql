-- Fase 19-A: registro de acesso do Marco Civil (art. 5º, VIII e art. 15).
--
-- SEM `ENABLE ROW LEVEL SECURITY`, e a ausência é deliberada: a linha nasce no
-- login, rota @Public() que roda sem `app.owner_id`. Uma policy aqui não daria
-- erro — gravaria zero linha e o login responderia sucesso, e o CRM ficaria em
-- descumprimento do Marco Civil em silêncio. Roda como crm_user (superuser),
-- que bypassa RLS de qualquer forma; o `ALTER DEFAULT PRIVILEGES` de
-- 20260724040000_create_app_role já concede os quatro verbos a crm_app.
--
-- Sem FK para "User", de propósito (ver o docblock do modelo): apagar a conta
-- (Fase 19-A, expurgo) não pode apagar o registro que a lei manda guardar.
CREATE TYPE "AccessRecordKind" AS ENUM ('LOGIN', 'LOGIN_OAUTH', 'ACEITE_DE_CONVITE', 'LOGOUT');

CREATE TABLE "AccessRecord" (
  "id"        TEXT               NOT NULL,
  "userId"    TEXT               NOT NULL,
  "kind"      "AccessRecordKind" NOT NULL,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccessRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessRecord_userId_createdAt_idx" ON "AccessRecord"("userId", "createdAt");
CREATE INDEX "AccessRecord_createdAt_idx" ON "AccessRecord"("createdAt");
