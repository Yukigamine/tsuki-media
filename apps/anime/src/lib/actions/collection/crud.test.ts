import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => {
  const table = () => ({
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  return {
    anime: table(),
    manga: table(),
    animeCollectionItem: table(),
    mangaCollectionItem: table(),
    session: vi.fn(),
    invalidate: vi.fn(),
  };
});
vi.mock("@/lib/session", () => ({ requireSession: f.session }));
vi.mock("@/lib/prisma", () => ({
  default: {
    anime: f.anime,
    manga: f.manga,
    animeCollectionItem: f.animeCollectionItem,
    mangaCollectionItem: f.mangaCollectionItem,
  },
}));
vi.mock("@/lib/redis", () => ({ invalidateListCache: f.invalidate }));

import {
  addAnimeCollectionItem,
  addMangaCollectionItem,
  deleteAnimeCollectionItem,
  deleteMangaCollectionItem,
  editAnimeCollectionItem,
  editMangaCollectionItem,
  resolveAnimeId,
  resolveMangaId,
} from "../collection";

const animeInput = {
  animeId: "a",
  rarity: "STANDARD",
  format: "DVD",
  condition: "MINT",
} as const;
const mangaInput = {
  mangaId: "m",
  condition: "MINT",
  language: "ENGLISH",
  containsSerialized: false,
  containsOmnibus: false,
  volumes: [1, 2],
  chapters: [1, 2],
} as const;
beforeEach(() => {
  vi.clearAllMocks();
  f.session.mockResolvedValue({ user: { id: "u" } });
  f.invalidate.mockResolvedValue(undefined);
  for (const table of [
    f.anime,
    f.manga,
    f.animeCollectionItem,
    f.mangaCollectionItem,
  ]) {
    for (const mock of Object.values(table)) mock.mockReset();
    table.findUnique.mockResolvedValue({ id: "existing" });
    table.create.mockResolvedValue({ id: "created" });
    table.update.mockResolvedValue({});
    table.delete.mockResolvedValue({});
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("collection mutations", () => {
  it("adds anime physical-copy details and normalizes optional empty strings", async () => {
    expect(await addAnimeCollectionItem(animeInput)).toEqual({
      ok: true,
      data: { id: "created" },
    });
    expect(f.animeCollectionItem.create).toHaveBeenCalledWith({
      data: {
        animeId: "a",
        rarity: "STANDARD",
        format: "DVD",
        condition: "MINT",
        notes: null,
        purchasedAt: null,
        pricePaid: null,
        barcode: null,
      },
    });
    await addAnimeCollectionItem({
      ...animeInput,
      notes: "signed",
      purchasedAt: "2026-01-02",
      pricePaid: 0,
      barcode: "123",
    });
    expect(f.animeCollectionItem.create.mock.calls[1][0].data).toMatchObject({
      notes: "signed",
      purchasedAt: new Date("2026-01-02"),
      pricePaid: 0,
      barcode: "123",
    });
    expect(f.invalidate).toHaveBeenCalledTimes(2);
  });
  it("updates/deletes existing anime copies and reports missing items without writes", async () => {
    expect(
      await editAnimeCollectionItem("copy", {
        ...animeInput,
        notes: "changed",
        purchasedAt: "2025-01-01",
        pricePaid: 10,
        barcode: "b",
      }),
    ).toEqual({ ok: true, data: undefined });
    expect(f.animeCollectionItem.update.mock.calls[0][0]).toMatchObject({
      where: { id: "copy" },
      data: {
        notes: "changed",
        purchasedAt: new Date("2025-01-01"),
        pricePaid: 10,
        barcode: "b",
      },
    });
    await editAnimeCollectionItem("copy", animeInput);
    expect(f.animeCollectionItem.update.mock.calls[1][0].data).toMatchObject({
      notes: null,
      purchasedAt: null,
      pricePaid: null,
      barcode: null,
    });
    expect(await deleteAnimeCollectionItem("copy")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(f.animeCollectionItem.delete).toHaveBeenCalledWith({
      where: { id: "copy" },
    });
    f.animeCollectionItem.findUnique.mockResolvedValue(null);
    expect(await editAnimeCollectionItem("missing", animeInput)).toEqual({
      ok: false,
      error: "Item not found",
    });
    expect(await deleteAnimeCollectionItem("missing")).toEqual({
      ok: false,
      error: "Item not found",
    });
    expect(f.animeCollectionItem.delete).toHaveBeenCalledTimes(1);
  });
  it("keeps manga ranges/language flags on add and prunes only known out-of-range edit values", async () => {
    const input = {
      ...mangaInput,
      volumes: [0, 1, 2, 4],
      chapters: [-1, 1, 2, 8],
    };
    expect(await addMangaCollectionItem(input)).toEqual({
      ok: true,
      data: { id: "created" },
    });
    expect(f.mangaCollectionItem.create.mock.calls[0][0].data).toMatchObject({
      mangaId: "m",
      language: "ENGLISH",
      notes: null,
      volumes: input.volumes,
      chapters: input.chapters,
    });
    expect(
      await editMangaCollectionItem(
        "copy",
        { ...input, notes: "omnibus", containsOmnibus: true },
        2,
        5,
      ),
    ).toEqual({ ok: true, data: undefined });
    expect(f.mangaCollectionItem.update.mock.calls[0][0].data).toMatchObject({
      volumes: [1, 2],
      chapters: [1, 2],
      notes: "omnibus",
      containsOmnibus: true,
    });
    expect(console.warn).toHaveBeenCalledTimes(2);
    await editMangaCollectionItem("copy", input, null, null);
    expect(f.mangaCollectionItem.update.mock.calls[1][0].data).toMatchObject({
      volumes: input.volumes,
      chapters: input.chapters,
    });
    expect(await deleteMangaCollectionItem("copy")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(f.mangaCollectionItem.delete).toHaveBeenCalledWith({
      where: { id: "copy" },
    });
  });
  it("reports missing manga copies and leaves persistence untouched", async () => {
    f.mangaCollectionItem.findUnique.mockResolvedValue(null);
    expect(
      await editMangaCollectionItem(
        "missing",
        { ...mangaInput, volumes: [], chapters: [] },
        1,
        1,
      ),
    ).toEqual({ ok: false, error: "Item not found" });
    expect(await deleteMangaCollectionItem("missing")).toEqual({
      ok: false,
      error: "Item not found",
    });
    expect(f.mangaCollectionItem.update).not.toHaveBeenCalled();
    expect(f.invalidate).not.toHaveBeenCalled();
  });
  it("requires sessions on every collection write path and does not expose internal errors", async () => {
    f.session.mockRejectedValue(new Error("secret database details"));
    const results = await Promise.all([
      addAnimeCollectionItem(animeInput),
      editAnimeCollectionItem("a", animeInput),
      deleteAnimeCollectionItem("a"),
      addMangaCollectionItem({ ...mangaInput, volumes: [], chapters: [] }),
      editMangaCollectionItem(
        "m",
        { ...mangaInput, volumes: [], chapters: [] },
        null,
        null,
      ),
      deleteMangaCollectionItem("m"),
      resolveAnimeId({ kitsuId: "1" }),
      resolveMangaId({ kitsuId: "1" }),
    ]);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain("secret database details");
    expect(f.animeCollectionItem.create).not.toHaveBeenCalled();
    expect(f.anime.findUnique).not.toHaveBeenCalled();
    expect(f.invalidate).not.toHaveBeenCalled();
  });
  it("validates provider resolve payloads before accessing the database", async () => {
    const results = await Promise.all([
      resolveAnimeId({ kitsuId: "", anilistId: 1 }),
      resolveAnimeId({ kitsuId: "valid", anilistId: 1.5 }),
      resolveMangaId({ kitsuId: "", volumeCount: 1 }),
      resolveMangaId({ kitsuId: "valid", volumeCount: 1.5 }),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(f.anime.findUnique).not.toHaveBeenCalled();
    expect(f.manga.findUnique).not.toHaveBeenCalled();
  });
  it("updates existing media without overwriting absent optional provider fields", async () => {
    expect(
      await resolveAnimeId({
        kitsuId: "1",
        titleEn: "A",
        episodeCount: 12,
        bannerImageUrl: "banner",
      }),
    ).toEqual({ ok: true, data: "existing" });
    expect(f.anime.update.mock.calls[0][0]).toMatchObject({
      where: { id: "existing" },
      data: {
        titleEn: "A",
        episodeCount: 12,
        bannerImageUrl: "banner",
        malId: undefined,
      },
    });
    expect(
      await resolveMangaId({
        kitsuId: "2",
        titleEn: "M",
        chapterCount: 50,
        volumeCount: 5,
      }),
    ).toEqual({ ok: true, data: "existing" });
    expect(f.manga.update.mock.calls[0][0].data).toMatchObject({
      titleEn: "M",
      chapterCount: 50,
      volumeCount: 5,
      titleJp: undefined,
    });
    expect(f.anime.create).not.toHaveBeenCalled();
    expect(f.invalidate).toHaveBeenCalledTimes(2);
  });
  it("creates resolvable sparse provider media with stable unknown/default values", async () => {
    f.anime.findUnique.mockResolvedValue(null);
    f.manga.findUnique.mockResolvedValue(null);
    expect(await resolveAnimeId({ kitsuId: "1" })).toEqual({
      ok: true,
      data: "created",
    });
    expect(f.anime.create.mock.calls[0][0].data).toEqual({
      kitsuId: "1",
      anilistId: null,
      malId: null,
      titleEn: "1",
      titleRomaji: null,
      titleJp: null,
      episodeCount: null,
      showStatus: "UNKNOWN",
      averageRating: null,
      coverImageUrl: null,
      bannerImageUrl: null,
    });
    expect(await resolveMangaId({ kitsuId: "2" })).toEqual({
      ok: true,
      data: "created",
    });
    expect(f.manga.create.mock.calls[0][0].data).toMatchObject({
      kitsuId: "2",
      titleEn: "2",
      chapterCount: null,
      volumeCount: null,
      showStatus: "UNKNOWN",
    });
    await resolveAnimeId({
      kitsuId: "3",
      titleEn: "A",
      titleRomaji: "R",
      titleJp: "J",
      anilistId: 4,
      malId: 5,
      episodeCount: 6,
      averageRating: 80,
      coverImageUrl: "cover",
      bannerImageUrl: "banner",
    });
    expect(f.anime.create.mock.calls[1][0].data).toMatchObject({
      titleEn: "A",
      anilistId: 4,
      malId: 5,
      episodeCount: 6,
      bannerImageUrl: "banner",
    });
    await resolveMangaId({
      kitsuId: "4",
      titleEn: "M",
      titleRomaji: "R",
      titleJp: "J",
      anilistId: 5,
      malId: 6,
      chapterCount: 7,
      volumeCount: 8,
      averageRating: 90,
      coverImageUrl: "cover",
    });
    expect(f.manga.create.mock.calls[1][0].data).toMatchObject({
      titleEn: "M",
      anilistId: 5,
      malId: 6,
      chapterCount: 7,
      volumeCount: 8,
    });
  });
});
