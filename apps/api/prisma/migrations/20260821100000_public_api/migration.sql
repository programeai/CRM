-- ===========================================================================
-- Ator da trilha: escrita por chave de integração não é USER (não há pessoa),
-- não é CRON (não é rotina) e não é WEBHOOK (não é evento recebido). Sem valor
-- próprio, a trilha da API pública mentiria sobre quem agiu.
-- `ALTER TYPE … ADD VALUE` é IRREVERSÍVEL: migration antes do código, sempre.
-- ===========================================================================
ALTER TYPE "AuditActorType" ADD VALUE 'INTEGRACAO';
