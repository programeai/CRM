-- Fase 14-A: a trilha passa a cobrir a importação em massa.
--
-- A entidade auditada É a importação, não o cliente: um evento por linha
-- importada seria ruído (500 linhas do mesmo autor no mesmo instante), e usar
-- CLIENT com o id de um dos clientes escolheria arbitrariamente um deles como
-- representante do lote. `AuditLog.entityId` não tem FK justamente para
-- comportar um id que não é de nenhuma tabela — aqui, o id do lote.
--
-- PG16 aceita ADD VALUE dentro do bloco de transação que o Prisma abre; o valor
-- só não pode ser USADO na mesma transação, e esta migration não o usa.
ALTER TYPE "AuditEntity" ADD VALUE 'IMPORT';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORTAR';
