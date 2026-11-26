import "server-only";
import { ReadStatus, ShowStatus, WatchStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { getToken } from "@/lib/provider-links";
import {
  invalidateAnimeTitleCache,
  invalidateMangaTitleCache,
} from "@/lib/redis";
import { getSettings } from "@/lib/settings";
import {
  selectTitleFromAniList,
  validateAnimeListEntry,
  validateMangaListEntry,
  validateMediaRecord,
} from "@/lib/validation";
import {
  type GraphQLTypes,
  MediaListStatus,
  MediaStatus,
} from "@/lib/zeus/anilist";
import { anilistThunder } from "./thunder";

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const msg = error.message;

  // Extract just the first meaningful line
  const lines = msg.split("\n").filter((line) => line.trim());
  let errorMsg = lines[0] || msg;

  // For Prisma "Invalid invocation" errors, extract the operation name
  if (errorMsg?.includes("Invalid")) {
    const match = errorMsg.match(/Invalid `(?:prisma\.)?(.+?)`/);
    if (match) {
      const operation = match[1].split(".").pop();
      return `Invalid ${operation}`;
    }
  }

  // Truncate if too long
  if (errorMsg.length > 100) {
    errorMsg = `${errorMsg.substring(0, 97)}...`;
  }

  return errorMsg || "Unknown error";
}

// ---------------------------------------------------------------------------
// Rating conversion: DB uses 0-20 scale (matching Kitsu), AniList uses 0-10
// ---------------------------------------------------------------------------

function toAniListRating(dbRating: number | null): number {
  // Convert from DB 0-20 scale to AniList 0-10 scale
  return dbRating != null ? Math.round((dbRating / 20) * 10 * 10) / 10 : 0;
}

function fromAniListRating(
  anilistRating: number | null | undefined,
): number | null {
  // Convert from AniList 0-10 scale to DB 0-20 scale
  return anilistRating != null && anilistRating > 0
    ? Math.round((anilistRating / 10) * 20 * 10) / 10
    : null;
}

// ---------------------------------------------------------------------------
// Typed query helper — return type is inferred by TypeScript, no assertions.
// ---------------------------------------------------------------------------

function fetchAniListPage(
  username: string,
  type: GraphQLTypes["MediaType"],
  page: number,
) {
  return anilistThunder("query")({
    Page: [
      { page, perPage: 50 },
      {
        pageInfo: { hasNextPage: true, currentPage: true },
        mediaList: [
          {
            userName: username,
            type,
            sort: ["UPDATED_TIME_DESC" as GraphQLTypes["MediaListSort"]],
          },
          {
            id: true,
            status: true,
            progress: true,
            progressVolumes: true,
            score: [
              { format: "POINT_10_DECIMAL" as GraphQLTypes["ScoreFormat"] },
              true,
            ],
            notes: true,
            repeat: true,
            private: true,
            startedAt: { year: true, month: true, day: true },
            completedAt: { year: true, month: true, day: true },
            updatedAt: true,
            media: {
              id: true,
              idMal: true,
              title: {
                english: [{}, true],
                romaji: [{}, true],
                native: [{}, true],
              },
              description: [{ asHtml: false }, true],
              episodes: true,
              chapters: true,
              volumes: true,
              status: [{}, true],
              coverImage: { large: true, medium: true },
              bannerImage: true,
              averageScore: true,
              startDate: { year: true, month: true, day: true },
              endDate: { year: true, month: true, day: true },
            },
          },
        ],
      },
    ],
  });
}

type AniListPageResult = Awaited<ReturnType<typeof fetchAniListPage>>;
type AniListPageData = NonNullable<AniListPageResult["Page"]>;
type AniListListItem = NonNullable<AniListPageData["mediaList"]>[number];
type AniListMediaItem = NonNullable<AniListListItem["media"]>;
type FuzzyDate =
  | { year?: number | null; month?: number | null; day?: number | null }
  | null
  | undefined;

// ---------------------------------------------------------------------------
// Status mappers
// ---------------------------------------------------------------------------

function mapWatchStatus(s: MediaListStatus | null | undefined): WatchStatus {
  switch (s) {
    case MediaListStatus.CURRENT:
    case MediaListStatus.REPEATING:
      return WatchStatus.WATCHING;
    case MediaListStatus.PLANNING:
      return WatchStatus.PLAN_TO_WATCH;
    case MediaListStatus.COMPLETED:
      return WatchStatus.COMPLETED;
    case MediaListStatus.PAUSED:
      return WatchStatus.ON_HOLD;
    case MediaListStatus.DROPPED:
      return WatchStatus.DROPPED;
    default:
      return WatchStatus.PLAN_TO_WATCH;
  }
}

function mapReadStatus(s: MediaListStatus | null | undefined): ReadStatus {
  switch (s) {
    case MediaListStatus.CURRENT:
    case MediaListStatus.REPEATING:
      return ReadStatus.READING;
    case MediaListStatus.PLANNING:
      return ReadStatus.PLAN_TO_READ;
    case MediaListStatus.COMPLETED:
      return ReadStatus.COMPLETED;
    case MediaListStatus.PAUSED:
      return ReadStatus.ON_HOLD;
    case MediaListStatus.DROPPED:
      return ReadStatus.DROPPED;
    default:
      return ReadStatus.PLAN_TO_READ;
  }
}

function mapShowStatus(s: MediaStatus | null | undefined): ShowStatus {
  switch (s) {
    case MediaStatus.FINISHED:
      return ShowStatus.FINISHED;
    case MediaStatus.RELEASING:
      return ShowStatus.AIRING;
    case MediaStatus.NOT_YET_RELEASED:
      return ShowStatus.UPCOMING;
    case MediaStatus.CANCELLED:
      return ShowStatus.CANCELLED;
    case MediaStatus.HIATUS:
      return ShowStatus.UNKNOWN;
    default:
      return ShowStatus.UNKNOWN;
  }
}

function fuzzyToDate(fd: FuzzyDate): Date | null {
  if (!fd?.year) return null;
  return new Date(fd.year, (fd.month ?? 1) - 1, fd.day ?? 1);
}

function reverseWatchStatus(s: WatchStatus): MediaListStatus {
  switch (s) {
    case WatchStatus.WATCHING:
      return MediaListStatus.CURRENT;
    case WatchStatus.PLAN_TO_WATCH:
      return MediaListStatus.PLANNING;
    case WatchStatus.COMPLETED:
      return MediaListStatus.COMPLETED;
    case WatchStatus.ON_HOLD:
      return MediaListStatus.PAUSED;
    case WatchStatus.DROPPED:
      return MediaListStatus.DROPPED;
  }
}

