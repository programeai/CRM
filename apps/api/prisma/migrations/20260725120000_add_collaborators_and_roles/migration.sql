-- Colaboradores e papéis (RBAC) preservando o isolamento por ownerId.
--
-- Notas de projeto:
--  * `User."ownerId"` NULL = owner (dono da workspace). Preenchido = colaborador
--    daquele owner — e é esse valor que vira `app.owner_id` nas policies de RLS.
--  * `User` continua FORA do RLS (login busca por e-mail): o isolamento dos
--    colaboradores é feito por filtro explícito de `ownerId` no repositório.
--  * `Role` e `CollaboratorInvite` entram no RLS, no mesmo molde de
--    20260724050000_enable_rls (USING == WITH CHECK, FORCE, fail-closed).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "roleId" TEXT;

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaboratorInvite" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollaboratorInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Role_ownerId_idx" ON "Role"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_ownerId_name_key" ON "Role"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CollaboratorInvite_tokenHash_key" ON "CollaboratorInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "CollaboratorInvite_userId_idx" ON "CollaboratorInvite"("userId");

-- CreateIndex
CREATE INDEX "CollaboratorInvite_ownerId_idx" ON "CollaboratorInvite"("ownerId");

-- CreateIndex
CREATE INDEX "User_ownerId_idx" ON "User"("ownerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaboratorInvite" ADD CONSTRAINT "CollaboratorInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Backfill: toda conta que já existe é owner (ownerId fica NULL, pelo default)
-- e já tem senha/OAuth ativos — logo, "convite aceito" desde a criação.
-- ===========================================================================
UPDATE "User" SET "acceptedAt" = "createdAt" WHERE "acceptedAt" IS NULL;

-- Papel "Administrador" (do sistema) para cada owner existente. `permissions`
-- fica vazio de propósito: papel `system` resolve para o catálogo INTEIRO em
-- tempo de execução (ver AccessService), então nunca fica desatualizado quando
-- uma permissão nova entra no catálogo.
INSERT INTO "Role" ("id", "ownerId", "name", "description", "system", "permissions", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", 'Administrador',
       'Acesso total ao CRM. Papel do sistema — não pode ser editado nem excluído.',
       true, ARRAY[]::TEXT[], now(), now()
  FROM "User" u
 WHERE u."ownerId" IS NULL;

-- ===========================================================================
-- RLS por ownerId nas tabelas novas
-- ===========================================================================

-- Role
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "Role"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- CollaboratorInvite
ALTER TABLE "CollaboratorInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollaboratorInvite" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "CollaboratorInvite"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- GRANTs explícitos para a role da aplicação. O ALTER DEFAULT PRIVILEGES de
-- 20260724040000_create_app_role já cobriria as tabelas novas; repetimos aqui
-- para a migration ser autossuficiente em bancos provisionados à mão.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Role", "CollaboratorInvite" TO crm_app;
