"use server";

import { revalidatePath } from "next/cache";
import { applyKitsuLibrarySync } from "@/lib/kitsu/apply-sync";
import {
  type KitsuLibrarySyncPayload,
  KitsuLibrarySyncPayloadSchema,
} from "@/lib/kitsu/sync-payload";
import prisma from "@/lib/prisma";
import { invalidateListCache } from "@/lib/redis";
import { requireSession } from "@/lib/session";

type KitsuSyncDirection = "PULL" | "PUSH";

export type KitsuPushSnapshot = {
  anime: Array<{
    id: string;
    progress: number;
    rating: number | null;
    notes: string | null;
    private: boolean;
    rewatchCount: number;
    rewatching: boolean;
    watchStatus:
      | "WATCHING"
      | "PLAN_TO_WATCH"
      | "COMPLETED"
      | "ON_HOLD"
      | "DROPPED";
    anime: {
      id: string;
      kitsuId: string | null;
      anilistId: number | null;
      malId: number | null;
      titleEn: string | null;
      episodeCount: number | null;
    };
  }>;
  manga: Array<{
    id: string;
    progress: number;
    rating: number | null;
    notes: string | null;
    private: boolean;
    rereadCount: number;
    rereading: boolean;
    readStatus:
      | "READING"
      | "PLAN_TO_READ"
      | "COMPLETED"
      | "ON_HOLD"
      | "DROPPED";
    manga: {
      id: string;
      kitsuId: string | null;
      anilistId: number | null;
      malId: number | null;
      titleEn: string | null;
      chapterCount: number | null;
    };
  }>;
};

