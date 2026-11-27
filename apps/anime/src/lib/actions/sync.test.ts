import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: vi.fn(),
  auth: vi.fn(),
  invalidate: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  logs: {
    updateMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  anime: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
  manga: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/session", () => ({ requireSession: f.session }));
vi.mock("@/lib/provider-links", () => ({ getAuthStatus: f.auth }));
vi.mock("@/lib/redis", () => ({ invalidateListCache: f.invalidate }));
vi.mock("@/lib/anilist/sync", () => ({
  pullAniList: f.pull,
  pushAniList: f.push,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    syncLog: f.logs,
    animeListEntry: f.anime,
    mangaListEntry: f.manga,
  },
}));

import {
  deleteInvalidEntriesAction,
  findInvalidEntriesAction,
  getSyncStatusAction,
  normalizeInvalidRatingsAction,
  triggerSyncAction,
} from "./sync";

beforeEach(() => {
  for (const mock of [
    f.session,
    f.auth,
    f.invalidate,
    f.pull,
    f.push,
    ...Object.values(f.logs),
    ...Object.values(f.anime),
    ...Object.values(f.manga),
  ])
    mock.mockReset();
  f.session.mockResolvedValue({ user: { id: "user" } });
  f.auth.mockResolvedValue({
    KITSU: { loggedIn: true, username: "k" },
    ANILIST: { loggedIn: false, username: null },
  });
  f.logs.create.mockResolvedValue({ id: "log" });
  f.logs.findMany.mockResolvedValue([{ id: "old-log" }]);
  f.anime.findMany.mockResolvedValue([]);
  f.manga.findMany.mockResolvedValue([]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01Z"));
});
afterEach(() => vi.useRealTimers());

describe("server sync action boundaries", () => {
  it("rejects server-side Kitsu sync before creating logs", async () => {
    expect(await triggerSyncAction("KITSU", "PULL")).toEqual({
      ok: false,
      error: expect.stringContaining("browser"),
    });
    expect(f.logs.create).not.toHaveBeenCalled();
  });
  it.each(["PULL", "PUSH"] as const)(
    "cancels stale same-direction logs then dispatches AniList %s",
    async (direction) => {
      expect(await triggerSyncAction("ANILIST", direction)).toEqual({
        ok: true,
        data: { logId: "log" },
      });
      expect(f.logs.updateMany).toHaveBeenCalledWith({
        where: { provider: "ANILIST", direction, status: "RUNNING" },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
      expect(direction === "PULL" ? f.pull : f.push).toHaveBeenCalledWith(
        "log",
      );
      expect(direction === "PULL" ? f.push : f.pull).not.toHaveBeenCalled();
      expect(f.invalidate).toHaveBeenCalledOnce();
    },
  );
  it.each([new Error("partial sync"), "provider failed"])(
    "records failures and invalidates potentially committed partial writes",
    async (error) => {
      f.pull.mockRejectedValue(error);
      const message = error instanceof Error ? error.message : error;
      expect(await triggerSyncAction("ANILIST", "PULL")).toEqual({
        ok: false,
        error: message,
      });
      expect(f.logs.update).toHaveBeenCalledWith({
        where: { id: "log" },
        data: { status: "FAILED", errors: [message], finishedAt: new Date() },
      });
      expect(f.invalidate).toHaveBeenCalledOnce();
    },
  );
  it("returns user-scoped provider status with only the latest 20 logs", async () => {
    expect(await getSyncStatusAction()).toEqual({
      logs: [{ id: "old-log" }],
      auth: {
        KITSU: { loggedIn: true, username: "k" },
        ANILIST: { loggedIn: false, username: null },
      },
    });
    expect(f.auth).toHaveBeenCalledWith("user");
    expect(f.logs.findMany).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
      take: 20,
    });
  });
  it("combines entry/media validation and flags progress above known totals", async () => {
    const anime = {
      titleEn: "Anime",
      kitsuId: "1",
      anilistId: 2,
      malId: null,
      episodeCount: 12,
    };
    const manga = {
      titleEn: "Manga",
      kitsuId: "2",
      anilistId: 3,
      malId: null,
      chapterCount: 20,
    };
    f.anime.findMany.mockResolvedValue([
      { id: "ok", progress: 12, rating: 20, anime },
      {
        id: "bad",
        progress: 13,
        rating: -1,
        anime: { ...anime, titleEn: null, kitsuId: null, anilistId: null },
      },
      { id: "unknown", progress: 100, anime: { ...anime, episodeCount: null } },
    ]);
    f.manga.findMany.mockResolvedValue([
      { id: "ok-m", progress: 20, progressVolumes: 1, manga },
      {
        id: "bad-m",
        progress: 21,
        progressVolumes: -1,
        manga: { ...manga, titleEn: null, kitsuId: null, anilistId: null },
      },
      {
        id: "unknown-m",
        progress: 100,
        manga: { ...manga, chapterCount: null },
      },
    ]);
    expect(await findInvalidEntriesAction()).toEqual({
      invalidAnime: [
        {
          id: "bad",
          title: null,
          progress: 13,
          progressLimit: 12,
          issues: [
            "invalid rating",
            "progress exceeds episode count",
            "missing title",
            "missing Kitsu ID",
            "missing AniList ID",
          ],
        },
      ],
      invalidManga: [
        {
          id: "bad-m",
          title: null,
          progress: 21,
          progressLimit: 20,
          issues: [
            "invalid progress volumes",
            "progress exceeds chapter count",
            "missing title",
            "missing Kitsu ID",
            "missing AniList ID",
          ],
        },
      ],
    });
  });
  it("deletes only selected entries, skips empty lists and invalidates after success", async () => {
    expect(await deleteInvalidEntriesAction(["a"], ["m"])).toEqual({
      ok: true,
      data: undefined,
    });
    expect(f.anime.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] } },
    });
    expect(f.manga.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["m"] } },
    });
    expect(f.invalidate).toHaveBeenCalledOnce();
    for (const deletion of [f.anime.deleteMany, f.manga.deleteMany])
      expect(deletion.mock.invocationCallOrder[0]).toBeLessThan(
        f.invalidate.mock.invocationCallOrder[0],
      );
    f.anime.deleteMany.mockClear();
    f.manga.deleteMany.mockClear();
    f.invalidate.mockClear();
    await deleteInvalidEntriesAction([], []);
    expect(f.anime.deleteMany).not.toHaveBeenCalled();
    expect(f.manga.deleteMany).not.toHaveBeenCalled();
    // The action refreshes the cache even for an empty selection.
    expect(f.invalidate).toHaveBeenCalledOnce();
  });
  it.each([new Error("delete failed"), "connection closed"])(
    "returns deletion failures without claiming success",
    async (error) => {
      f.anime.deleteMany.mockRejectedValue(error);
      expect(await deleteInvalidEntriesAction(["a"], [])).toEqual({
        ok: false,
        error: error instanceof Error ? error.message : error,
      });
      expect(f.invalidate).not.toHaveBeenCalled();
    },
  );
  it("clamps only out-of-range nonnull ratings and invalidates only when records change", async () => {
    f.anime.findMany.mockResolvedValue([
      { id: "low", rating: 1 },
      { id: "high", rating: 21 },
      { id: "valid", rating: 10 },
      { id: "null", rating: null },
    ]);
    f.manga.findMany.mockResolvedValue([
      { id: "m", rating: -1 },
      { id: "valid-m", rating: 20 },
      { id: "null-m", rating: null },
    ]);
    expect(await normalizeInvalidRatingsAction()).toEqual({
      ok: true,
      data: { animeFixed: 2, mangaFixed: 1 },
    });
    expect(f.anime.update.mock.calls).toEqual([
      [{ where: { id: "low" }, data: { rating: 2 } }],
      [{ where: { id: "high" }, data: { rating: 20 } }],
    ]);
    expect(f.manga.update).toHaveBeenCalledWith({
      where: { id: "m" },
      data: { rating: 2 },
    });
    expect(f.invalidate).toHaveBeenCalledOnce();
    f.anime.findMany.mockResolvedValue([]);
    f.manga.findMany.mockResolvedValue([]);
    f.invalidate.mockClear();
    expect(await normalizeInvalidRatingsAction()).toEqual({
      ok: true,
      data: { animeFixed: 0, mangaFixed: 0 },
    });
    expect(f.invalidate).not.toHaveBeenCalled();
  });
  it.each([new Error("update failed"), "connection closed"])(
    "reports rating normalization failures",
    async (error) => {
      f.anime.findMany.mockRejectedValue(error);
      expect(await normalizeInvalidRatingsAction()).toEqual({
        ok: false,
        error: error instanceof Error ? error.message : error,
      });
    },
  );
  it("authenticates every entry point before reading or modifying data", async () => {
    f.session.mockRejectedValue(new Error("Unauthorized"));
    for (const call of [
      () => triggerSyncAction("ANILIST", "PULL"),
      getSyncStatusAction,
      findInvalidEntriesAction,
      () => deleteInvalidEntriesAction(["a"], ["m"]),
      normalizeInvalidRatingsAction,
    ]) {
      await expect(call()).rejects.toThrow("Unauthorized");
      for (const boundary of [
        f.auth,
        f.invalidate,
        f.pull,
        f.push,
        ...Object.values(f.logs),
        ...Object.values(f.anime),
        ...Object.values(f.manga),
      ])
        expect(boundary).not.toHaveBeenCalled();
    }
  });
});
