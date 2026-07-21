-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "city" TEXT,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "zipCode" TEXT;

-- CreateIndex
CREATE INDEX "Client_ownerId_status_idx" ON "Client"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Client_ownerId_archivedAt_idx" ON "Client"("ownerId", "archivedAt");
