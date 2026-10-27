import "server-only";

import { ReadStatus, ShowStatus, WatchStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import {
  invalidateAnimeTitleCache,
  invalidateMangaTitleCache,
} from "@/lib/redis";
import {
  validateAnimeListEntry,
  validateMangaListEntry,
  validateMediaRecord,
} from "@/lib/validation";
import type {
  KitsuLibraryEntry,
  KitsuLibrarySyncPayload,
} from "./sync-payload";

function isNewerEntry(
  remoteUpdatedAt: string | null | undefined,
  localUpdatedAt: Date | null | undefined,
): boolean {
  if (!localUpdatedAt) return true;
  if (!remoteUpdatedAt) return true;

  return new Date(remoteUpdatedAt) > localUpdatedAt;
}

function animeMediaNeedsUpdate(
  existing: {
    titleEn: string | null;
    titleJp: string | null;
    titleRomaji: string | null;
    synopsis: string | null;
    coverImageUrl: string | null;
    bannerImageUrl: string | null;
    episodeCount: number | null;
    showStatus: ShowStatus;
    averageRating: number | null;
    startDate: Date | null;
    endDate: Date | null;
  },
  next: {
    titleEn: string | null;
    titleJp: string | null;
    titleRomaji: string | null;
    synopsis: string | null;
    coverImageUrl: string | null;
    bannerImageUrl: string | null;
    episodeCount: number | null;
    showStatus: ShowStatus;
    averageRating: number | null;
    startDate: Date | null;
    endDate: Date | null;
  },
): boolean {
  return (
    existing.titleEn !== next.titleEn ||
    existing.titleJp !== next.titleJp ||
    existing.titleRomaji !== next.titleRomaji ||
    existing.synopsis !== next.synopsis ||
    existing.coverImageUrl !== next.coverImageUrl ||
    existing.bannerImageUrl !== next.bannerImageUrl ||
    existing.episodeCount !== next.episodeCount ||
    existing.showStatus !== next.showStatus ||
    existing.averageRating !== next.averageRating ||
    existing.startDate?.getTime() !== next.startDate?.getTime() ||
    existing.endDate?.getTime() !== next.endDate?.getTime()
  );
}

function mangaMediaNeedsUpdate(
  existing: {
    titleEn: string | null;
    titleJp: string | null;
    titleRomaji: string | null;
    synopsis: string | null;
    coverImageUrl: string | null;
    chapterCount: number | null;
    volumeCount: number | null;
    showStatus: ShowStatus;
    averageRating: number | null;
    startDate: Date | null;
    endDate: Date | null;
  },
  next: {
    titleEn: string | null;
    titleJp: string | null;
    titleRomaji: string | null;
    synopsis: string | null;
    coverImageUrl: string | null;
    chapterCount: number | null;
    volumeCount: number | null;
    showStatus: ShowStatus;
    averageRating: number | null;
    startDate: Date | null;
    endDate: Date | null;
  },
): boolean {
  return (
    existing.titleEn !== next.titleEn ||
    existing.titleJp !== next.titleJp ||
    existing.titleRomaji !== next.titleRomaji ||
    existing.synopsis !== next.synopsis ||
    existing.coverImageUrl !== next.coverImageUrl ||
    existing.chapterCount !== next.chapterCount ||
    existing.volumeCount !== next.volumeCount ||
    existing.showStatus !== next.showStatus ||
    existing.averageRating !== next.averageRating ||
    existing.startDate?.getTime() !== next.startDate?.getTime() ||
    existing.endDate?.getTime() !== next.endDate?.getTime()
  );
}

function animeEntryNeedsUpdate(
  existing: {
    watchStatus: WatchStatus;
    progress: number;
    rating: number | null;
    notes: string | null;
    private: boolean;
    rewatching: boolean;
    rewatchCount: number;
    kitsuEntryId: string | null;
  },
  next: {
    watchStatus: WatchStatus;
    progress: number;
    rating: number | null;
    notes: string | null;
    private: boolean;
    rewatching: boolean;
    rewatchCount: number;
    kitsuEntryId: string | null;
  },
): boolean {
  return (
    existing.watchStatus !== next.watchStatus ||
    existing.progress !== next.progress ||
    existing.rating !== next.rating ||
    existing.notes !== next.notes ||
    existing.private !== next.private ||
    existing.rewatching !== next.rewatching ||
    existing.rewatchCount !== next.rewatchCount ||
    existing.kitsuEntryId !== next.kitsuEntryId
  );
}

function mangaEntryNeedsUpdate(
  existing: {
    readStatus: ReadStatus;
    progress: number;
    progressVolumes: number;
    rating: number | null;
    notes: string | null;
    private: boolean;
    rereading: boolean;
    rereadCount: number;
    kitsuEntryId: string | null;
  },
  next: {
    readStatus: ReadStatus;
    progress: number;
    progressVolumes: number;
    rating: number | null;
    notes: string | null;
    private: boolean;
    rereading: boolean;
    rereadCount: number;
    kitsuEntryId: string | null;
  },
): boolean {
  return (
    existing.readStatus !== next.readStatus ||
    existing.progress !== next.progress ||
    existing.progressVolumes !== next.progressVolumes ||
    existing.rating !== next.rating ||
    existing.notes !== next.notes ||
    existing.private !== next.private ||
    existing.rereading !== next.rereading ||
    existing.rereadCount !== next.rereadCount ||
    existing.kitsuEntryId !== next.kitsuEntryId
  );
}

function mapWatchStatus(status: string | null | undefined): WatchStatus {
  switch (status) {
    case "CURRENT":
      return WatchStatus.WATCHING;
    case "PLANNED":
      return WatchStatus.PLAN_TO_WATCH;
    case "COMPLETED":
      return WatchStatus.COMPLETED;
    case "ON_HOLD":
      return WatchStatus.ON_HOLD;
    case "DROPPED":
      return WatchStatus.DROPPED;
    default:
      return WatchStatus.PLAN_TO_WATCH;
  }
}

function mapReadStatus(status: string | null | undefined): ReadStatus {
  switch (status) {
    case "CURRENT":
      return ReadStatus.READING;
    case "PLANNED":
      return ReadStatus.PLAN_TO_READ;
    case "COMPLETED":
      return ReadStatus.COMPLETED;
    case "ON_HOLD":
      return ReadStatus.ON_HOLD;
    case "DROPPED":
      return ReadStatus.DROPPED;
    default:
      return ReadStatus.PLAN_TO_READ;
  }
}

function mapShowStatus(status: string | null | undefined): ShowStatus {
  switch (status) {
    case "CURRENT":
      return ShowStatus.AIRING;
    case "FINISHED":
      return ShowStatus.FINISHED;
    case "UPCOMING":
    case "TBA":
    case "UNRELEASED":
      return ShowStatus.UPCOMING;
    default:
      return ShowStatus.UNKNOWN;
  }
}

function titlesFrom(entry: KitsuLibraryEntry["media"]) {
  return {
    titleEn: entry.titles?.translated ?? entry.titles?.canonical ?? "Unknown",
    titleJp: entry.titles?.original ?? null,
    titleRomaji: entry.titles?.romanized ?? null,
  };
}

function descriptionFrom(
  description: string | Record<string, string> | null | undefined,
): string | null {
  if (!description) return null;
  if (typeof description === "string") return description;
  return (
    description.en ?? description.en_jp ?? Object.values(description)[0] ?? null
  );
}

function posterUrl(entry: KitsuLibraryEntry["media"]): string | null {
  return entry.posterImage?.original?.url?.split("?")[0] ?? null;
}

function bannerUrl(entry: KitsuLibraryEntry["media"]): string | null {
  return entry.bannerImage?.original?.url?.split("?")[0] ?? null;
}

function extractExternalIds(entry: KitsuLibraryEntry["media"]): {
  anilistId: number | null;
  malId: number | null;
} {
  const mappingNodes = entry.mappings?.nodes ?? [];
  const anilist = mappingNodes.find((mapping) =>
    mapping.externalSite.includes("ANILIST"),
  );
  const mal = mappingNodes.find((mapping) =>
    mapping.externalSite.includes("MYANIMELIST"),
  );
  const parseExternalId = (value: string): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    anilistId: anilist ? parseExternalId(anilist.externalId) : null,
    malId: mal ? parseExternalId(mal.externalId) : null,
  };
}

