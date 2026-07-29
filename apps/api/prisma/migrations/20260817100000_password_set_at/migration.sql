-- Separa "existe hash guardado" de "o titular escolheu uma senha".
--
-- A partir daqui a conta criada por OAuth nasce com uma senha ALEATÓRIA (ver
-- UsersService.createWithOAuth), para que `POST /auth/forgot-password` funcione
-- nela sem caso especial. Como consequência, `passwordHash IS NOT NULL` deixa de
-- significar "sabe uma senha" — quem responde isso passa a ser `passwordSetAt`.
ALTER TABLE "User" ADD COLUMN "passwordSetAt" TIMESTAMP(3);

-- Backfill: todo mundo que HOJE tem hash o tem porque digitou uma senha (o
-- cadastro por e-mail ou o aceite de convite) — a senha aleatória do OAuth ainda
-- não existia. `createdAt` é a melhor aproximação disponível do momento.
-- Sem esta linha, toda conta existente passaria a ser tratada como só-OAuth: o
-- diálogo de encerramento pediria o e-mail em vez da senha e o `/auth/me`
-- devolveria `hasPassword: false` para quem tem senha.
UPDATE "User" SET "passwordSetAt" = "createdAt" WHERE "passwordHash" IS NOT NULL;
