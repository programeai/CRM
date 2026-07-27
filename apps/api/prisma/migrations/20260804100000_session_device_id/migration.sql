-- Identidade do aparelho na sessão: o cookie `device_id`, estável entre logins.
-- Aditiva e anulável de propósito — sessão que já existe fica com NULL, e o
-- primeiro refresh dela grava o valor (ver SessionsService.rotate). Sem backfill:
-- não há de onde inferir o aparelho de uma sessão antiga.
ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;

-- Sustenta o filtro (userId, deviceId) que o login usa para revogar a sessão
-- anterior do mesmo aparelho.
CREATE INDEX "Session_userId_deviceId_idx" ON "Session"("userId", "deviceId");