async function applyAnimeEntry(entry: KitsuLibraryEntry): Promise<boolean> {
  const media = entry.media;
  const titles = titlesFrom(media);
  const { anilistId, malId } = extractExternalIds(media);

  const mediaIssues = validateMediaRecord({
    anilistId,
    malId,
    titleEn: titles.titleEn,
  });
  if (mediaIssues.length > 0) {
    throw new Error(mediaIssues.join(", "));
  }

  const entryIssues = validateAnimeListEntry({
    progress: entry.progress ?? 0,
    rating: entry.rating ?? null,
    rewatchCount: entry.reconsumeCount ?? 0,
  });
  if (entryIssues.length > 0) {
    throw new Error(entryIssues.join(", "));
  }

  const sharedMedia = {
    kitsuId: media.id,
    ...(anilistId ? { anilistId } : {}),
    ...(malId ? { malId } : {}),
    titleEn: titles.titleEn,
    titleJp: titles.titleJp,
    titleRomaji: titles.titleRomaji,
    synopsis: descriptionFrom(media.description),
    coverImageUrl: posterUrl(media),
    bannerImageUrl: bannerUrl(media),
    episodeCount: media.episodeCount ?? null,
    showStatus: mapShowStatus(media.status),
    averageRating: media.averageRating ?? null,
    startDate: media.startDate ? new Date(media.startDate) : null,
    endDate: media.endDate ? new Date(media.endDate) : null,
  };

  let animeRecord = await prisma.anime.findUnique({
    where: { kitsuId: media.id },
  });
  if (!animeRecord && anilistId) {
    animeRecord = await prisma.anime.findUnique({ where: { anilistId } });
  }
  if (!animeRecord && malId) {
    animeRecord = await prisma.anime.findUnique({ where: { malId } });
  }

  let mediaChanged = false;

  if (animeRecord) {
    if (animeRecord.kitsuId && animeRecord.kitsuId !== media.id) {
      throw new Error("conflicting Kitsu ID");
    }
    if (
      anilistId &&
      animeRecord.anilistId &&
      animeRecord.anilistId !== anilistId
    ) {
      throw new Error("conflicting AniList ID");
    }
    if (malId && animeRecord.malId && animeRecord.malId !== malId) {
      throw new Error("conflicting MyAnimeList ID");
    }

    const updateData = { ...sharedMedia };
    if (animeRecord.anilistId) {
      delete updateData.anilistId;
    }

    const identifiersNeedUpdate =
      !animeRecord.kitsuId ||
      (anilistId !== null && !animeRecord.anilistId) ||
      (malId !== null && !animeRecord.malId);
    if (
      animeMediaNeedsUpdate(animeRecord, sharedMedia) ||
      identifiersNeedUpdate
    ) {
      animeRecord = await prisma.anime.update({
        where: { id: animeRecord.id },
        data: updateData,
      });
      mediaChanged = true;
    }
  } else {
    animeRecord = await prisma.anime.create({ data: sharedMedia });
    mediaChanged = true;
  }

  if (mediaChanged) {
    await invalidateAnimeTitleCache(animeRecord.id, animeRecord.kitsuId);
  }

  const entryData = {
    kitsuEntryId: entry.id,
    watchStatus: mapWatchStatus(entry.status),
    progress: entry.progress ?? 0,
    rating: entry.rating ?? null,
    notes: entry.notes ?? null,
    private: entry.private ?? false,
    rewatching: entry.reconsuming ?? false,
    rewatchCount: entry.reconsumeCount ?? 0,
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
  };

  const existingEntry = await prisma.animeListEntry.findUnique({
    where: { animeId: animeRecord.id },
  });

  if (
    existingEntry &&
    !isNewerEntry(entry.updatedAt, existingEntry.updatedAt)
  ) {
    return mediaChanged;
  }

  if (!existingEntry) {
    await prisma.animeListEntry.create({
      data: { animeId: animeRecord.id, ...entryData },
    });
    return true;
  }

  if (!animeEntryNeedsUpdate(existingEntry, entryData)) {
    return mediaChanged;
  }

  await prisma.animeListEntry.update({
    where: { id: existingEntry.id },
    data: entryData,
  });

  return true;
}

