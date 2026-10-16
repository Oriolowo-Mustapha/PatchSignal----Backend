CREATE TABLE "AnalysisJob" (
 "id" TEXT NOT NULL, "investigationId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued', "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AnalysisJob_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AnalysisJob_investigationId_key" ON "AnalysisJob"("investigationId");
CREATE INDEX "AnalysisJob_status_createdAt_idx" ON "AnalysisJob"("status", "createdAt");
