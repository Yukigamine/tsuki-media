"use server";

import type { SyncLog } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { getAuthStatus } from "@/lib/provider-links";
import { invalidateListCache } from "@/lib/redis";
import { requireSession } from "@/lib/session";
import {
  validateAnimeListEntry,
  validateMangaListEntry,
  validateMediaRecord,
} from "@/lib/validation";
import type { ActionResult, SyncDirection, SyncProvider } from "./types";

type AuthStatus = Record<
  SyncProvider,
  { loggedIn: boolean; username: string | null }
>;

export type SyncStatusPayload = { logs: SyncLog[]; auth: AuthStatus };

type InvalidEntry = {
  id: string;
  title: string | null;
  issues: string[];
  progress?: number;
  progressLimit?: number | null;
};

export type InvalidEntriesResult = {
  invalidAnime: InvalidEntry[];
  invalidManga: InvalidEntry[];
};

export async function triggerSyncAction(
  provider: SyncProvider,
  direction: SyncDirection,
): Promise<ActionResult<{ logId: string }>> {
  await requireSession();

  if (provider !== "ANILIST") {
    return {
      ok: false,
      error: "Kitsu sync now runs in the browser. Use the Kitsu sync button.",
    };
  }

  await prisma.syncLog.updateMany({
    where: { provider, direction, status: "RUNNING" },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });

  const log = await prisma.syncLog.create({
    data: { provider, direction, status: "RUNNING" },
  });

  try {
    const { pullAniList, pushAniList } = await import("@/lib/anilist/sync");
    direction === "PULL"
      ? await pullAniList(log.id)
      : await pushAniList(log.id);
    return { ok: true, data: { logId: log.id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", errors: [message], finishedAt: new Date() },
    });
    return { ok: false, error: message };
  } finally {
    // Failed syncs can still have committed partial changes.
    await invalidateListCache();
  }
}

export async function getSyncStatusAction(): Promise<SyncStatusPayload> {
  const session = await requireSession();
  const [logs, auth] = await Promise.all([
    prisma.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    getAuthStatus(session.user.id),
  ]);
  return { logs, auth };
}

export async function findInvalidEntriesAction(): Promise<InvalidEntriesResult> {
  await requireSession();
  const [animeEntries, mangaEntries] = await Promise.all([
    prisma.animeListEntry.findMany({ include: { anime: true } }),
    prisma.mangaListEntry.findMany({ include: { manga: true } }),
  ]);

  const invalidAnime: InvalidEntry[] = [];
  for (const entry of animeEntries) {
    const entryIssues = validateAnimeListEntry(entry);
    const mediaIssues = validateMediaRecord(entry.anime);
    if (!entry.anime.kitsuId) mediaIssues.push("missing Kitsu ID");
    if (!entry.anime.anilistId) mediaIssues.push("missing AniList ID");
    if (entry.anime.episodeCount && entry.progress > entry.anime.episodeCount) {
      entryIssues.push("progress exceeds episode count");
    }
    if (entryIssues.length > 0 || mediaIssues.length > 0) {
      invalidAnime.push({
        id: entry.id,
        title: entry.anime.titleEn,
        issues: [...entryIssues, ...mediaIssues],
        progress: entry.progress,
        progressLimit: entry.anime.episodeCount,
      });
    }
  }

  const invalidManga: InvalidEntry[] = [];
  for (const entry of mangaEntries) {
    const entryIssues = validateMangaListEntry(entry);
    const mediaIssues = validateMediaRecord(entry.manga);
    if (!entry.manga.kitsuId) mediaIssues.push("missing Kitsu ID");
    if (!entry.manga.anilistId) mediaIssues.push("missing AniList ID");
    if (entry.manga.chapterCount && entry.progress > entry.manga.chapterCount) {
      entryIssues.push("progress exceeds chapter count");
    }
    if (entryIssues.length > 0 || mediaIssues.length > 0) {
      invalidManga.push({
        id: entry.id,
        title: entry.manga.titleEn,
        issues: [...entryIssues, ...mediaIssues],
        progress: entry.progress,
        progressLimit: entry.manga.chapterCount,
      });
    }
  }

  return { invalidAnime, invalidManga };
}

export async function deleteInvalidEntriesAction(
  animeIds: string[],
  mangaIds: string[],
): Promise<ActionResult> {
  await requireSession();
  try {
    await Promise.all([
      animeIds.length > 0
        ? prisma.animeListEntry.deleteMany({ where: { id: { in: animeIds } } })
        : Promise.resolve(),
      mangaIds.length > 0
        ? prisma.mangaListEntry.deleteMany({ where: { id: { in: mangaIds } } })
        : Promise.resolve(),
    ]);
    await invalidateListCache();
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function normalizeInvalidRatingsAction(): Promise<
  ActionResult<{ animeFixed: number; mangaFixed: number }>
> {
  await requireSession();
  try {
    let animeFixed = 0;
    let mangaFixed = 0;

    const animeEntries = await prisma.animeListEntry.findMany({
      where: {
        OR: [{ rating: { lt: 2 } }, { rating: { gt: 20 } }],
      },
    });

    for (const entry of animeEntries) {
      if (entry.rating !== null) {
        const clamped = Math.max(2, Math.min(20, entry.rating));
        if (clamped !== entry.rating) {
          await prisma.animeListEntry.update({
            where: { id: entry.id },
            data: { rating: clamped },
          });
          animeFixed++;
        }
      }
    }

    const mangaEntries = await prisma.mangaListEntry.findMany({
      where: {
        OR: [{ rating: { lt: 2 } }, { rating: { gt: 20 } }],
      },
    });

    for (const entry of mangaEntries) {
      if (entry.rating !== null) {
        const clamped = Math.max(2, Math.min(20, entry.rating));
        if (clamped !== entry.rating) {
          await prisma.mangaListEntry.update({
            where: { id: entry.id },
            data: { rating: clamped },
          });
          mangaFixed++;
        }
      }
    }

    if (animeFixed > 0 || mangaFixed > 0) {
      await invalidateListCache();
    }

    return { ok: true, data: { animeFixed, mangaFixed } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
