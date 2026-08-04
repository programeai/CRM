-- ===========================================================================
-- Segundo fator TOTP. FORA do RLS, no grupo de User/Session/PasswordResetToken:
-- a verificação acontece no login, que é rota @Public() e roda sem
-- `app.owner_id` — uma policy aqui fecharia a escrita (fail-closed grava zero
-- linha e a rota responde sucesso). O isolamento é por filtro de `userId`.
-- ===========================================================================
CREATE TABLE "UserTotp" (
  "userId"        TEXT NOT NULL,
  "ciphertext"    TEXT NOT NULL,
  "iv"            TEXT NOT NULL,
  "tag"           TEXT NOT NULL,
  "keyVersion"    INTEGER NOT NULL DEFAULT 1,
  -- Momento em que o titular provou que o autenticador está sincronizado.
  -- NULL = cadastro iniciado e nunca concluído: NÃO exige segundo fator.
  "confirmedAt"   TIMESTAMP(3),
  -- Último passo de 30s ACEITO. É a defesa de replay exigida pela RFC 6238 §5.2
  -- ("MUST NOT accept the second attempt of the OTP after the successful
  -- validation") e pela NIST SP 800-63B. Nenhuma biblioteca resolve isso.
  "lastUsedStep"  BIGINT,
  -- Falhas consecutivas e trava temporária: a NIST SP 800-63B limita tentativas
  -- falhas consecutivas por conta. O throttler protege por IP; isto protege a
  -- CONTA.
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTotp_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Códigos de recuperação. sha256 (não argon2) pela mesma razão do
-- PasswordResetToken: a entropia escolhida basta, e a busca tem de ser um
-- findUnique indexado — o código chega SOZINHO, sem identificador ao lado.
-- ===========================================================================
CREATE TABLE "UserTotpRecoveryCode" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTotpRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTotpRecoveryCode_codeHash_key" ON "UserTotpRecoveryCode"("codeHash");
CREATE INDEX "UserTotpRecoveryCode_userId_idx" ON "UserTotpRecoveryCode"("userId");
ALTER TABLE "UserTotpRecoveryCode" ADD CONSTRAINT "UserTotpRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Registro de acesso: login com segundo fator é um acesso bem-sucedido de
-- natureza distinta, e a tabela só registra sucesso (ver o docblock do modelo).
-- Tentativa FALHA de 2FA continua fora daqui, de propósito.
-- ===========================================================================
ALTER TYPE "AccessRecordKind" ADD VALUE 'LOGIN_2FA';
