"use server";

import { z } from "zod";
import prisma from "@/lib/prisma";
import { invalidateListCache } from "@/lib/redis";
import { requireSession } from "@/lib/session";
import type {
  ActionResult,
  AnimeCollectionItemInput,
  AnimeResolvePayload,
  MangaCollectionItemInput,
  MangaResolvePayload,
} from "./types";

export async function addAnimeCollectionItem(
  input: AnimeCollectionItemInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();
    const item = await prisma.animeCollectionItem.create({
      data: {
        animeId: input.animeId,
        rarity: input.rarity,
        format: input.format,
        condition: input.condition,
        notes: input.notes || null,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
        pricePaid: input.pricePaid ?? null,
        barcode: input.barcode || null,
      },
    });
    await invalidateListCache();
    return { ok: true, data: { id: item.id } };
  } catch (err) {
    console.error("[collection] addAnimeCollectionItem error:", err);
    return { ok: false, error: "Failed to add item" };
  }
}

export async function editAnimeCollectionItem(
  id: string,
  input: Omit<AnimeCollectionItemInput, "animeId">,
): Promise<ActionResult> {
  try {
    await requireSession();
    const existing = await prisma.animeCollectionItem.findUnique({
      where: { id },
      select: { animeId: true },
    });
    if (!existing) return { ok: false, error: "Item not found" };

    await prisma.animeCollectionItem.update({
      where: { id },
      data: {
        rarity: input.rarity,
        format: input.format,
        condition: input.condition,
        notes: input.notes || null,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
        pricePaid: input.pricePaid ?? null,
        barcode: input.barcode || null,
      },
    });
    await invalidateListCache();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[collection] editAnimeCollectionItem error:", err);
    return { ok: false, error: "Failed to update item" };
  }
}

export async function deleteAnimeCollectionItem(
  id: string,
): Promise<ActionResult> {
  try {
    await requireSession();
    const existing = await prisma.animeCollectionItem.findUnique({
      where: { id },
      select: { animeId: true },
    });
    if (!existing) return { ok: false, error: "Item not found" };

    await prisma.animeCollectionItem.delete({ where: { id } });
    await invalidateListCache();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[collection] deleteAnimeCollectionItem error:", err);
    return { ok: false, error: "Failed to delete item" };
  }
}

export async function addMangaCollectionItem(
  input: MangaCollectionItemInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();
    const item = await prisma.mangaCollectionItem.create({
      data: {
        mangaId: input.mangaId,
        condition: input.condition,
        language: input.language,
        notes: input.notes || null,
        containsSerialized: input.containsSerialized,
        containsOmnibus: input.containsOmnibus,
        volumes: input.volumes,
        chapters: input.chapters,
      },
    });
    await invalidateListCache();
    return { ok: true, data: { id: item.id } };
  } catch (err) {
    console.error("[collection] addMangaCollectionItem error:", err);
    return { ok: false, error: "Failed to add item" };
  }
}

export async function editMangaCollectionItem(
  id: string,
  input: Omit<MangaCollectionItemInput, "mangaId">,
  totalVolumes: number | null,
  totalChapters: number | null,
): Promise<ActionResult> {
  try {
    await requireSession();
    const existing = await prisma.mangaCollectionItem.findUnique({
      where: { id },
      select: { mangaId: true },
    });
    if (!existing) return { ok: false, error: "Item not found" };

    const prunedVolumes =
      totalVolumes !== null
        ? input.volumes.filter((v) => v >= 1 && v <= totalVolumes)
        : input.volumes;
    const prunedChapters =
      totalChapters !== null
        ? input.chapters.filter((c) => c >= 1 && c <= totalChapters)
        : input.chapters;

    if (prunedVolumes.length !== input.volumes.length) {
      console.warn(
        `[collection] editMangaCollectionItem ${id}: pruned ${input.volumes.length - prunedVolumes.length} out-of-range volume(s)`,
      );
    }
    if (prunedChapters.length !== input.chapters.length) {
      console.warn(
        `[collection] editMangaCollectionItem ${id}: pruned ${input.chapters.length - prunedChapters.length} out-of-range chapter(s)`,
      );
    }

    await prisma.mangaCollectionItem.update({
      where: { id },
      data: {
        condition: input.condition,
        language: input.language,
        notes: input.notes || null,
        containsSerialized: input.containsSerialized,
        containsOmnibus: input.containsOmnibus,
        volumes: prunedVolumes,
        chapters: prunedChapters,
      },
    });
    await invalidateListCache();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[collection] editMangaCollectionItem error:", err);
    return { ok: false, error: "Failed to update item" };
  }
}

export async function deleteMangaCollectionItem(
  id: string,
): Promise<ActionResult> {
  try {
    await requireSession();
    const existing = await prisma.mangaCollectionItem.findUnique({
      where: { id },
      select: { mangaId: true },
    });
    if (!existing) return { ok: false, error: "Item not found" };

    await prisma.mangaCollectionItem.delete({ where: { id } });
    await invalidateListCache();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("[collection] deleteMangaCollectionItem error:", err);
    return { ok: false, error: "Failed to delete item" };
  }
}

