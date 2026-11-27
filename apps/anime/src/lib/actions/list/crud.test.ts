import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => {
  const table = () => ({
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  });
  return {
    anime: table(),
    manga: table(),
    animeListEntry: table(),
    mangaListEntry: table(),
    session: vi.fn(),
    animeCache: vi.fn(),
    mangaCache: vi.fn(),
    revalidate: vi.fn(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: f.revalidate }));
vi.mock("@/lib/session", () => ({ requireSession: f.session }));
vi.mock("@/lib/prisma", () => ({
  default: {
    anime: f.anime,
    manga: f.manga,
    animeListEntry: f.animeListEntry,
    mangaListEntry: f.mangaListEntry,
  },
}));
vi.mock("@/lib/redis", () => ({
  invalidateAnimeListCache: f.animeCache,
  invalidateMangaListCache: f.mangaCache,
}));

import {
  applyAnimeQuickStatus,
  applyMangaQuickStatus,
  removeAnimeListEntry,
  removeMangaListEntry,
  startAnimeRewatch,
  startMangaReread,
  upsertAnimeListEntry,
  upsertMangaListEntry,
} from "../list";

beforeEach(() => {
  vi.clearAllMocks();
  f.session.mockResolvedValue({ user: { id: "u" } });
  f.animeCache.mockResolvedValue(undefined);
  f.mangaCache.mockResolvedValue(undefined);
  for (const table of [f.anime, f.manga, f.animeListEntry, f.mangaListEntry])
    for (const mock of Object.values(table)) mock.mockReset();
  f.anime.findUnique.mockResolvedValue({
    id: "anime",
    kitsuId: "12",
    titleEn: "Title",
    episodeCount: 12,
  });
  f.manga.findUnique.mockResolvedValue({
    id: "manga",
    kitsuId: "34",
    titleEn: "Title",
    chapterCount: 100,
    volumeCount: 10,
  });
  for (const table of [f.animeListEntry, f.mangaListEntry]) {
    table.findUnique.mockResolvedValue(null);
    table.create.mockResolvedValue({ id: "entry" });
    table.update.mockResolvedValue({ id: "entry" });
    table.deleteMany.mockResolvedValue({ count: 1 });
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("list mutation state transitions", () => {
  it("creates plan entries with explicit default state and refreshes list/detail routes", async () => {
    expect(await upsertAnimeListEntry({ animeId: "anime" })).toEqual({
      ok: true,
      data: { id: "entry" },
    });
    expect(f.animeListEntry.create).toHaveBeenCalledWith({
      data: {
        animeId: "anime",
        watchStatus: "PLAN_TO_WATCH",
        progress: 0,
        rating: null,
        notes: null,
        private: false,
        rewatchCount: 0,
        rewatching: false,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    expect(await upsertMangaListEntry({ mangaId: "manga" })).toEqual({
      ok: true,
      data: { id: "entry" },
    });
    expect(f.mangaListEntry.create.mock.calls[0][0].data).toMatchObject({
      readStatus: "PLAN_TO_READ",
      progress: 0,
      progressVolumes: 0,
      rereading: false,
      rereadCount: 0,
    });
    expect(f.animeCache).toHaveBeenCalledOnce();
    expect(f.mangaCache).toHaveBeenCalledOnce();
    expect(f.revalidate.mock.calls).toEqual([
      ["/list/anime"],
      ["/anime/title/12"],
      ["/list/manga"],
      ["/manga/title/34"],
    ]);
  });
  it("completes known-length media, caps ratings and ends reconsumption", async () => {
    await upsertAnimeListEntry({
      animeId: "anime",
      watchStatus: "COMPLETED",
      progress: 2,
      rating: 100,
      rewatching: true,
    });
    expect(f.animeListEntry.create.mock.calls[0][0].data).toMatchObject({
      watchStatus: "COMPLETED",
      progress: 12,
      rating: 20,
      rewatching: false,
    });
    await upsertMangaListEntry({
      mangaId: "manga",
      readStatus: "COMPLETED",
      progress: 2,
      progressVolumes: 1,
      rereading: true,
      rating: -1,
    });
    expect(f.mangaListEntry.create.mock.calls[0][0].data).toMatchObject({
      readStatus: "COMPLETED",
      progress: 100,
      progressVolumes: 10,
      rating: 0,
      rereading: false,
    });
  });
  it("clamps progress/counts and normalizes active rewatch/reread statuses", async () => {
    await upsertAnimeListEntry({
      animeId: "anime",
      watchStatus: "ON_HOLD",
      progress: 50.8,
      rewatchCount: -1,
      rewatching: true,
    });
    expect(f.animeListEntry.create.mock.calls[0][0].data).toMatchObject({
      watchStatus: "WATCHING",
      progress: 12,
      rewatchCount: 0,
      rewatching: true,
    });
    await upsertMangaListEntry({
      mangaId: "manga",
      readStatus: "DROPPED",
      progress: -1,
      progressVolumes: 50.2,
      rereadCount: 2.8,
      rereading: true,
    });
    expect(f.mangaListEntry.create.mock.calls[0][0].data).toMatchObject({
      readStatus: "READING",
      progress: 0,
      progressVolumes: 10,
      rereadCount: 2,
      rereading: true,
    });
  });
  it("preserves existing progress/private/dates when returning to plan unless progress is explicit", async () => {
    const base = {
      progress: 8,
      progressVolumes: 4,
      rating: 17,
      notes: "keep",
      private: true,
      startedAt: new Date("2025-01-01Z"),
      completedAt: null,
    };
    f.animeListEntry.findUnique.mockResolvedValue({
      ...base,
      watchStatus: "WATCHING",
      rewatchCount: 3,
      rewatching: false,
    });
    f.mangaListEntry.findUnique.mockResolvedValue({
      ...base,
      readStatus: "READING",
      rereadCount: 2,
      rereading: false,
    });
    await applyAnimeQuickStatus({
      animeId: "anime",
      watchStatus: "PLAN_TO_WATCH",
    });
    expect(f.animeListEntry.update.mock.calls[0][0].data).toMatchObject({
      progress: 8,
      rating: 17,
      notes: "keep",
      private: true,
      rewatchCount: 3,
      startedAt: base.startedAt,
    });
    await applyMangaQuickStatus({
      mangaId: "manga",
      readStatus: "PLAN_TO_READ",
    });
    expect(f.mangaListEntry.update.mock.calls[0][0].data).toMatchObject({
      progress: 8,
      progressVolumes: 4,
      rating: 17,
      rereadCount: 2,
    });
    await upsertAnimeListEntry({
      animeId: "anime",
      progress: 1.8,
      rating: null,
      notes: null,
    });
    expect(f.animeListEntry.update.mock.calls[1][0].data).toMatchObject({
      watchStatus: "WATCHING",
      progress: 1,
      rating: null,
      notes: null,
    });
    await upsertMangaListEntry({
      mangaId: "manga",
      progress: 1.8,
      progressVolumes: 2.8,
    });
    expect(f.mangaListEntry.update.mock.calls[1][0].data).toMatchObject({
      readStatus: "READING",
      progress: 1,
      progressVolumes: 2,
    });
  });
  it("supports incomplete provider totals without inventing completed progress", async () => {
    f.anime.findUnique.mockResolvedValue({ id: "anime", episodeCount: null });
    f.manga.findUnique.mockResolvedValue({
      id: "manga",
      chapterCount: null,
      volumeCount: null,
    });
    await upsertAnimeListEntry({
      animeId: "anime",
      watchStatus: "COMPLETED",
      progress: 5,
    });
    await upsertMangaListEntry({
      mangaId: "manga",
      readStatus: "COMPLETED",
      progress: 6,
      progressVolumes: 2,
    });
    expect(f.animeListEntry.create.mock.calls[0][0].data.progress).toBe(5);
    expect(f.mangaListEntry.create.mock.calls[0][0].data).toMatchObject({
      progress: 6,
      progressVolumes: 2,
    });
  });
  it("increments rewatch/reread counts and resets both progress dimensions", async () => {
    f.animeListEntry.findUnique.mockResolvedValue({
      watchStatus: "COMPLETED",
      progress: 12,
      rewatchCount: 2,
    });
    f.mangaListEntry.findUnique.mockResolvedValue({
      readStatus: "COMPLETED",
      progress: 100,
      progressVolumes: 10,
      rereadCount: 1,
    });
    await startAnimeRewatch("anime");
    await startMangaReread("manga");
    expect(f.animeListEntry.update.mock.calls[0][0].data).toMatchObject({
      progress: 0,
      rewatchCount: 3,
      rewatching: true,
      watchStatus: "WATCHING",
    });
    expect(f.mangaListEntry.update.mock.calls[0][0].data).toMatchObject({
      progress: 0,
      progressVolumes: 0,
      rereadCount: 2,
      rereading: true,
      readStatus: "READING",
    });
    f.animeListEntry.findUnique.mockResolvedValue(null);
    f.mangaListEntry.findUnique.mockResolvedValue(null);
    await startAnimeRewatch("anime");
    await startMangaReread("manga");
    expect(f.animeListEntry.create.mock.calls[0][0].data.rewatchCount).toBe(1);
    expect(f.mangaListEntry.create.mock.calls[0][0].data.rereadCount).toBe(1);
  });
  it("reports absent media without mutations or cache invalidation", async () => {
    f.anime.findUnique.mockResolvedValue(null);
    f.manga.findUnique.mockResolvedValue(null);
    expect(await upsertAnimeListEntry({ animeId: "a" })).toEqual({
      ok: false,
      error: "Anime not found",
    });
    expect(await upsertMangaListEntry({ mangaId: "m" })).toEqual({
      ok: false,
      error: "Manga not found",
    });
    expect(f.animeListEntry.create).not.toHaveBeenCalled();
    expect(f.mangaCache).not.toHaveBeenCalled();
  });
  it("deletes entries by media ID, tolerates missing detail records and refreshes caches", async () => {
    f.anime.findUnique.mockResolvedValue(null);
    f.manga.findUnique.mockResolvedValue(null);
    expect(await removeAnimeListEntry("a")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await removeMangaListEntry("m")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(f.animeListEntry.deleteMany).toHaveBeenCalledWith({
      where: { animeId: "a" },
    });
    expect(f.mangaListEntry.deleteMany).toHaveBeenCalledWith({
      where: { mangaId: "m" },
    });
    expect(f.revalidate.mock.calls).toEqual([["/list/anime"], ["/list/manga"]]);
  });
  it("requires authentication before every write path and returns bounded errors", async () => {
    f.session.mockRejectedValue(new Error("Unauthorized"));
    const results = await Promise.all([
      upsertAnimeListEntry({ animeId: "a" }),
      upsertMangaListEntry({ mangaId: "m" }),
      applyAnimeQuickStatus({ animeId: "a", watchStatus: "WATCHING" }),
      applyMangaQuickStatus({ mangaId: "m", readStatus: "READING" }),
      startAnimeRewatch("a"),
      startMangaReread("m"),
      removeAnimeListEntry("a"),
      removeMangaListEntry("m"),
    ]);
    expect(results.every((r) => !r.ok)).toBe(true);
    for (const table of [f.anime, f.manga, f.animeListEntry, f.mangaListEntry])
      for (const operation of Object.values(table))
        expect(operation).not.toHaveBeenCalled();
    expect(f.animeCache).not.toHaveBeenCalled();
    expect(f.mangaCache).not.toHaveBeenCalled();
    expect(f.revalidate).not.toHaveBeenCalled();
  });
});
