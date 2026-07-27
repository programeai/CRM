-- Sessões múltiplas: uma linha por dispositivo logado, substituindo o
-- `User.refreshTokenHash` (valor único, uma sessão por usuário).
--
-- Notas de projeto:
--  * Session fica FORA do RLS, como User/OAuthAccount/PasswordResetToken: a
--    linha é criada no login (@Public), onde não existe `app.owner_id`. Uma
--    policy aqui casaria zero linhas (fail-closed) e fecharia o login.
--  * Sem GRANT explícito: o `ALTER DEFAULT PRIVILEGES` de
--    20260724040000_create_app_role já concede os quatro verbos a crm_app em
--    toda tabela criada depois por crm_user (que é quem roda as migrations).
--  * ON DELETE CASCADE: apagar o usuário apaga as sessões dele (o inverso de
--    `assigneeId`, que é dado de negócio do owner e usa SET NULL).
--  * DROP COLUMN "refreshTokenHash" DERRUBA TODAS AS SESSÕES ATIVAS em produção
--    — todo mundo precisa entrar de novo. É esperado e não há backfill possível
--    (o hash antigo não tem `sid` correspondente).
--  * Roda como crm_user (superuser), que bypassa RLS.

CREATE TABLE "Session" (
  "id"         TEXT         NOT NULL,
  "userId"     TEXT         NOT NULL,
  "tokenHash"  TEXT         NOT NULL,
  "userAgent"  TEXT,
  "ip"         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_expiresAt_idx"        ON "Session"("expiresAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "refreshTokenHash";
