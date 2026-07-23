-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "dealId" TEXT;

-- CreateIndex
CREATE INDEX "Project_dealId_idx" ON "Project"("dealId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
