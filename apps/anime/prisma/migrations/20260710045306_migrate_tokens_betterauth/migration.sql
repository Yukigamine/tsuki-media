/*
  Warnings:

  - You are about to drop the `AuthToken` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "AuthToken";

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");
