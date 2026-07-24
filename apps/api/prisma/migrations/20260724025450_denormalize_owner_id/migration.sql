-- Denormaliza ownerId nas tabelas filhas (defesa em profundidade p/ RLS).
-- Fluxo: coluna nullable -> backfill via join até Client -> NOT NULL -> índices.
-- (o Prisma gera ADD COLUMN ... NOT NULL direto, que falha em bancos com dados)

-- 1. AddColumn (nullable primeiro)
ALTER TABLE "Contact"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Deal"         ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Proposal"     ADD COLUMN "ownerId" TEXT;
ALTER TABLE "ProposalItem" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Project"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Task"         ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Contract"     ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Payment"      ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Activity"     ADD COLUMN "ownerId" TEXT;

-- 2. Backfill 1-hop (via clientId -> Client.ownerId)
UPDATE "Contact"  x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Deal"     x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Proposal" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Project"  x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Contract" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";
UPDATE "Activity" x SET "ownerId" = c."ownerId" FROM "Client" c WHERE x."clientId" = c."id";

-- 3. Backfill 2-hop
UPDATE "ProposalItem" x SET "ownerId" = p."ownerId" FROM "Proposal" p WHERE x."proposalId" = p."id";
UPDATE "Task"         x SET "ownerId" = pr."ownerId" FROM "Project" pr WHERE x."projectId" = pr."id";
UPDATE "Payment"      x SET "ownerId" = ct."ownerId" FROM "Contract" ct WHERE x."contractId" = ct."id";

-- 4. NOT NULL
ALTER TABLE "Contact"      ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Deal"         ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Proposal"     ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "ProposalItem" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Project"      ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Task"         ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Contract"     ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Payment"      ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Activity"     ALTER COLUMN "ownerId" SET NOT NULL;

-- 5. CreateIndex
CREATE INDEX "Contact_ownerId_idx"      ON "Contact"("ownerId");
CREATE INDEX "Deal_ownerId_idx"         ON "Deal"("ownerId");
CREATE INDEX "Proposal_ownerId_idx"     ON "Proposal"("ownerId");
CREATE INDEX "ProposalItem_ownerId_idx" ON "ProposalItem"("ownerId");
CREATE INDEX "Project_ownerId_idx"      ON "Project"("ownerId");
CREATE INDEX "Task_ownerId_idx"         ON "Task"("ownerId");
CREATE INDEX "Contract_ownerId_idx"     ON "Contract"("ownerId");
CREATE INDEX "Payment_ownerId_idx"      ON "Payment"("ownerId");
CREATE INDEX "Activity_ownerId_idx"     ON "Activity"("ownerId");
