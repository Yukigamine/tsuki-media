-- AlterTable
ALTER TABLE "user"
ADD COLUMN "username" TEXT,
ADD COLUMN "displayUsername" TEXT,
ADD COLUMN "master" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "setupComplete" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL DEFAULT '',
    "kitsuUsername" TEXT NOT NULL DEFAULT '',
    "anilistUsername" TEXT NOT NULL DEFAULT '',
    "authProvider" TEXT NOT NULL DEFAULT '',
    "masterEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_master_key" ON "user"("master");
