-- Canal DISCORD: um valor novo no enum de destino.
--
-- Notas de projeto:
--  * `ALTER TYPE ... ADD VALUE` roda dentro de transação no PG 12+ desde que o
--    valor novo não seja USADO na mesma transação. Aqui só é declarado — quem
--    usa é o app, depois do deploy.
--  * NÃO TEM ROLLBACK: valor de enum não se remove no Postgres. É aditivo e
--    inofensivo (nenhuma linha usa 'DISCORD' antes de existir um destino), mas é
--    o único passo irreversível desta mudança — o mesmo caso do 'ACTIVITY' em
--    20260731100000_notifications.
--  * Nenhuma tabela, índice ou policy muda: o destino Discord é uma LINHA em
--    UserNotificationTarget, que já tem RLS.
--  * Roda como crm_user (superuser), que bypassa RLS.

ALTER TYPE "NotificationChannelKind" ADD VALUE 'DISCORD';
