"use server";

import { revalidatePath } from "next/cache";
import type {
  AnimeListEntry,
  MangaListEntry,
  ReadStatus,
  WatchStatus,
} from "@/generated/prisma/client";
import { getAnimeDetailPath, getMangaDetailPath } from "@/lib/media-routing";
import prisma from "@/lib/prisma";
import {
  invalidateAnimeListCache,
  invalidateMangaListCache,
} from "@/lib/redis";
import { requireSession } from "@/lib/session";
import type {
  ActionResult,
  AnimeListUpsertInput,
  AnimeQuickStatusInput,
  MangaListUpsertInput,
  MangaQuickStatusInput,
} from "./types";

function clampInt(
  value: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampNullableRating(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Math.max(0, Math.min(20, value));
}

function normalizeAnimeStatus(
  status: WatchStatus,
  rewatching: boolean,
): WatchStatus {
  if (rewatching && status !== "WATCHING") {
    return "WATCHING";
  }
  return status;
}

function normalizeMangaStatus(
  status: ReadStatus,
  rereading: boolean,
): ReadStatus {
  if (rereading && status !== "READING") {
    return "READING";
  }
  return status;
}

async function refreshAnimeRoutes(animeId: string): Promise<void> {
  const anime = await prisma.anime.findUnique({
    where: { id: animeId },
    select: {
      id: true,
      kitsuId: true,
      titleEn: true,
      titleRomaji: true,
      titleJp: true,
    },
  });

  await invalidateAnimeListCache();
  revalidatePath("/list/anime");

  if (anime) {
    revalidatePath(getAnimeDetailPath(anime));
  }
}

async function refreshMangaRoutes(mangaId: string): Promise<void> {
  const manga = await prisma.manga.findUnique({
    where: { id: mangaId },
    select: {
      id: true,
      kitsuId: true,
      titleEn: true,
      titleRomaji: true,
      titleJp: true,
    },
  });

  await invalidateMangaListCache();
  revalidatePath("/list/manga");

  if (manga) {
    revalidatePath(getMangaDetailPath(manga));
  }
}

function deriveAnimeNext(
  existing: AnimeListEntry | null,
  input: AnimeListUpsertInput,
  episodeCount: number | null,
): Omit<
  AnimeListEntry,
  "id" | "animeId" | "kitsuEntryId" | "anilistEntryId" | "createdAt"
> {
  const now = new Date();
  const baseStatus: WatchStatus =
    existing?.watchStatus ?? input.watchStatus ?? "PLAN_TO_WATCH";
  const baseProgress = existing?.progress ?? 0;

  let watchStatus = input.watchStatus ?? baseStatus;
  let progress =
    input.progress != null ? clampInt(input.progress) : baseProgress;
  const rewatchCount =
    input.rewatchCount != null
      ? clampInt(input.rewatchCount)
      : (existing?.rewatchCount ?? 0);
  const rewatching =
    watchStatus === "COMPLETED"
      ? false
      : (input.rewatching ?? existing?.rewatching ?? false);

  watchStatus = normalizeAnimeStatus(watchStatus, rewatching);

  if (watchStatus === "COMPLETED" && episodeCount != null) {
    progress = clampInt(episodeCount);
  } else if (episodeCount != null) {
    progress = clampInt(progress, 0, episodeCount);
  }

  // Preserve progress when moving to plan state unless progress was explicitly passed.
  if (
    input.watchStatus === "PLAN_TO_WATCH" &&
    input.progress == null &&
    existing != null
  ) {
    progress = existing.progress;
  }

  const rating =
    input.rating === undefined
      ? (existing?.rating ?? null)
      : clampNullableRating(input.rating);
  const notes =
    input.notes === undefined ? (existing?.notes ?? null) : input.notes;

  return {
    watchStatus,
    progress,
    rating,
    notes,
    private: existing?.private ?? false,
    rewatchCount,
    rewatching,
    startedAt: existing?.startedAt ?? null,
    completedAt: existing?.completedAt ?? null,
    updatedAt: now,
  };
}

function deriveMangaNext(
  existing: MangaListEntry | null,
  input: MangaListUpsertInput,
  chapterCount: number | null,
  volumeCount: number | null,
): Omit<
  MangaListEntry,
  "id" | "mangaId" | "kitsuEntryId" | "anilistEntryId" | "createdAt"
> {
  const now = new Date();
  const baseStatus: ReadStatus =
    existing?.readStatus ?? input.readStatus ?? "PLAN_TO_READ";
  const baseProgress = existing?.progress ?? 0;
  const baseProgressVolumes = existing?.progressVolumes ?? 0;

  let readStatus = input.readStatus ?? baseStatus;
  let progress =
    input.progress != null ? clampInt(input.progress) : baseProgress;
  let progressVolumes =
    input.progressVolumes != null
      ? clampInt(input.progressVolumes)
      : baseProgressVolumes;
  const rereadCount =
    input.rereadCount != null
      ? clampInt(input.rereadCount)
      : (existing?.rereadCount ?? 0);
  const rereading =
    readStatus === "COMPLETED"
      ? false
      : (input.rereading ?? existing?.rereading ?? false);

  readStatus = normalizeMangaStatus(readStatus, rereading);

  if (readStatus === "COMPLETED") {
    if (chapterCount != null) progress = clampInt(chapterCount);
    if (volumeCount != null) progressVolumes = clampInt(volumeCount);
  } else {
    if (chapterCount != null) progress = clampInt(progress, 0, chapterCount);
    if (volumeCount != null)
      progressVolumes = clampInt(progressVolumes, 0, volumeCount);
  }

  if (
    input.readStatus === "PLAN_TO_READ" &&
    input.progress == null &&
    existing != null
  ) {
    progress = existing.progress;
    progressVolumes = existing.progressVolumes;
  }

  const rating =
    input.rating === undefined
      ? (existing?.rating ?? null)
      : clampNullableRating(input.rating);
  const notes =
    input.notes === undefined ? (existing?.notes ?? null) : input.notes;

  return {
    readStatus,
    progress,
    progressVolumes,
    rating,
    notes,
    private: existing?.private ?? false,
    rereadCount,
    rereading,
    startedAt: existing?.startedAt ?? null,
    completedAt: existing?.completedAt ?? null,
    updatedAt: now,
  };
}

export async function upsertAnimeListEntry(
  input: AnimeListUpsertInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();

    const anime = await prisma.anime.findUnique({
      where: { id: input.animeId },
      select: { id: true, episodeCount: true },
    });

    if (!anime) {
      return { ok: false, error: "Anime not found" };
    }

    const existing = await prisma.animeListEntry.findUnique({
      where: { animeId: input.animeId },
    });

    const next = deriveAnimeNext(existing, input, anime.episodeCount);

    const record = existing
      ? await prisma.animeListEntry.update({
          where: { animeId: input.animeId },
          data: next,
          select: { id: true },
        })
      : await prisma.animeListEntry.create({
          data: {
            animeId: input.animeId,
            ...next,
          },
          select: { id: true },
        });

    await refreshAnimeRoutes(input.animeId);

    return { ok: true, data: { id: record.id } };
  } catch (err) {
    console.error("[list] upsertAnimeListEntry error:", err);
    return { ok: false, error: "Failed to save anime list entry" };
  }
}

