-- "Esfriando" deixa de ser só pintura no card e passa a AVISAR.
--
-- O indicador existe no quadro desde a Fase 2 (`Deal.stageMovedAt`, lido por
-- `isCooling` no apps/web com limite de 7 dias), mas só quem abria o Pipeline o
-- via. O README anunciava "alerta de oportunidade esfriando", o que promete
-- notificação: este é o tipo que cumpre a promessa.
--
-- Duas coisas, nenhuma delas backfill:
--
--   1. `DEAL_STALE` entra no enum, posicionado DEPOIS de `FOLLOW_UP_DUE` para a
--      ordem do tipo no banco bater com a do schema.prisma (Prisma introspecta a
--      ordem do enum; sem o AFTER, a próxima migration gerada acusaria drift).
--   2. Índice para a varredura diária do cron.
--
-- O que esta migration deliberadamente NÃO faz: escrever em
-- `UserNotificationTarget.types`. Preferência de notificação é opt-in por
-- destino e nenhuma migration escreve escolha de usuário — a regra está em
-- `domain/notification-target.repository.ts` (`TIPOS_PADRAO` vale só para
-- destino NOVO). Consequência aceita e documentada: conta que já existe passa a
-- receber o aviso quando marcar o tipo em Configurações → Notificações; conta
-- nova já nasce com ele marcado. Por isso não há invariante nova em
-- `invariantes.sql`: sem backfill, não há dado novo a afirmar.

-- ===========================================================================
-- 1. O tipo novo
-- ===========================================================================
ALTER TYPE "NotificationType" ADD VALUE 'DEAL_STALE' AFTER 'FOLLOW_UP_DUE';

-- ===========================================================================
-- 2. Índice da varredura diária
-- ===========================================================================
-- O gatilho procura oportunidade fora da lixeira parada há mais de N dias:
-- `archivedAt IS NULL AND stageMovedAt < :limite`. Igualdade antes da faixa, no
-- molde de Task.[dueDate, status] da Fase 9 — sem ele, a rotina diária faz seq
-- scan em Deal a cada execução, cross-owner.
CREATE INDEX "Deal_archivedAt_stageMovedAt_idx" ON "Deal"("archivedAt", "stageMovedAt");
