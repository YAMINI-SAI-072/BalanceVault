/*
  Warnings:

  - Added the required column `requestHash` to the `IdempotencyKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `IdempotencyKey` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IdempotencyKey" ADD COLUMN     "requestHash" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "IdempotencyKey_userId_createdAt_idx" ON "IdempotencyKey"("userId", "createdAt");