export async function upsertMangaListEntry(
  input: MangaListUpsertInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();

    const manga = await prisma.manga.findUnique({
      where: { id: input.mangaId },
      select: { id: true, chapterCount: true, volumeCount: true },
    });

    if (!manga) {
      return { ok: false, error: "Manga not found" };
    }

    const existing = await prisma.mangaListEntry.findUnique({
      where: { mangaId: input.mangaId },
    });

    const next = deriveMangaNext(
      existing,
      input,
      manga.chapterCount,
      manga.volumeCount,
    );

    const record = existing
      ? await prisma.mangaListEntry.update({
          where: { mangaId: input.mangaId },
          data: next,
          select: { id: true },
        })
      : await prisma.mangaListEntry.create({
          data: {
            mangaId: input.mangaId,
            ...next,
          },
          select: { id: true },
        });

    await refreshMangaRoutes(input.mangaId);

    return { ok: true, data: { id: record.id } };
  } catch (err) {
    console.error("[list] upsertMangaListEntry error:", err);
    return { ok: false, error: "Failed to save manga list entry" };
  }
}

export async function applyAnimeQuickStatus(
  input: AnimeQuickStatusInput,
): Promise<ActionResult<{ id: string }>> {
  return upsertAnimeListEntry({
    animeId: input.animeId,
    watchStatus: input.watchStatus,
  });
}

export async function applyMangaQuickStatus(
  input: MangaQuickStatusInput,
): Promise<ActionResult<{ id: string }>> {
  return upsertMangaListEntry({
    mangaId: input.mangaId,
    readStatus: input.readStatus,
  });
}

export async function startAnimeRewatch(
  animeId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();
    const existing = await prisma.animeListEntry.findUnique({
      where: { animeId },
    });

    return upsertAnimeListEntry({
      animeId,
      watchStatus: "WATCHING",
      rewatching: true,
      progress: 0,
      rewatchCount: (existing?.rewatchCount ?? 0) + 1,
    });
  } catch (err) {
    console.error("[list] startAnimeRewatch error:", err);
    return { ok: false, error: "Failed to start rewatch" };
  }
}

export async function startMangaReread(
  mangaId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();
    const existing = await prisma.mangaListEntry.findUnique({
      where: { mangaId },
    });

    return upsertMangaListEntry({
      mangaId,
      readStatus: "READING",
      rereading: true,
      progress: 0,
      progressVolumes: 0,
      rereadCount: (existing?.rereadCount ?? 0) + 1,
    });
  } catch (err) {
    console.error("[list] startMangaReread error:", err);
    return { ok: false, error: "Failed to start reread" };
  }
}

export async function removeAnimeListEntry(
  animeId: string,
): Promise<ActionResult> {
  try {
    await requireSession();

    await prisma.animeListEntry.deleteMany({ where: { animeId } });
    await refreshAnimeRoutes(animeId);

    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[list] removeAnimeListEntry error:", err);
    return { ok: false, error: "Failed to remove anime from list" };
  }
}

export async function removeMangaListEntry(
  mangaId: string,
): Promise<ActionResult> {
  try {
    await requireSession();

    await prisma.mangaListEntry.deleteMany({ where: { mangaId } });
    await refreshMangaRoutes(mangaId);

    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[list] removeMangaListEntry error:", err);
    return { ok: false, error: "Failed to remove manga from list" };
  }
}
