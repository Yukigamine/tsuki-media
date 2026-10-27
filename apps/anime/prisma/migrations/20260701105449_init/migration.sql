-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('WATCHING', 'PLAN_TO_WATCH', 'COMPLETED', 'ON_HOLD', 'DROPPED');

-- CreateEnum
CREATE TYPE "ReadStatus" AS ENUM ('READING', 'PLAN_TO_READ', 'COMPLETED', 'ON_HOLD', 'DROPPED');

-- CreateEnum
CREATE TYPE "ShowStatus" AS ENUM ('AIRING', 'FINISHED', 'UPCOMING', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('KITSU', 'ANILIST');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PULL', 'PUSH');

-- CreateEnum
CREATE TYPE "MediaFormat" AS ENUM ('DVD', 'BLU_RAY', 'VHS', 'DIGITAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CollectionCondition" AS ENUM ('MINT', 'NEAR_MINT', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "CollectionRarity" AS ENUM ('STEELBOOK', 'DELUXE', 'LIMITED', 'COLLECTORS', 'STANDARD');

-- CreateEnum
CREATE TYPE "MangaLanguage" AS ENUM ('ENGLISH', 'JAPANESE', 'OTHER');

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "providerUserId" TEXT,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "animeSynced" INTEGER NOT NULL DEFAULT 0,
    "mangaSynced" INTEGER NOT NULL DEFAULT 0,
    "animeChanged" INTEGER NOT NULL DEFAULT 0,
    "mangaChanged" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "deletions" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anime" (
    "id" TEXT NOT NULL,
    "kitsuId" TEXT,
    "anilistId" INTEGER,
    "malId" INTEGER,
    "titleEn" TEXT,
    "titleJp" TEXT,
    "titleRomaji" TEXT,
    "synopsis" TEXT,
    "coverImageUrl" TEXT,
    "bannerImageUrl" TEXT,
    "episodeCount" INTEGER,
    "showStatus" "ShowStatus" NOT NULL DEFAULT 'UNKNOWN',
    "averageRating" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Anime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimeListEntry" (
    "id" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "watchStatus" "WatchStatus" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "notes" TEXT,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "rewatchCount" INTEGER NOT NULL DEFAULT 0,
    "rewatching" BOOLEAN NOT NULL DEFAULT false,
    "kitsuEntryId" TEXT,
    "anilistEntryId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "AnimeListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimeCollectionItem" (
    "id" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "rarity" "CollectionRarity" NOT NULL DEFAULT 'STANDARD',
    "format" "MediaFormat" NOT NULL DEFAULT 'BLU_RAY',
    "condition" "CollectionCondition" NOT NULL DEFAULT 'GOOD',
    "notes" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "pricePaid" DOUBLE PRECISION,
    "barcode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimeCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manga" (
    "id" TEXT NOT NULL,
    "kitsuId" TEXT,
    "anilistId" INTEGER,
    "malId" INTEGER,
    "titleEn" TEXT,
    "titleJp" TEXT,
    "titleRomaji" TEXT,
    "synopsis" TEXT,
    "coverImageUrl" TEXT,
    "chapterCount" INTEGER,
    "volumeCount" INTEGER,
    "showStatus" "ShowStatus" NOT NULL DEFAULT 'UNKNOWN',
    "averageRating" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MangaListEntry" (
    "id" TEXT NOT NULL,
    "mangaId" TEXT NOT NULL,
    "readStatus" "ReadStatus" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressVolumes" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "notes" TEXT,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "rereadCount" INTEGER NOT NULL DEFAULT 0,
    "rereading" BOOLEAN NOT NULL DEFAULT false,
    "kitsuEntryId" TEXT,
    "anilistEntryId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "MangaListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MangaCollectionItem" (
    "id" TEXT NOT NULL,
    "mangaId" TEXT NOT NULL,
    "condition" "CollectionCondition" NOT NULL DEFAULT 'GOOD',
    "language" "MangaLanguage" NOT NULL DEFAULT 'ENGLISH',
    "notes" TEXT,
    "containsSerialized" BOOLEAN NOT NULL DEFAULT false,
    "containsOmnibus" BOOLEAN NOT NULL DEFAULT false,
    "volumes" INTEGER[],
    "chapters" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MangaCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_provider_key" ON "AuthToken"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Anime_kitsuId_key" ON "Anime"("kitsuId");

-- CreateIndex
CREATE UNIQUE INDEX "Anime_anilistId_key" ON "Anime"("anilistId");

-- CreateIndex
CREATE UNIQUE INDEX "Anime_malId_key" ON "Anime"("malId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimeListEntry_animeId_key" ON "AnimeListEntry"("animeId");

-- CreateIndex
CREATE UNIQUE INDEX "Manga_kitsuId_key" ON "Manga"("kitsuId");

-- CreateIndex
CREATE UNIQUE INDEX "Manga_anilistId_key" ON "Manga"("anilistId");

-- CreateIndex
CREATE UNIQUE INDEX "Manga_malId_key" ON "Manga"("malId");

-- CreateIndex
CREATE UNIQUE INDEX "MangaListEntry_mangaId_key" ON "MangaListEntry"("mangaId");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimeListEntry" ADD CONSTRAINT "AnimeListEntry_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimeCollectionItem" ADD CONSTRAINT "AnimeCollectionItem_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MangaListEntry" ADD CONSTRAINT "MangaListEntry_mangaId_fkey" FOREIGN KEY ("mangaId") REFERENCES "Manga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MangaCollectionItem" ADD CONSTRAINT "MangaCollectionItem_mangaId_fkey" FOREIGN KEY ("mangaId") REFERENCES "Manga"("id") ON DELETE CASCADE ON UPDATE CASCADE;