export async function startKitsuSyncLogAction(
  direction: KitsuSyncDirection,
): Promise<{ ok: boolean; error?: string; data?: { logId: string } }> {
  await requireSession();

  try {
    await prisma.syncLog.updateMany({
      where: { provider: "KITSU", direction, status: "RUNNING" },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });

    const log = await prisma.syncLog.create({
      data: { provider: "KITSU", direction, status: "RUNNING" },
      select: { id: true },
    });

    return { ok: true, data: { logId: log.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function finishKitsuSyncLogAction(input: {
  logId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  animeSynced: number;
  mangaSynced: number;
  animeChanged: number;
  mangaChanged: number;
  errors: string[];
  deletions?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireSession();

  try {
    await prisma.syncLog.update({
      where: { id: input.logId },
      data: {
        status: input.status,
        animeSynced: input.animeSynced,
        mangaSynced: input.mangaSynced,
        animeChanged: input.animeChanged,
        mangaChanged: input.mangaChanged,
        errors: input.errors,
        deletions: input.deletions ?? [],
        finishedAt: new Date(),
      },
    });

    await invalidateListCache();

    await Promise.all([
      revalidatePath("/sync"),
      revalidatePath("/list/anime"),
      revalidatePath("/list/manga"),
    ]);

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getKitsuPushSnapshotAction(): Promise<{
  ok: boolean;
  error?: string;
  data?: KitsuPushSnapshot;
}> {
  await requireSession();

  try {
    const [anime, manga] = await Promise.all([
      prisma.animeListEntry.findMany({
        include: {
          anime: {
            select: {
              id: true,
              kitsuId: true,
              anilistId: true,
              malId: true,
              titleEn: true,
              episodeCount: true,
            },
          },
        },
      }),
      prisma.mangaListEntry.findMany({
        include: {
          manga: {
            select: {
              id: true,
              kitsuId: true,
              anilistId: true,
              malId: true,
              titleEn: true,
              chapterCount: true,
            },
          },
        },
      }),
    ]);

    return { ok: true, data: { anime, manga } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function persistKitsuMappingsAction(input: {
  anime: Array<{ id: string; kitsuId: string }>;
  manga: Array<{ id: string; kitsuId: string }>;
}): Promise<
  | { ok: true; data: { anime: number; manga: number; errors: string[] } }
  | { ok: false; error: string }
> {
  await requireSession();

  try {
    const errors: string[] = [];
    let anime = 0;
    let manga = 0;

    for (const mapping of input.anime) {
      const record = await prisma.anime.findUnique({
        where: { id: mapping.id },
        select: { kitsuId: true, titleEn: true },
      });
      if (!record) {
        errors.push(`anime ${mapping.id} no longer exists`);
      } else if (record.kitsuId && record.kitsuId !== mapping.kitsuId) {
        errors.push(
          `anime "${record.titleEn ?? mapping.id}" has a conflicting Kitsu ID`,
        );
      } else if (!record.kitsuId) {
        await prisma.anime.update({
          where: { id: mapping.id },
          data: { kitsuId: mapping.kitsuId },
        });
        anime++;
      }
    }

    for (const mapping of input.manga) {
      const record = await prisma.manga.findUnique({
        where: { id: mapping.id },
        select: { kitsuId: true, titleEn: true },
      });
      if (!record) {
        errors.push(`manga ${mapping.id} no longer exists`);
      } else if (record.kitsuId && record.kitsuId !== mapping.kitsuId) {
        errors.push(
          `manga "${record.titleEn ?? mapping.id}" has a conflicting Kitsu ID`,
        );
      } else if (!record.kitsuId) {
        await prisma.manga.update({
          where: { id: mapping.id },
          data: { kitsuId: mapping.kitsuId },
        });
        manga++;
      }
    }

    if (anime > 0 || manga > 0) {
      await invalidateListCache();
    }

    return { ok: true, data: { anime, manga, errors } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function persistAniListMappingsAction(input: {
  anime: Array<{ id: string; anilistId: number }>;
  manga: Array<{ id: string; anilistId: number }>;
}): Promise<
  | { ok: true; data: { anime: number; manga: number; errors: string[] } }
  | { ok: false; error: string }
> {
  await requireSession();

  try {
    const errors: string[] = [];
    let anime = 0;
    let manga = 0;

    for (const mapping of input.anime) {
      const record = await prisma.anime.findUnique({
        where: { id: mapping.id },
        select: { anilistId: true, titleEn: true },
      });
      if (!record) {
        errors.push(`anime ${mapping.id} no longer exists`);
      } else if (record.anilistId && record.anilistId !== mapping.anilistId) {
        errors.push(
          `anime "${record.titleEn ?? mapping.id}" has a conflicting AniList ID`,
        );
      } else if (!record.anilistId) {
        await prisma.anime.update({
          where: { id: mapping.id },
          data: { anilistId: mapping.anilistId },
        });
        anime++;
      }
    }

    for (const mapping of input.manga) {
      const record = await prisma.manga.findUnique({
        where: { id: mapping.id },
        select: { anilistId: true, titleEn: true },
      });
      if (!record) {
        errors.push(`manga ${mapping.id} no longer exists`);
      } else if (record.anilistId && record.anilistId !== mapping.anilistId) {
        errors.push(
          `manga "${record.titleEn ?? mapping.id}" has a conflicting AniList ID`,
        );
      } else if (!record.anilistId) {
        await prisma.manga.update({
          where: { id: mapping.id },
          data: { anilistId: mapping.anilistId },
        });
        manga++;
      }
    }

    if (anime > 0 || manga > 0) {
      await invalidateListCache();
    }

    return { ok: true, data: { anime, manga, errors } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncKitsuLibraryAction(input: unknown): Promise<{
  ok: boolean;
  error?: string;
  data?: {
    animeSynced: number;
    mangaSynced: number;
    animeChanged: number;
    mangaChanged: number;
    errors: string[];
  };
}> {
  await requireSession();

  const parsed = KitsuLibrarySyncPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }

  const payload: KitsuLibrarySyncPayload = parsed.data;
  const result = await applyKitsuLibrarySync(payload);

  await invalidateListCache();
  await Promise.all([
    revalidatePath("/sync"),
    revalidatePath("/list/anime"),
    revalidatePath("/list/manga"),
  ]);

  return { ok: true, data: result };
}
