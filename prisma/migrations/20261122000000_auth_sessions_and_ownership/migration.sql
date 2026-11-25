-- AlterTable: add auth timestamps to User
ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Delete orphaned investigations without an owner before enforcing NOT NULL
DELETE FROM "Investigation" WHERE "userId" IS NULL;

-- AlterTable: require Investigation.userId ownership
ALTER TABLE "Investigation"
  ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Investigation_userId_createdAt_idx" ON "Investigation"("userId", "createdAt");

-- CreateTable: server-side revocable user sessions
CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userAgent" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