function reverseReadStatus(s: ReadStatus): MediaListStatus {
  switch (s) {
    case ReadStatus.READING:
      return MediaListStatus.CURRENT;
    case ReadStatus.PLAN_TO_READ:
      return MediaListStatus.PLANNING;
    case ReadStatus.COMPLETED:
      return MediaListStatus.COMPLETED;
    case ReadStatus.ON_HOLD:
      return MediaListStatus.PAUSED;
    case ReadStatus.DROPPED:
      return MediaListStatus.DROPPED;
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function buildMediaCommon(media: AniListMediaItem) {
  const { title } = selectTitleFromAniList(
    media.title?.english,
    media.title?.romaji,
    media.title?.native,
  );
  return {
    titleEn: title,
    titleJp: media.title?.native ?? null,
    titleRomaji: media.title?.romaji ?? null,
    synopsis: media.description ?? null,
    coverImageUrl: media.coverImage?.large ?? media.coverImage?.medium ?? null,
    showStatus: mapShowStatus(media.status),
    averageRating: media.averageScore ? media.averageScore / 10 : null,
    startDate: fuzzyToDate(media.startDate),
    endDate: fuzzyToDate(media.endDate),
  };
}

function buildInvalidMediaContext(
  media: AniListListItem["media"],
  item: AniListListItem,
): string {
  if (!media) return `[no media]`;
  const parts: string[] = [];

  // Add available title
  if (media.title?.romaji) parts.push(`"${media.title.romaji}"`);
  if (media.title?.native) parts.push(`"${media.title.native}"`);

  // Add IDs
  if (media.id) parts.push(`AL:${media.id}`);
  if (media.idMal) parts.push(`MAL:${media.idMal}`);

  // Add current status on list
  if (item.status) parts.push(`status:${item.status}`);
  if (item.progress !== null && item.progress !== undefined)
    parts.push(`progress:${item.progress}`);

  return parts.length > 0 ? parts.join(", ") : "[no details]";
}

async function pullAnimeItem(item: AniListListItem): Promise<boolean> {
  const media = item.media;
  if (!media) return false;

  // Resolve title with fallback chain
  const { title: resolvedTitle, fallbackUsed } = selectTitleFromAniList(
    media.title?.english,
    media.title?.romaji,
    media.title?.native,
  );

  // Validate media data before processing
  const mediaIssues = validateMediaRecord({
    anilistId: media.id,
    malId: media.idMal,
    titleEn: resolvedTitle,
  });
  if (mediaIssues.length > 0) {
    console.warn(
      `[AniList Pull] Skipping invalid anime (${mediaIssues.join(", ")}): ${buildInvalidMediaContext(media, item)}`,
    );
    return false;
  }

  const common = buildMediaCommon(media);
  const score = item.score ?? 0;
  const dbRating = fromAniListRating(score);

  // Validate entry data (using converted DB rating for 0-20 scale)
  const entryIssues = validateAnimeListEntry({
    progress: item.progress ?? 0,
    rating: dbRating,
    rewatchCount: item.repeat ?? 0,
  });
  if (entryIssues.length > 0) {
    console.warn(
      `[AniList Pull] Skipping invalid anime entry (${entryIssues.join(", ")}): ${buildInvalidMediaContext(media, item)}`,
    );
    return false;
  }

  const anilistUpdatedAt = item.updatedAt
    ? new Date((item.updatedAt as number) * 1000)
    : new Date();

  let animeRecord = await prisma.anime.findUnique({
    where: { anilistId: media.id },
  });
  if (!animeRecord && media.idMal)
    animeRecord = await prisma.anime.findUnique({
      where: { malId: media.idMal },
    });

  if (animeRecord) {
    // For existing anime: only update episode count (Kitsu is primary source for details)
    // Update episodeCount if AniList has a higher count (for clamping logic edge cases)
    if ((media.episodes ?? 0) > (animeRecord.episodeCount ?? 0)) {
      animeRecord = await prisma.anime.update({
        where: { id: animeRecord.id },
        data: { episodeCount: media.episodes ?? null },
      });
      await invalidateAnimeTitleCache(animeRecord.id, animeRecord.kitsuId);
    }
  } else {
    // For new anime: pull all details and let Kitsu overwrite if there are mismatches
    const sharedMedia = {
      anilistId: media.id,
      ...(media.idMal ? { malId: media.idMal } : {}),
      ...common,
      bannerImageUrl: media.bannerImage ?? null,
      episodeCount: media.episodes ?? null,
    };
    animeRecord = await prisma.anime.create({ data: sharedMedia });
    if (fallbackUsed === "romaji") {
      console.info(
        `[AniList Pull] Using Romaji title for new anime (English missing): "${resolvedTitle}" (AL:${media.id})`,
      );
    } else if (fallbackUsed === "native") {
      console.info(
        `[AniList Pull] Using Native title for new anime (English & Romaji missing): "${resolvedTitle}" (AL:${media.id})`,
      );
    } else if (fallbackUsed === "missing_all") {
      console.warn(
        `[AniList Pull] No title available for new anime (AL:${media.id})`,
      );
    }
  }

  const existing = await prisma.animeListEntry.findUnique({
    where: { animeId: animeRecord.id },
  });

  // Only use AniList rating if no local rating exists (Kitsu is primary source with finer granularity)
  const rating = existing?.rating ?? dbRating;

  const isNewer = !existing?.updatedAt || anilistUpdatedAt > existing.updatedAt;

  if (isNewer) {
    const entryData = {
      anilistEntryId: item.id,
      watchStatus: mapWatchStatus(item.status),
      progress: item.progress ?? 0,
      rating: rating,
      notes: item.notes ?? null,
      private: item.private ?? false,
      rewatching: item.status === MediaListStatus.REPEATING,
      rewatchCount: item.repeat ?? 0,
      startedAt: fuzzyToDate(item.startedAt),
      completedAt: fuzzyToDate(item.completedAt),
      updatedAt: anilistUpdatedAt,
    };

    await prisma.animeListEntry.upsert({
      where: { animeId: animeRecord.id },
      create: { animeId: animeRecord.id, ...entryData },
      update: entryData,
    });

    if (!existing) return false;

    return (
      existing.watchStatus !== entryData.watchStatus ||
      existing.progress !== entryData.progress ||
      existing.rating !== entryData.rating ||
      existing.notes !== entryData.notes ||
      existing.rewatchCount !== entryData.rewatchCount ||
      existing.rewatching !== entryData.rewatching
    );
  }

  // Not newer — only update the entry ID so push still works
  if (existing) {
    await prisma.animeListEntry.update({
      where: { animeId: animeRecord.id },
      data: { anilistEntryId: item.id },
    });
  }
  return false;
}

async function pullMangaItem(item: AniListListItem): Promise<boolean> {
  const media = item.media;
  if (!media) return false;

  // Resolve title with fallback chain
  const { title: resolvedTitle, fallbackUsed } = selectTitleFromAniList(
    media.title?.english,
    media.title?.romaji,
    media.title?.native,
  );

  // Validate media data before processing
  const mediaIssues = validateMediaRecord({
    anilistId: media.id,
    malId: media.idMal,
    titleEn: resolvedTitle,
  });
  if (mediaIssues.length > 0) {
    console.warn(
      `[AniList Pull] Skipping invalid manga (${mediaIssues.join(", ")}): ${buildInvalidMediaContext(media, item)}`,
    );
    return false;
  }

  const common = buildMediaCommon(media);
  const score = item.score ?? 0;
  const dbRating = fromAniListRating(score);

  // Validate entry data (using converted DB rating for 0-20 scale)
  const entryIssues = validateMangaListEntry({
    progress: item.progress ?? 0,
    progressVolumes: item.progressVolumes ?? 0,
    rating: dbRating,
    rereadCount: item.repeat ?? 0,
  });
  if (entryIssues.length > 0) {
    console.warn(
      `[AniList Pull] Skipping invalid manga entry (${entryIssues.join(", ")}): ${buildInvalidMediaContext(media, item)}`,
    );
    return false;
  }

  const anilistUpdatedAt = item.updatedAt
    ? new Date((item.updatedAt as number) * 1000)
    : new Date();

  let mangaRecord = await prisma.manga.findUnique({
    where: { anilistId: media.id },
  });
  if (!mangaRecord && media.idMal)
    mangaRecord = await prisma.manga.findUnique({
      where: { malId: media.idMal },
    });

  if (mangaRecord) {
    // For existing manga: only update chapter/volume counts (Kitsu is primary source for details)
    // Update if AniList has higher counts (for clamping logic edge cases)
    const updates: Record<string, number | null> = {};
    if ((media.chapters ?? 0) > (mangaRecord.chapterCount ?? 0)) {
      updates.chapterCount = media.chapters ?? null;
    }
    if ((media.volumes ?? 0) > (mangaRecord.volumeCount ?? 0)) {
      updates.volumeCount = media.volumes ?? null;
    }
    if (Object.keys(updates).length > 0) {
      mangaRecord = await prisma.manga.update({
        where: { id: mangaRecord.id },
        data: updates,
      });
      await invalidateMangaTitleCache(mangaRecord.id, mangaRecord.kitsuId);
    }
  } else {
    // For new manga: pull all details and let Kitsu overwrite if there are mismatches
    const sharedMedia = {
      anilistId: media.id,
      ...(media.idMal ? { malId: media.idMal } : {}),
      ...common,
      chapterCount: media.chapters ?? null,
      volumeCount: media.volumes ?? null,
    };
    mangaRecord = await prisma.manga.create({ data: sharedMedia });
    if (fallbackUsed === "romaji") {
      console.info(
        `[AniList Pull] Using Romaji title for new manga (English missing): "${resolvedTitle}" (AL:${media.id})`,
      );
    } else if (fallbackUsed === "native") {
      console.info(
        `[AniList Pull] Using Native title for new manga (English & Romaji missing): "${resolvedTitle}" (AL:${media.id})`,
      );
    } else if (fallbackUsed === "missing_all") {
      console.warn(
        `[AniList Pull] No title available for new manga (AL:${media.id})`,
      );
    }
  }

  const existing = await prisma.mangaListEntry.findUnique({
    where: { mangaId: mangaRecord.id },
  });

  // Only use AniList rating if no local rating exists (Kitsu is primary source with finer granularity)
  const rating = existing?.rating ?? dbRating;

  const isNewer = !existing?.updatedAt || anilistUpdatedAt > existing.updatedAt;

  if (isNewer) {
    const entryData = {
      anilistEntryId: item.id,
      readStatus: mapReadStatus(item.status),
      progress: item.progress ?? 0,
      progressVolumes: item.progressVolumes ?? 0,
      rating: rating,
      notes: item.notes ?? null,
      private: item.private ?? false,
      rereading: item.status === MediaListStatus.REPEATING,
      rereadCount: item.repeat ?? 0,
      startedAt: fuzzyToDate(item.startedAt),
      completedAt: fuzzyToDate(item.completedAt),
      updatedAt: anilistUpdatedAt,
    };

    await prisma.mangaListEntry.upsert({
      where: { mangaId: mangaRecord.id },
      create: { mangaId: mangaRecord.id, ...entryData },
      update: entryData,
    });

    if (!existing) return false;

    return (
      existing.readStatus !== entryData.readStatus ||
      existing.progress !== entryData.progress ||
      existing.rating !== entryData.rating ||
      existing.notes !== entryData.notes ||
      existing.rereadCount !== entryData.rereadCount ||
      existing.rereading !== entryData.rereading
    );
  }

  // Not newer — only update the entry ID so push still works
  if (existing) {
    await prisma.mangaListEntry.update({
      where: { mangaId: mangaRecord.id },
      data: { anilistEntryId: item.id },
    });
  }
  return false;
}

// ---------------------------------------------------------------------------
// Exported sync functions
// ---------------------------------------------------------------------------

export async function pullAniList(logId: string): Promise<void> {
  const [tokenInfo, settings] = await Promise.all([
    getToken("ANILIST"),
    getSettings(),
  ]);
  const username = tokenInfo?.username ?? settings.anilistUsername;

  if (!username) throw new Error("No AniList username configured");

  const errors: string[] = [];
  let animeSynced = 0;
  let animeChanged = 0;
  let mangaSynced = 0;
  let mangaChanged = 0;

  for (const type of ["ANIME", "MANGA"] as const) {
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      const result = await fetchAniListPage(
        username,
        type as GraphQLTypes["MediaType"],
        page,
      );
      const pageData = result.Page;
      if (!pageData) break;

      for (const item of pageData.mediaList ?? []) {
        try {
          if (type === "ANIME") {
            const wasChanged = await pullAnimeItem(item);
            animeSynced++;
            if (wasChanged) animeChanged++;
          } else {
            const wasChanged = await pullMangaItem(item);
            mangaSynced++;
            if (wasChanged) mangaChanged++;
          }
        } catch (e) {
          const fullMsg = e instanceof Error ? e.message : String(e);
          const shortMsg = extractErrorMessage(e);
          console.error(
            `Failed to pull ${type.toLowerCase()} ${item.media?.id}:`,
            fullMsg,
          );
          errors.push(`${type.toLowerCase()} ${item.media?.id}: ${shortMsg}`);
        }
      }

      hasNext = pageData.pageInfo?.hasNextPage ?? false;
      page++;
    }
  }

  const total = animeSynced + mangaSynced;
  const changed = animeChanged + mangaChanged;
  console.log(
    `[AniList Pull] Synced ${total} entries (${changed} changed): ${animeSynced} anime, ${mangaSynced} manga`,
  );

  await prisma.syncLog.update({
    where: { id: logId },
    data: {
      status: errors.length ? "FAILED" : "COMPLETED",
      animeSynced,
      mangaSynced,
      animeChanged,
      mangaChanged,
      errors,
      finishedAt: new Date(),
    },
  });
}

type AniListRemoteEntry = {
  entryId: number;
  title: string;
  status: AniListListItem["status"];
  progress: number | null | undefined;
  progressVolumes: number | null | undefined;
  score: number | null | undefined;
  notes: string | null | undefined;
  repeat: number | null | undefined;
  private: boolean | null | undefined;
  malId: number | null | undefined;
  episodes: number | null | undefined;
  chapters: number | null | undefined;
};

async function scanAniListEntries(
  username: string,
  type: GraphQLTypes["MediaType"],
): Promise<Map<number, AniListRemoteEntry>> {
  const map = new Map<number, AniListRemoteEntry>();
  let page = 1;
  let hasNext = true;
  while (hasNext) {
    const result = await fetchAniListPage(username, type, page);
    const pageData = result.Page;
    if (!pageData) break;
    for (const item of pageData.mediaList ?? []) {
      if (item.id == null || item.media?.id == null) continue;
      map.set(item.media.id, {
        entryId: item.id,
        title:
          item.media.title?.english ??
          item.media.title?.romaji ??
          String(item.media.id),
        status: item.status,
        progress: item.progress,
        progressVolumes: item.progressVolumes,
        score: item.score,
        notes: item.notes,
        repeat: item.repeat,
        private: item.private,
        malId: item.media?.idMal,
        episodes: item.media?.episodes,
        chapters: item.media?.chapters,
      });
    }
    hasNext = pageData.pageInfo?.hasNextPage ?? false;
    page++;
  }
  return map;
}

function anilistAnimeNeedsUpdate(
  local: {
    title?: string | null;
    watchStatus: WatchStatus;
    progress: number;
    rating: number | null;
    notes: string | null;
    rewatchCount: number;
    private: boolean;
  },
  remote: AniListRemoteEntry,
): boolean {
  // Compare in AniList scale using truncation to avoid round-trip precision churn.
  const localRatingAniList =
    local.rating != null ? Math.trunc(local.rating / 2) : 0;
  const remoteRatingAniList = Math.trunc(remote.score ?? 0);
  const statusDiff = mapWatchStatus(remote.status) !== local.watchStatus;
  // AniList auto-sets progress = episode count on completion, so comparing progress when both
  // sides are COMPLETED causes endless update loops when local episode count differs from AniList.
  const bothCompleted =
    !statusDiff && local.watchStatus === WatchStatus.COMPLETED;
  const progressDiff =
    !bothCompleted && (remote.progress ?? 0) !== local.progress;
  const ratingDiff = localRatingAniList !== remoteRatingAniList;
  const notesDiff = (remote.notes || null) !== (local.notes || null);
  const repeatDiff = (remote.repeat ?? 0) !== local.rewatchCount;
  const privateDiff = (remote.private ?? false) !== local.private;

  const needsUpdate =
    statusDiff ||
    progressDiff ||
    ratingDiff ||
    notesDiff ||
    repeatDiff ||
    privateDiff;

  if (needsUpdate) {
    const label = local.title ?? "(untitled anime)";
    const diffs: string[] = [];
    if (statusDiff)
      diffs.push(
        `status local=${local.watchStatus} remote=${mapWatchStatus(remote.status)}`,
      );
    if (progressDiff)
      diffs.push(
        `progress local=${local.progress} remote=${remote.progress ?? 0}`,
      );
    if (ratingDiff)
      diffs.push(
        `rating local20=${local.rating ?? 0} local10trunc=${localRatingAniList} remote10trunc=${remoteRatingAniList}`,
      );
    if (notesDiff)
      diffs.push(
        `notes local=${JSON.stringify(local.notes)} remote=${JSON.stringify(remote.notes || null)}`,
      );
    if (repeatDiff)
      diffs.push(
        `repeat local=${local.rewatchCount} remote=${remote.repeat ?? 0}`,
      );
    if (privateDiff)
      diffs.push(
        `private local=${local.private} remote=${remote.private ?? false}`,
      );
    console.info(`[AniList Push Diff] anime "${label}": ${diffs.join(" | ")}`);
  }

  return needsUpdate;
}

function anilistMangaNeedsUpdate(
  local: {
    title?: string | null;
    readStatus: ReadStatus;
    progress: number;
    progressVolumes: number;
    rating: number | null;
    notes: string | null;
    rereadCount: number;
    private: boolean;
  },
  remote: AniListRemoteEntry,
): boolean {
  // Compare in AniList scale using truncation to avoid round-trip precision churn.
  const localRatingAniList =
    local.rating != null ? Math.trunc(local.rating / 2) : 0;
  const remoteRatingAniList = Math.trunc(remote.score ?? 0);
  const statusDiff = mapReadStatus(remote.status) !== local.readStatus;
  // AniList auto-sets progress = chapter count on completion, so comparing progress when both
  // sides are COMPLETED causes endless update loops when local chapter count differs from AniList.
  const bothCompleted =
    !statusDiff && local.readStatus === ReadStatus.COMPLETED;
  const progressDiff =
    !bothCompleted && (remote.progress ?? 0) !== local.progress;
  const progressVolumesDiff =
    !bothCompleted && (remote.progressVolumes ?? 0) !== local.progressVolumes;
  const ratingDiff = localRatingAniList !== remoteRatingAniList;
  const notesDiff = (remote.notes || null) !== (local.notes || null);
  const repeatDiff = (remote.repeat ?? 0) !== local.rereadCount;
  const privateDiff = (remote.private ?? false) !== local.private;

  const needsUpdate =
    statusDiff ||
    progressDiff ||
    progressVolumesDiff ||
    ratingDiff ||
    notesDiff ||
    repeatDiff ||
    privateDiff;

  if (needsUpdate) {
    const label = local.title ?? "(untitled manga)";
    const diffs: string[] = [];
    if (statusDiff)
      diffs.push(
        `status local=${local.readStatus} remote=${mapReadStatus(remote.status)}`,
      );
    if (progressDiff)
      diffs.push(
        `progress local=${local.progress} remote=${remote.progress ?? 0}`,
      );
    if (progressVolumesDiff)
      diffs.push(
        `progressVolumes local=${local.progressVolumes} remote=${remote.progressVolumes ?? 0}`,
      );
    if (ratingDiff)
      diffs.push(
        `rating local20=${local.rating ?? 0} local10trunc=${localRatingAniList} remote10trunc=${remoteRatingAniList}`,
      );
    if (notesDiff)
      diffs.push(
        `notes local=${JSON.stringify(local.notes)} remote=${JSON.stringify(remote.notes || null)}`,
      );
    if (repeatDiff)
      diffs.push(
        `repeat local=${local.rereadCount} remote=${remote.repeat ?? 0}`,
      );
    if (privateDiff)
      diffs.push(
        `private local=${local.private} remote=${remote.private ?? false}`,
      );
    console.info(`[AniList Push Diff] manga "${label}": ${diffs.join(" | ")}`);
  }

  return needsUpdate;
}

// ---------------------------------------------------------------------------
// Helper to lookup media by malId and return correct mediaId
// ---------------------------------------------------------------------------

async function getMediaIdByMalId(
  malId: number,
  type: "ANIME" | "MANGA",
  accessToken: string,
): Promise<number | null> {
  try {
    const query = `
      query GetMediaByMalId($malId: Int, $type: MediaType) {
        Media(idMal: $malId, type: $type) {
          id
        }
      }
    `;
    const res = await fetch(ANILIST_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query,
        variables: { malId, type },
      }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const body = (await res.json()) as {
      data?: { Media?: { id?: number } | null };
      errors?: { message: string }[];
    };

    if (body.errors?.length) {
      console.warn(
        `[AniList] Failed to lookup media by malId ${malId}: ${body.errors[0].message}`,
      );
      return null;
    }

    return body.data?.Media?.id ?? null;
  } catch (err) {
    console.warn(
      `[AniList] Error looking up malId ${malId}:`,
      extractErrorMessage(err),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch mutation helper — bypasses Zeus to send multiple aliased mutations
// in a single HTTP request, with 429 retry.
// ---------------------------------------------------------------------------

const ANILIST_API_URL =
  process.env.ANILIST_API_URL ?? "https://graphql.anilist.co";
const PUSH_CHUNK_SIZE = 10;

type AniListApiError = {
  message: string;
  validation?: Record<string, unknown>;
};

function formatAniListApiErrors(errors: AniListApiError[]): string {
  const messages = errors
    .map((e) => e.message)
    .filter(Boolean)
    .join("; ");

  const validationDetails: string[] = [];
  for (const err of errors) {
    if (!err.validation) continue;
    for (const [field, value] of Object.entries(err.validation)) {
      if (Array.isArray(value)) {
        const text = value.filter((v) => typeof v === "string").join(" | ");
        validationDetails.push(text ? `${field}: ${text}` : field);
      } else if (typeof value === "string") {
        validationDetails.push(`${field}: ${value}`);
      } else {
        validationDetails.push(field);
      }
    }
  }

  if (validationDetails.length > 0) {
    const prefix = messages || "validation";
    return `${prefix} (${validationDetails.join(", ")})`;
  }

  return messages || "Unknown AniList API error";
}

async function batchAniListMutation(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(ANILIST_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    // Check for Cloudflare challenge
    if (res.headers.get("cf-mitigated") === "challenge") {
      console.error(`[AniList] Cloudflare challenge detected`);
      throw new Error("AniList blocked by Cloudflare challenge");
    }

    if (res.status === 429) {
      const raw = res.headers.get("Retry-After");
      const parsed = raw != null ? parseInt(raw, 10) : Number.NaN;
      const wait = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
      console.warn(
        `[AniList] Rate limited — waiting ${wait}s (attempt ${attempt}/${MAX_RETRIES})`,
      );
      if (attempt === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");

      // Try to parse as JSON to extract GraphQL error messages
      let body: { errors?: AniListApiError[] } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON, will handle as raw text
      }

      // Prioritize GraphQL error messages if available
      if (body?.errors?.length) {
        const errorMsg = formatAniListApiErrors(body.errors);
        console.error(`[AniList] API Error: ${errorMsg}`);
        const hasValidationError = body.errors.some((e) => e.validation);
        const hasMediaIdValidationError = body.errors.some(
          (e) => e.validation?.mediaId,
        );
        let finalMsg = errorMsg;
        if (hasMediaIdValidationError) finalMsg += " [VALIDATION:mediaId]";
        else if (hasValidationError) finalMsg += " [VALIDATION:other]";
        throw new Error(finalMsg);
      }

      // No GraphQL error message, just log HTTP status
      console.error(`[AniList] HTTP ${res.status}`);
      throw new Error(`AniList HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const body = (await res.json()) as {
      data?: Record<string, unknown>;
      errors?: AniListApiError[];
    };
    if (body.errors?.length) {
      const errorMsg = formatAniListApiErrors(body.errors);
      console.error(`[AniList] API Error: ${errorMsg}`);
      const hasValidationError = body.errors.some((e) => e.validation);
      const hasMediaIdValidationError = body.errors.some(
        (e) => e.validation?.mediaId,
      );
      let finalMsg = errorMsg;
      if (hasMediaIdValidationError) finalMsg += " [VALIDATION:mediaId]";
      else if (hasValidationError) finalMsg += " [VALIDATION:other]";
      throw new Error(finalMsg);
    }
    return body.data ?? {};
  }
  throw new Error("AniList rate limit: exceeded retry limit");
}

interface SaveArgs {
  id?: number;
  mediaId?: number;
  malId?: number;
  status: string;
  progress: number;
  progressVolumes?: number;
  score: number;
  notes: string;
  repeat: number;
  private: boolean;
}

interface SaveOp {
  alias: string;
  args: SaveArgs;
  isCreate: boolean;
  localEntryId: string | null;
  mediaType: "anime" | "manga";
  mediaRecordId?: string; // anime or manga record ID for clearing bad anilistId
  title: string | null; // For logging purposes when validation fails
  malId?: number | null; // For fallback if anilistId is invalid
}

interface DeleteOp {
  alias: string;
  entryId: number;
  title: string;
  mediaType: "anime" | "manga";
}

function buildSaveBatch(ops: SaveOp[]): {
  query: string;
  variables: Record<string, unknown>;
} {
  const varDecls: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, unknown> = {};

  for (let i = 0; i < ops.length; i++) {
    const { alias, args } = ops[i];
    const argParts: string[] = [];

    if (args.id != null) {
      varDecls.push(`$id_${i}: Int`);
      variables[`id_${i}`] = args.id;
      argParts.push(`id: $id_${i}`);
    } else if (args.mediaId != null) {
      varDecls.push(`$mediaId_${i}: Int`);
      variables[`mediaId_${i}`] = args.mediaId;
      argParts.push(`mediaId: $mediaId_${i}`);
    }

    varDecls.push(`$status_${i}: MediaListStatus`);
    variables[`status_${i}`] = args.status;
    argParts.push(`status: $status_${i}`);

    varDecls.push(`$progress_${i}: Int`);
    variables[`progress_${i}`] = args.progress;
    argParts.push(`progress: $progress_${i}`);

    if (args.progressVolumes != null) {
      varDecls.push(`$progressVolumes_${i}: Int`);
      variables[`progressVolumes_${i}`] = args.progressVolumes;
      argParts.push(`progressVolumes: $progressVolumes_${i}`);
    }

    varDecls.push(`$score_${i}: Float`);
    variables[`score_${i}`] = args.score;
    argParts.push(`score: $score_${i}`);

    varDecls.push(`$notes_${i}: String`);
    variables[`notes_${i}`] = args.notes;
    argParts.push(`notes: $notes_${i}`);

    varDecls.push(`$repeat_${i}: Int`);
    variables[`repeat_${i}`] = args.repeat;
    argParts.push(`repeat: $repeat_${i}`);

    varDecls.push(`$private_${i}: Boolean`);
    variables[`private_${i}`] = args.private;
    argParts.push(`private: $private_${i}`);

    selections.push(
      `${alias}: SaveMediaListEntry(${argParts.join(", ")}) { id }`,
    );
  }

  const query = `mutation SaveBatch(${varDecls.join(", ")}) {\n${selections.join("\n")}\n}`;
  return { query, variables };
}

function buildDeleteBatch(ops: DeleteOp[]): {
  query: string;
  variables: Record<string, unknown>;
} {
  const varDecls: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, unknown> = {};

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    varDecls.push(`$id_${i}: Int`);
    variables[`id_${i}`] = op.entryId;
    selections.push(
      `${op.alias}: DeleteMediaListEntry(id: $id_${i}) { deleted }`,
    );
  }

  const query = `mutation DeleteBatch(${varDecls.join(", ")}) {\n${selections.join("\n")}\n}`;
  return { query, variables };
}

export async function pushAniList(logId: string): Promise<void> {
  const [tokenInfo, settings] = await Promise.all([
    getToken("ANILIST"),
    getSettings(),
  ]);
  if (!tokenInfo?.accessToken)
    throw new Error("Not logged in to AniList — cannot push");

  const username = tokenInfo.username ?? settings.anilistUsername;
  if (!username) throw new Error("No AniList username configured");
  const accessToken = tokenInfo.accessToken;

  const errors: string[] = [];
  const deletions: string[] = [];
  let animeMatched = 0;
  let animeChanged = 0;
  let mangaMatched = 0;
  let mangaChanged = 0;

  // ── Phase 1: Scan remote + load local in parallel ─────────────────────────

  const [remoteAnimeMap, remoteMangaMap, animeEntries, mangaEntries] =
    await Promise.all([
      scanAniListEntries(username, "ANIME" as GraphQLTypes["MediaType"]),
      scanAniListEntries(username, "MANGA" as GraphQLTypes["MediaType"]),
      prisma.animeListEntry.findMany({
        include: { anime: true },
        orderBy: { id: "asc" },
      }),
      prisma.mangaListEntry.findMany({
        include: { manga: true },
        orderBy: { id: "asc" },
      }),
    ]);

  // Log anime entries with missing or potentially invalid episode counts
  const missingEpisodeCount = animeEntries.filter((e) => !e.anime.episodeCount);
  if (missingEpisodeCount.length > 0) {
    console.warn(
      `[AniList Push] Found ${missingEpisodeCount.length} anime entries with null episodeCount (cannot validate progress):`,
    );
    for (const entry of missingEpisodeCount.slice(0, 10)) {
      console.warn(
        `  - ${entry.id}: progress=${entry.progress}, title="${entry.anime.titleEn}"`,
      );
    }
  }

  const invalidProgressAnime = animeEntries.filter(
    (e) => e.anime.episodeCount && e.progress > e.anime.episodeCount,
  );
  if (invalidProgressAnime.length > 0) {
    console.warn(
      `[AniList Push] Found ${invalidProgressAnime.length} anime entries with progress > episodeCount:`,
    );
    for (const entry of invalidProgressAnime) {
      console.warn(
        `  - ${entry.id}: progress=${entry.progress}, episodes=${entry.anime.episodeCount}, title="${entry.anime.titleEn}"`,
      );
    }
  }

  // Log manga entries with missing or potentially invalid chapter counts
  const missingChapterCount = mangaEntries.filter((e) => !e.manga.chapterCount);
  if (missingChapterCount.length > 0) {
    console.warn(
      `[AniList Push] Found ${missingChapterCount.length} manga entries with null chapterCount (cannot validate progress):`,
    );
    for (const entry of missingChapterCount.slice(0, 10)) {
      console.warn(
        `  - ${entry.id}: progress=${entry.progress}, title="${entry.manga.titleEn}"`,
      );
    }
  }

  const invalidProgressManga = mangaEntries.filter(
    (e) => e.manga.chapterCount && e.progress > e.manga.chapterCount,
  );
  if (invalidProgressManga.length > 0) {
    console.warn(
      `[AniList Push] Found ${invalidProgressManga.length} manga entries with progress > chapterCount:`,
    );
    for (const entry of invalidProgressManga) {
      console.warn(
        `  - ${entry.id}: progress=${entry.progress}, chapters=${entry.manga.chapterCount}, title="${entry.manga.titleEn}"`,
      );
    }
  }

  // ── Phase 2: Build operation lists ────────────────────────────────────────

  const saveOps: SaveOp[] = [];
  const deleteOps: DeleteOp[] = [];

  // Build malId -> mediaId lookup maps (remote map is now keyed by mediaId)
  const malIdToAnimeEntry = new Map<number, number>();
  const malIdToMangaEntry = new Map<number, number>();
  for (const [mediaId, remote] of remoteAnimeMap) {
    if (remote.malId) malIdToAnimeEntry.set(remote.malId, mediaId);
  }
  for (const [mediaId, remote] of remoteMangaMap) {
    if (remote.malId) malIdToMangaEntry.set(remote.malId, mediaId);
  }

  for (const entry of animeEntries) {
    // Validate entry before attempting sync
    const entryIssues = validateAnimeListEntry(entry);
    const mediaIssues = validateMediaRecord(entry.anime);
    if (entryIssues.length > 0 || mediaIssues.length > 0) {
      // Prevent accidental delete: mark matching remote entry as handled even if skipped.
      if (entry.anime.anilistId != null)
        remoteAnimeMap.delete(entry.anime.anilistId);
      if (entry.anime.malId) {
        const mediaId = malIdToAnimeEntry.get(entry.anime.malId);
        if (mediaId !== undefined) remoteAnimeMap.delete(mediaId);
      }
      errors.push(
        `anime entry ${entry.id}: ${[...entryIssues, ...mediaIssues].join(", ")}`,
      );
      continue;
    }

    const alias = `s${saveOps.length}`;

    // Determine clamped progress based on local episode count and remote data
    let clampedProgress = entry.progress;
    let remoteEpisodeCount: number | null = null;

    const animeArgs = {
      status: reverseWatchStatus(entry.watchStatus),
      progress: clampedProgress,
      score: toAniListRating(entry.rating),
      notes: entry.notes ?? "",
      repeat: entry.rewatchCount,
      private: entry.private,
    };

    // Match by mediaId first, then fall back to malId
    let remote: AniListRemoteEntry | undefined;
    let matchedBy: "anilistId" | "malId" | null = null;
    if (entry.anime.anilistId != null) {
      remote = remoteAnimeMap.get(entry.anime.anilistId);
      if (remote) {
        matchedBy = "anilistId";
        remoteAnimeMap.delete(entry.anime.anilistId);
      }
    }
    if (!remote && entry.anime.malId) {
      const mediaId = malIdToAnimeEntry.get(entry.anime.malId);
      if (mediaId !== undefined) {
        remote = remoteAnimeMap.get(mediaId);
        if (remote) {
          matchedBy = "malId";
          remoteAnimeMap.delete(mediaId);
        }
      }
    }

    if (remote) {
      animeMatched++;
      if (
        !anilistAnimeNeedsUpdate(
          { ...entry, title: entry.anime.titleEn },
          remote,
        )
      )
        continue;

      console.info(
        `[AniList Push Trace] anime "${entry.anime.titleEn}" -> UPDATE (matchedBy=${matchedBy ?? "unknown"})`,
      );

      // Use remote's episode count for validation (AniList is authoritative for their API)
      remoteEpisodeCount = remote.episodes ?? null;
      if (remoteEpisodeCount) {
        clampedProgress = Math.min(entry.progress, remoteEpisodeCount);
        animeArgs.progress = clampedProgress;

        if (clampedProgress !== entry.progress) {
          const localCount = entry.anime.episodeCount;
          if (
            localCount &&
            remoteEpisodeCount &&
            localCount !== remoteEpisodeCount
          ) {
            console.warn(
              `[AniList Push] Episode count mismatch for ${entry.anime.titleEn}: local=${localCount}, AniList=${remoteEpisodeCount}. Clamping progress from ${entry.progress} to ${clampedProgress}`,
            );
          } else {
            console.warn(
              `[AniList Push] Clamping anime progress: ${entry.anime.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (episodes: ${remoteEpisodeCount})`,
            );
          }
        }
      }

      saveOps.push({
        alias,
        args: { id: remote.entryId, ...animeArgs },
        isCreate: false,
        localEntryId: null,
        mediaType: "anime",
        title: entry.anime.titleEn,
        malId: entry.anime.malId,
      });
    } else if (entry.anime.anilistId != null) {
      console.warn(
        `[AniList Push] No remote match for anime "${entry.anime.titleEn}" (anilistId=${entry.anime.anilistId}, malId=${entry.anime.malId ?? "null"}, localEntryId=${entry.id})`,
      );
      console.info(
        `[AniList Push Trace] anime "${entry.anime.titleEn}" -> CREATE`,
      );
      // Clamp progress based on local episode count
      if (entry.anime.episodeCount) {
        clampedProgress = Math.min(entry.progress, entry.anime.episodeCount);
        animeArgs.progress = clampedProgress;

        if (clampedProgress !== entry.progress) {
          console.warn(
            `[AniList Push] Clamping anime progress on create: ${entry.anime.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (episodes: ${entry.anime.episodeCount})`,
          );
        }
      }

      saveOps.push({
        alias,
        args: {
          mediaId: entry.anime.anilistId,
          malId: entry.anime.malId ?? undefined,
          ...animeArgs,
        },
        isCreate: true,
        localEntryId: entry.id,
        mediaRecordId: entry.anime.id,
        mediaType: "anime",
        title: entry.anime.titleEn,
        malId: entry.anime.malId,
      });
    }
  }

  for (const entry of mangaEntries) {
    // Validate entry before attempting sync
    const entryIssues = validateMangaListEntry(entry);
    const mediaIssues = validateMediaRecord(entry.manga);
    if (entryIssues.length > 0 || mediaIssues.length > 0) {
      // Prevent accidental delete: mark matching remote entry as handled even if skipped.
      if (entry.manga.anilistId != null)
        remoteMangaMap.delete(entry.manga.anilistId);
      if (entry.manga.malId) {
        const mediaId = malIdToMangaEntry.get(entry.manga.malId);
        if (mediaId !== undefined) remoteMangaMap.delete(mediaId);
      }
      errors.push(
        `manga entry ${entry.id}: ${[...entryIssues, ...mediaIssues].join(", ")}`,
      );
      continue;
    }

    const alias = `s${saveOps.length}`;

    // Determine clamped progress based on local chapter count and remote data
    let clampedProgress = entry.progress;
    let remoteChapterCount: number | null = null;

    const mangaArgs = {
      status: reverseReadStatus(entry.readStatus),
      progress: clampedProgress,
      progressVolumes: entry.progressVolumes,
      score: toAniListRating(entry.rating),
      notes: entry.notes ?? "",
      repeat: entry.rereadCount,
      private: entry.private,
    };

    // Match by mediaId first, then fall back to malId
    let remote: AniListRemoteEntry | undefined;
    if (entry.manga.anilistId != null) {
      remote = remoteMangaMap.get(entry.manga.anilistId);
      if (remote) remoteMangaMap.delete(entry.manga.anilistId);
    }
    if (!remote && entry.manga.malId) {
      const mediaId = malIdToMangaEntry.get(entry.manga.malId);
      if (mediaId !== undefined) {
        remote = remoteMangaMap.get(mediaId);
        if (remote) remoteMangaMap.delete(mediaId);
      }
    }

    if (remote) {
      mangaMatched++;
      if (
        !anilistMangaNeedsUpdate(
          { ...entry, title: entry.manga.titleEn },
          remote,
        )
      )
        continue;

      console.info(
        `[AniList Push Trace] manga "${entry.manga.titleEn}" -> UPDATE`,
      );

      // Use remote's chapter count for validation (AniList is authoritative for their API)
      remoteChapterCount = remote.chapters ?? null;
      if (remoteChapterCount) {
        clampedProgress = Math.min(entry.progress, remoteChapterCount);
        mangaArgs.progress = clampedProgress;

        if (clampedProgress !== entry.progress) {
          const localCount = entry.manga.chapterCount;
          if (
            localCount &&
            remoteChapterCount &&
            localCount !== remoteChapterCount
          ) {
            console.warn(
              `[AniList Push] Chapter count mismatch for ${entry.manga.titleEn}: local=${localCount}, AniList=${remoteChapterCount}. Clamping progress from ${entry.progress} to ${clampedProgress}`,
            );
          } else {
            console.warn(
              `[AniList Push] Clamping manga progress: ${entry.manga.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (chapters: ${remoteChapterCount})`,
            );
          }
        }
      }

      saveOps.push({
        alias,
        args: { id: remote.entryId, ...mangaArgs },
        isCreate: false,
        localEntryId: null,
        mediaType: "manga",
        title: entry.manga.titleEn,
        malId: entry.manga.malId,
      });
    } else if (entry.manga.anilistId != null) {
      console.info(
        `[AniList Push Trace] manga "${entry.manga.titleEn}" -> CREATE`,
      );
      // Clamp progress based on local chapter count
      if (entry.manga.chapterCount) {
        clampedProgress = Math.min(entry.progress, entry.manga.chapterCount);
        mangaArgs.progress = clampedProgress;

        if (clampedProgress !== entry.progress) {
          console.warn(
            `[AniList Push] Clamping manga progress on create: ${entry.manga.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (chapters: ${entry.manga.chapterCount})`,
          );
        }
      }

      saveOps.push({
        alias,
        args: {
          mediaId: entry.manga.anilistId,
          malId: entry.manga.malId ?? undefined,
          ...mangaArgs,
        },
        isCreate: true,
        localEntryId: entry.id,
        mediaRecordId: entry.manga.id,
        mediaType: "manga",
        title: entry.manga.titleEn,
        malId: entry.manga.malId,
      });
    }
  }

  for (const [, remote] of remoteAnimeMap) {
    deleteOps.push({
      alias: `d${deleteOps.length}`,
      entryId: remote.entryId,
      title: remote.title,
      mediaType: "anime",
    });
  }
  for (const [, remote] of remoteMangaMap) {
    deleteOps.push({
      alias: `d${deleteOps.length}`,
      entryId: remote.entryId,
      title: remote.title,
      mediaType: "manga",
    });
  }

  // Count save operations by type for logging
  const animeUpdateOps = saveOps.filter(
    (op) => op.mediaType === "anime" && !op.isCreate,
  );
  const animeCreateOps = saveOps.filter(
    (op) => op.mediaType === "anime" && op.isCreate,
  );
  const mangaUpdateOps = saveOps.filter(
    (op) => op.mediaType === "manga" && !op.isCreate,
  );
  const mangaCreateOps = saveOps.filter(
    (op) => op.mediaType === "manga" && op.isCreate,
  );
  const animeDeleteOps = deleteOps.filter((op) => op.mediaType === "anime");
  const mangaDeleteOps = deleteOps.filter((op) => op.mediaType === "manga");

  console.log(
    `[AniList Push] Anime: ${animeUpdateOps.length} updates, ${animeCreateOps.length} creates, ${animeDeleteOps.length} deletes`,
  );
  console.log(
    `[AniList Push] Manga: ${mangaUpdateOps.length} updates, ${mangaCreateOps.length} creates, ${mangaDeleteOps.length} deletes`,
  );

  // ── Phase 3: Execute in batches ───────────────────────────────────────────

  for (let i = 0; i < saveOps.length; i += PUSH_CHUNK_SIZE) {
    const chunk = saveOps.slice(i, i + PUSH_CHUNK_SIZE);
    const { query, variables } = buildSaveBatch(chunk);
    let result: Record<string, unknown> = {};
    try {
      result = await batchAniListMutation(query, variables, accessToken);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);

      // Log batch details on validation error
      if (errMsg.includes("validation")) {
        const batchDesc = chunk
          .map(
            (op) =>
              `${op.title} (${op.mediaType}:${op.isCreate ? "create" : "update"})`,
          )
          .join("; ");
        console.error(`[AniList Push] Validation error in batch: ${batchDesc}`);
      }

      // Retry individually for validation/400 issues (including single-op chunks).
      if (
        errMsg.includes("AniList HTTP 400") ||
        errMsg.includes("validation") ||
        errMsg.includes("[VALIDATION:")
      ) {
        // Retry individually to isolate bad entries without losing the whole chunk
        console.info(
          `[AniList Push] Retrying ${chunk.length} entries individually...`,
        );
        for (const op of chunk) {
          const { query: q, variables: v } = buildSaveBatch([
            { ...op, alias: "s0" },
          ]);
          try {
            const r = await batchAniListMutation(q, v, accessToken);
            result[op.alias] = (r as Record<string, unknown>).s0;
          } catch (ie) {
            const iMsg = ie instanceof Error ? ie.message : String(ie);
            const opDesc = `${op.title} (${op.mediaType}:${op.isCreate ? "create" : "update"}, id:${op.args.id ?? op.args.mediaId})`;
            console.error(
              `[AniList Push] Failed: ${opDesc} — ${extractErrorMessage(ie)}`,
            );

            // Try to recover invalid mediaId using malId
            if (iMsg.includes("[VALIDATION:mediaId]")) {
              console.error(`[AniList Push] Invalid mediaId for "${op.title}"`);
              console.error(`  AniList ID (mediaId): ${op.args.mediaId}`);
              console.error(
                `  MAL ID (malId): ${op.malId ?? op.args.malId ?? "none"}`,
              );

              const malId = op.malId ?? op.args.malId;
              if (malId) {
                console.info(
                  `[AniList Push] Attempting recovery: looking up correct mediaId via malId ${malId}...`,
                );
                const correctedMediaId = await getMediaIdByMalId(
                  malId,
                  op.mediaType === "anime" ? "ANIME" : "MANGA",
                  accessToken,
                );

                if (correctedMediaId && correctedMediaId !== op.args.mediaId) {
                  console.info(
                    `[AniList Push] Found correct mediaId for "${op.title}": ${correctedMediaId} (was ${op.args.mediaId})`,
                  );

                  // Update the local record with correct anilistId
                  try {
                    if (op.mediaType === "anime") {
                      await prisma.anime.update({
                        where: { id: op.mediaRecordId },
                        data: { anilistId: correctedMediaId },
                      });
                    } else {
                      await prisma.manga.update({
                        where: { id: op.mediaRecordId },
                        data: { anilistId: correctedMediaId },
                      });
                    }
                    console.warn(
                      `[AniList] Updated anilistId to ${correctedMediaId} for ${op.mediaType} ${op.mediaRecordId}`,
                    );

                    // Retry with corrected mediaId
                    const correctedOp = {
                      ...op,
                      args: { ...op.args, mediaId: correctedMediaId },
                    };
                    const { query: retryQ, variables: retryV } = buildSaveBatch(
                      [{ ...correctedOp, alias: "s0" }],
                    );
                    try {
                      const retryR = await batchAniListMutation(
                        retryQ,
                        retryV,
                        accessToken,
                      );
                      result[op.alias] = (retryR as Record<string, unknown>).s0;
                      console.info(
                        `[AniList Push] Retry succeeded for "${op.title}" with corrected mediaId`,
                      );
                    } catch (retryErr) {
                      console.error(
                        `[AniList Push] Retry failed even with corrected mediaId:`,
                        extractErrorMessage(retryErr),
                      );
                      errors.push(
                        `save ${op.alias} (recovered attempt): ${extractErrorMessage(retryErr)}`,
                      );
                      result[op.alias] = null;
                    }
                  } catch (updateErr) {
                    console.error(
                      `[AniList] Failed to update anilistId:`,
                      extractErrorMessage(updateErr),
                    );
                    errors.push(
                      `update anilistId: ${extractErrorMessage(updateErr)}`,
                    );
                  }
                } else {
                  if (correctedMediaId === op.args.mediaId) {
                    console.warn(
                      `[AniList Push] MAL lookup for "${op.title}" returned the same mediaId (${op.args.mediaId}); skipping this entry for now.`,
                    );
                  } else {
                    console.warn(
                      `[AniList Push] Could not resolve AniList mediaId via malId ${malId} for "${op.title}"; skipping this entry for now.`,
                    );
                  }
                  // Graceful skip: do not register as sync error when MAL recovery cannot resolve.
                  result[op.alias] = null;
                }
              } else {
                // No malId available; skip this op and keep local ids unchanged.
                console.warn(
                  `[AniList Push] No malId available to attempt recovery`,
                );
                errors.push(
                  `save ${op.alias} (${opDesc}): ${extractErrorMessage(ie)}`,
                );
                result[op.alias] = null;
              }
            } else {
              // Non-mediaId error
              errors.push(
                `save ${op.alias} (${opDesc}): ${extractErrorMessage(ie)}`,
              );
              result[op.alias] = null;
            }
          }
        }
      } else {
        const batchDesc = chunk
          .map(
            (op) =>
              `${op.title} (${op.mediaType}:${op.isCreate ? "create" : "update"})`,
          )
          .join("; ");
        const batchNum = Math.floor(i / PUSH_CHUNK_SIZE) + 1;
        console.error(
          `[AniList Push] Batch ${batchNum} failed (${chunk.length} entries): ${batchDesc}`,
        );
        errors.push(`save batch ${batchNum}: ${extractErrorMessage(e)}`);
        continue;
      }
    }

    const dbUpdates: Promise<unknown>[] = [];
    for (const op of chunk) {
      const saveResult = result[op.alias] as { id?: number } | null | undefined;
      if (saveResult?.id == null) continue;

      if (op.isCreate && op.localEntryId) {
        const newId = saveResult.id;
        if (op.mediaType === "anime") {
          dbUpdates.push(
            prisma.animeListEntry.update({
              where: { id: op.localEntryId },
              data: { anilistEntryId: newId },
            }),
          );
        } else {
          dbUpdates.push(
            prisma.mangaListEntry.update({
              where: { id: op.localEntryId },
              data: { anilistEntryId: newId },
            }),
          );
        }
      }
      if (op.mediaType === "anime") {
        animeChanged++;
      } else {
        mangaChanged++;
      }
    }
    await Promise.all(dbUpdates);
  }

  for (let i = 0; i < deleteOps.length; i += PUSH_CHUNK_SIZE) {
    const chunk = deleteOps.slice(i, i + PUSH_CHUNK_SIZE);
    const { query, variables } = buildDeleteBatch(chunk);
    try {
      await batchAniListMutation(query, variables, accessToken);
    } catch (e) {
      errors.push(
        `delete batch ${i / PUSH_CHUNK_SIZE + 1}: ${extractErrorMessage(e)}`,
      );
      continue;
    }
    for (const op of chunk) {
      const msg = `${op.mediaType} "${op.title}" (AniList entry ${op.entryId})`;
      console.log(`[AniList Push] Deleted ${msg}`);
      deletions.push(msg);
      if (op.mediaType === "anime") animeChanged++;
      else mangaChanged++;
    }
  }

  const total = animeMatched + mangaMatched;
  const changed = animeChanged + mangaChanged;
  console.log(
    `[AniList Push] Anime: ${animeMatched} matched (${animeChanged} changed)`,
  );
  console.log(
    `[AniList Push] Manga: ${mangaMatched} matched (${mangaChanged} changed)`,
  );
  console.log(
    `[AniList Push] Matched ${total} entries (${changed} changed, ${deletions.length} deleted): ${animeMatched} anime, ${mangaMatched} manga`,
  );

  await prisma.syncLog.update({
    where: { id: logId },
    data: {
      status: errors.length ? "FAILED" : "COMPLETED",
      animeSynced: animeMatched,
      mangaSynced: mangaMatched,
      animeChanged,
      mangaChanged,
      errors,
      deletions,
      finishedAt: new Date(),
    },
  });
}
