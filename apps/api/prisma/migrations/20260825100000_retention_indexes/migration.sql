-- ===========================================================================
-- Índices para a varredura de retenção, que é CROSS-OWNER e filtra só por data.
-- Os índices existentes têm `ownerId` como coluna LÍDER
-- (`AuditLog_ownerId_createdAt_idx`, `Notification_ownerId_userId_createdAt_idx`),
-- e prefixo à esquerda não serve a um filtro que não tem `ownerId`: sem estes
-- dois a faxina diária vira seq scan nas duas maiores tabelas do banco.
-- Mesmo raciocínio de `AccessRecord_createdAt_idx`, criado para a mesma coisa.
-- ===========================================================================
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
