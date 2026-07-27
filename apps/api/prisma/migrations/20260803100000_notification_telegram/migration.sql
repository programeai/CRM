-- Canal TELEGRAM: um valor novo no enum de destino.
--
-- Notas de projeto:
--  * Mesmo caso do 'DISCORD' em 20260802100000_notification_discord:
--    `ALTER TYPE ... ADD VALUE` roda dentro de transação no PG 12+ desde que o
--    valor novo não seja USADO na mesma transação. Aqui só é declarado.
--  * NÃO TEM ROLLBACK: valor de enum não se remove no Postgres. É aditivo e
--    inofensivo — nenhuma linha usa 'TELEGRAM' antes de existir um destino.
--  * Nenhuma tabela, índice ou policy muda: o destino é uma LINHA em
--    UserNotificationTarget, que já tem RLS. A `config` continua `{ url }` — no
--    Telegram a URL carrega o token no path e o chat_id na query, montada pelo
--    front, então o formato guardado não muda.
--  * Roda como crm_user (superuser), que bypassa RLS.

ALTER TYPE "NotificationChannelKind" ADD VALUE 'TELEGRAM';
