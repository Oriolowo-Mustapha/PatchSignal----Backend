-- AlterTable
ALTER TABLE "Investigation"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "candidateAreas" JSONB,
  ADD COLUMN "inspectionJson" JSONB;