async function applyMangaEntry(entry: KitsuLibraryEntry): Promise<boolean> {
  const media = entry.media;
  const titles = titlesFrom(media);
  const { anilistId, malId } = extractExternalIds(media);

  const mediaIssues = validateMediaRecord({
    anilistId,
    malId,
    titleEn: titles.titleEn,
  });
  if (mediaIssues.length > 0) {
    throw new Error(mediaIssues.join(", "));
  }

  const entryIssues = validateMangaListEntry({
    progress: entry.progress ?? 0,
    progressVolumes: 0,
    rating: entry.rating ?? null,
    rereadCount: entry.reconsumeCount ?? 0,
  });
  if (entryIssues.length > 0) {
    throw new Error(entryIssues.join(", "));
  }

  const sharedMedia = {
    kitsuId: media.id,
    ...(anilistId ? { anilistId } : {}),
    ...(malId ? { malId } : {}),
    titleEn: titles.titleEn,
    titleJp: titles.titleJp,
    titleRomaji: titles.titleRomaji,
    synopsis: descriptionFrom(media.description),
    coverImageUrl: posterUrl(media),
    chapterCount: media.chapterCount ?? null,
    volumeCount: media.volumeCount ?? null,
    showStatus: mapShowStatus(media.status),
    averageRating: media.averageRating ?? null,
    startDate: media.startDate ? new Date(media.startDate) : null,
    endDate: media.endDate ? new Date(media.endDate) : null,
  };

  let mangaRecord = await prisma.manga.findUnique({
    where: { kitsuId: media.id },
  });
  if (!mangaRecord && anilistId) {
    mangaRecord = await prisma.manga.findUnique({ where: { anilistId } });
  }
  if (!mangaRecord && malId) {
    mangaRecord = await prisma.manga.findUnique({ where: { malId } });
  }

  let mediaChanged = false;

  if (mangaRecord) {
    if (mangaRecord.kitsuId && mangaRecord.kitsuId !== media.id) {
      throw new Error("conflicting Kitsu ID");
    }
    if (
      anilistId &&
      mangaRecord.anilistId &&
      mangaRecord.anilistId !== anilistId
    ) {
      throw new Error("conflicting AniList ID");
    }
    if (malId && mangaRecord.malId && mangaRecord.malId !== malId) {
      throw new Error("conflicting MyAnimeList ID");
    }

    const updateData = { ...sharedMedia };
    if (mangaRecord.anilistId) {
      delete updateData.anilistId;
    }

    const identifiersNeedUpdate =
      !mangaRecord.kitsuId ||
      (anilistId !== null && !mangaRecord.anilistId) ||
      (malId !== null && !mangaRecord.malId);
    if (
      mangaMediaNeedsUpdate(mangaRecord, sharedMedia) ||
      identifiersNeedUpdate
    ) {
      mangaRecord = await prisma.manga.update({
        where: { id: mangaRecord.id },
        data: updateData,
      });
      mediaChanged = true;
    }
  } else {
    mangaRecord = await prisma.manga.create({ data: sharedMedia });
    mediaChanged = true;
  }

  if (mediaChanged) {
    await invalidateMangaTitleCache(mangaRecord.id, mangaRecord.kitsuId);
  }

  const entryData = {
    kitsuEntryId: entry.id,
    readStatus: mapReadStatus(entry.status),
    progress: entry.progress ?? 0,
    progressVolumes: 0,
    rating: entry.rating ?? null,
    notes: entry.notes ?? null,
    private: entry.private ?? false,
    rereading: entry.reconsuming ?? false,
    rereadCount: entry.reconsumeCount ?? 0,
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
  };

  const existingEntry = await prisma.mangaListEntry.findUnique({
    where: { mangaId: mangaRecord.id },
  });

  if (
    existingEntry &&
    !isNewerEntry(entry.updatedAt, existingEntry.updatedAt)
  ) {
    return mediaChanged;
  }

  if (!existingEntry) {
    await prisma.mangaListEntry.create({
      data: { mangaId: mangaRecord.id, ...entryData },
    });
    return true;
  }

  if (!mangaEntryNeedsUpdate(existingEntry, entryData)) {
    return mediaChanged;
  }

  await prisma.mangaListEntry.update({
    where: { id: existingEntry.id },
    data: entryData,
  });

  return true;
}

export async function applyKitsuLibrarySync(
  payload: KitsuLibrarySyncPayload,
): Promise<{
  animeSynced: number;
  mangaSynced: number;
  animeChanged: number;
  mangaChanged: number;
  errors: string[];
}> {
  let animeSynced = 0;
  let mangaSynced = 0;
  let animeChanged = 0;
  let mangaChanged = 0;
  const errors: string[] = [];

  for (const entry of payload.anime) {
    try {
      const changed = await applyAnimeEntry(entry);
      animeSynced++;
      if (changed) animeChanged++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`anime ${entry.id}: ${message}`);
    }
  }

  for (const entry of payload.manga) {
    try {
      const changed = await applyMangaEntry(entry);
      mangaSynced++;
      if (changed) mangaChanged++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`manga ${entry.id}: ${message}`);
    }
  }

  return { animeSynced, mangaSynced, animeChanged, mangaChanged, errors };
}