const AnimeResolvePayloadSchema = z.object({
  kitsuId: z.string().min(1),
  anilistId: z.number().int().nullable().optional(),
  malId: z.number().int().nullable().optional(),
  titleEn: z.string().nullable().optional(),
  titleRomaji: z.string().nullable().optional(),
  titleJp: z.string().nullable().optional(),
  episodeCount: z.number().int().nullable().optional(),
  averageRating: z.number().nullable().optional(),
  coverImageUrl: z.string().nullable().optional(),
  bannerImageUrl: z.string().nullable().optional(),
});

const MangaResolvePayloadSchema = z.object({
  kitsuId: z.string().min(1),
  anilistId: z.number().int().nullable().optional(),
  malId: z.number().int().nullable().optional(),
  titleEn: z.string().nullable().optional(),
  titleRomaji: z.string().nullable().optional(),
  titleJp: z.string().nullable().optional(),
  chapterCount: z.number().int().nullable().optional(),
  volumeCount: z.number().int().nullable().optional(),
  averageRating: z.number().nullable().optional(),
  coverImageUrl: z.string().nullable().optional(),
});

export async function resolveAnimeId(
  payload: AnimeResolvePayload,
): Promise<ActionResult<string>> {
  try {
    await requireSession();
    const parsed = AnimeResolvePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    const data = parsed.data;
    const existing = await prisma.anime.findUnique({
      where: { kitsuId: data.kitsuId },
      select: { id: true },
    });
    if (existing) {
      await prisma.anime.update({
        where: { id: existing.id },
        data: {
          anilistId: data.anilistId ?? undefined,
          malId: data.malId ?? undefined,
          titleEn: data.titleEn ?? undefined,
          titleRomaji: data.titleRomaji ?? undefined,
          titleJp: data.titleJp ?? undefined,
          episodeCount: data.episodeCount ?? undefined,
          averageRating: data.averageRating ?? undefined,
          coverImageUrl: data.coverImageUrl ?? undefined,
          bannerImageUrl: data.bannerImageUrl ?? undefined,
        },
      });
      await invalidateListCache();
      return { ok: true, data: existing.id };
    }

    const created = await prisma.anime.create({
      data: {
        kitsuId: data.kitsuId,
        anilistId: data.anilistId ?? null,
        malId: data.malId ?? null,
        titleEn: data.titleEn ?? data.kitsuId,
        titleRomaji: data.titleRomaji ?? null,
        titleJp: data.titleJp ?? null,
        episodeCount: data.episodeCount ?? null,
        showStatus: "UNKNOWN",
        averageRating: data.averageRating ?? null,
        coverImageUrl: data.coverImageUrl ?? null,
        bannerImageUrl: data.bannerImageUrl ?? null,
      },
    });
    await invalidateListCache();
    return { ok: true, data: created.id };
  } catch (err) {
    console.error("[collection] resolveAnimeId error:", err);
    return { ok: false, error: "Failed to resolve anime" };
  }
}

export async function resolveMangaId(
  payload: MangaResolvePayload,
): Promise<ActionResult<string>> {
  try {
    await requireSession();
    const parsed = MangaResolvePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    const data = parsed.data;
    const existing = await prisma.manga.findUnique({
      where: { kitsuId: data.kitsuId },
      select: { id: true },
    });
    if (existing) {
      await prisma.manga.update({
        where: { id: existing.id },
        data: {
          anilistId: data.anilistId ?? undefined,
          malId: data.malId ?? undefined,
          titleEn: data.titleEn ?? undefined,
          titleRomaji: data.titleRomaji ?? undefined,
          titleJp: data.titleJp ?? undefined,
          chapterCount: data.chapterCount ?? undefined,
          volumeCount: data.volumeCount ?? undefined,
          averageRating: data.averageRating ?? undefined,
          coverImageUrl: data.coverImageUrl ?? undefined,
        },
      });
      await invalidateListCache();
      return { ok: true, data: existing.id };
    }

    const created = await prisma.manga.create({
      data: {
        kitsuId: data.kitsuId,
        anilistId: data.anilistId ?? null,
        malId: data.malId ?? null,
        titleEn: data.titleEn ?? data.kitsuId,
        titleRomaji: data.titleRomaji ?? null,
        titleJp: data.titleJp ?? null,
        chapterCount: data.chapterCount ?? null,
        volumeCount: data.volumeCount ?? null,
        showStatus: "UNKNOWN",
        averageRating: data.averageRating ?? null,
        coverImageUrl: data.coverImageUrl ?? null,
      },
    });
    await invalidateListCache();
    return { ok: true, data: created.id };
  } catch (err) {
    console.error("[collection] resolveMangaId error:", err);
    return { ok: false, error: "Failed to resolve manga" };
  }
}
