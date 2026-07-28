-- Fase 19-A: vocabulário da trilha para os eventos de conta.
--
-- `ACCOUNT` existe separado de `USER` porque são coisas diferentes na tela: `USER`
-- é o colaborador (convidar/ativar/desativar), `ACCOUNT` é a workspace inteira.
--
-- Aditivo e sem backfill: não há invariante nova a afirmar em `invariantes.sql`.
ALTER TYPE "AuditEntity" ADD VALUE IF NOT EXISTS 'ACCOUNT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORTAR';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCERRAR';
