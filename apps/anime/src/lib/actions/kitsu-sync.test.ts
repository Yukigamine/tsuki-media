import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: vi.fn(),
  invalidate: vi.fn(),
  revalidate: vi.fn(),
  apply: vi.fn(),
  logs: { updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  anime: { findUnique: vi.fn(), update: vi.fn() },
  manga: { findUnique: vi.fn(), update: vi.fn() },
  animeList: { findMany: vi.fn() },
  mangaList: { findMany: vi.fn() },
}));
vi.mock("@/lib/session", () => ({ requireSession: f.session }));
vi.mock("@/lib/redis", () => ({ invalidateListCache: f.invalidate }));
vi.mock("next/cache", () => ({ revalidatePath: f.revalidate }));
vi.mock("@/lib/kitsu/apply-sync", () => ({ applyKitsuLibrarySync: f.apply }));
vi.mock("@/lib/prisma", () => ({
  default: {
    syncLog: f.logs,
    anime: f.anime,
    manga: f.manga,
    animeListEntry: f.animeList,
    mangaListEntry: f.mangaList,
  },
}));

import {
  finishKitsuSyncLogAction,
  getKitsuPushSnapshotAction,
  persistAniListMappingsAction,
  persistKitsuMappingsAction,
  startKitsuSyncLogAction,
  syncKitsuLibraryAction,
} from "./kitsu-sync";

beforeEach(() => {
  vi.resetAllMocks();
  f.session.mockResolvedValue({ user: { id: "user" } });
  f.logs.create.mockResolvedValue({ id: "log" });
  f.animeList.findMany.mockResolvedValue([]);
  f.mangaList.findMany.mockResolvedValue([]);
});
describe("Kitsu synchronization action boundaries", () => {
  it.each(["PULL", "PUSH"] as const)(
    "cancels stale %s logs before creating a new one",
    async (direction) => {
      expect(await startKitsuSyncLogAction(direction)).toEqual({
        ok: true,
        data: { logId: "log" },
      });
      expect(f.logs.updateMany).toHaveBeenCalledWith({
        where: { provider: "KITSU", direction, status: "RUNNING" },
        data: { status: "CANCELLED", finishedAt: expect.any(Date) },
      });
      expect(f.logs.create).toHaveBeenCalledWith({
        data: { provider: "KITSU", direction, status: "RUNNING" },
        select: { id: true },
      });
      expect(f.logs.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        f.logs.create.mock.invocationCallOrder[0],
      );
    },
  );
  it.each([undefined, ["removed"]])(
    "finishes logs with optional deletion history %j and revalidates all list views",
    async (deletions) => {
      const input = {
        logId: "log",
        status: "COMPLETED" as const,
        animeSynced: 4,
        mangaSynced: 2,
        animeChanged: 1,
        mangaChanged: 0,
        errors: ["partial provider warning"],
        deletions,
      };
      expect(await finishKitsuSyncLogAction(input)).toEqual({ ok: true });
      const { logId, ...data } = input;
      expect(f.logs.update).toHaveBeenCalledWith({
        where: { id: logId },
        data: {
          ...data,
          deletions: deletions ?? [],
          finishedAt: expect.any(Date),
        },
      });
      expect(f.invalidate).toHaveBeenCalledOnce();
      expect(f.revalidate.mock.calls).toEqual([
        ["/sync"],
        ["/list/anime"],
        ["/list/manga"],
      ]);
    },
  );
  it("returns both provider snapshots with mapping fields and no mutation", async () => {
    f.animeList.findMany.mockResolvedValue([
      { id: "a", anime: { kitsuId: "10" } },
    ]);
    f.mangaList.findMany.mockResolvedValue([
      { id: "m", manga: { kitsuId: "20" } },
    ]);
    expect(await getKitsuPushSnapshotAction()).toEqual({
      ok: true,
      data: {
        anime: [{ id: "a", anime: { kitsuId: "10" } }],
        manga: [{ id: "m", manga: { kitsuId: "20" } }],
      },
    });
    expect(f.animeList.findMany).toHaveBeenCalledWith({
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
    });
    expect(f.mangaList.findMany).toHaveBeenCalledWith({
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
    });
    expect(f.invalidate).not.toHaveBeenCalled();
  });
  it.each([new Error("db offline"), "db offline"])(
    "reports persistence failures without pretending completion: %s",
    async (failure) => {
      f.logs.updateMany.mockRejectedValue(failure);
      expect(await startKitsuSyncLogAction("PULL")).toEqual({
        ok: false,
        error: "db offline",
      });
      expect(f.logs.create).not.toHaveBeenCalled();
      f.logs.update.mockRejectedValue(failure);
      expect(
        await finishKitsuSyncLogAction({
          logId: "log",
          status: "FAILED",
          animeSynced: 0,
          mangaSynced: 0,
          animeChanged: 0,
          mangaChanged: 0,
          errors: [],
        }),
      ).toEqual({ ok: false, error: "db offline" });
      f.animeList.findMany.mockRejectedValue(failure);
      expect(await getKitsuPushSnapshotAction()).toEqual({
        ok: false,
        error: "db offline",
      });
      expect(f.revalidate).not.toHaveBeenCalled();
    },
  );
  it.each(["kitsu", "anilist"] as const)(
    "adds missing %s mappings but never overwrites conflicts or existing identical mappings",
    async (provider) => {
      const key = provider === "kitsu" ? "kitsuId" : "anilistId";
      const value = provider === "kitsu" ? "123" : 123;
      const conflict = provider === "kitsu" ? "456" : 456;
      for (const table of [f.anime, f.manga])
        table.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ [key]: conflict, titleEn: null })
          .mockResolvedValueOnce({ [key]: value })
          .mockResolvedValueOnce({ [key]: null });
      const mappings = ["missing", "conflict", "same", "new"].map((id) => ({
        id,
        [key]: value,
      }));
      const result =
        provider === "kitsu"
          ? await persistKitsuMappingsAction({
              anime: mappings as Array<{ id: string; kitsuId: string }>,
              manga: mappings as Array<{ id: string; kitsuId: string }>,
            })
          : await persistAniListMappingsAction({
              anime: mappings as Array<{ id: string; anilistId: number }>,
              manga: mappings as Array<{ id: string; anilistId: number }>,
            });
      expect(result).toEqual({
        ok: true,
        data: {
          anime: 1,
          manga: 1,
          errors: [
            "anime missing no longer exists",
            `anime "conflict" has a conflicting ${provider === "kitsu" ? "Kitsu" : "AniList"} ID`,
            "manga missing no longer exists",
            `manga "conflict" has a conflicting ${provider === "kitsu" ? "Kitsu" : "AniList"} ID`,
          ],
        },
      });
      for (const table of [f.anime, f.manga])
        expect(table.update).toHaveBeenCalledExactlyOnceWith({
          where: { id: "new" },
          data: { [key]: value },
        });
      expect(f.invalidate).toHaveBeenCalledOnce();
    },
  );
  it.each(["kitsu", "anilist"] as const)(
    "does not invalidate unchanged %s mappings and bounds database failures",
    async (provider) => {
      const action = () =>
        provider === "kitsu"
          ? persistKitsuMappingsAction({ anime: [], manga: [] })
          : persistAniListMappingsAction({ anime: [], manga: [] });
      expect(await action()).toEqual({
        ok: true,
        data: { anime: 0, manga: 0, errors: [] },
      });
      expect(f.invalidate).not.toHaveBeenCalled();
      for (const error of [new Error("offline"), "offline"]) {
        f.anime.findUnique.mockRejectedValueOnce(error);
        const result =
          provider === "kitsu"
            ? await persistKitsuMappingsAction({
                anime: [{ id: "a", kitsuId: "1" }],
                manga: [],
              })
            : await persistAniListMappingsAction({
                anime: [{ id: "a", anilistId: 1 }],
                manga: [],
              });
        expect(result).toEqual({ ok: false, error: "offline" });
      }
    },
  );
  it("validates library payloads before applying writes and propagates apply failures", async () => {
    await expect(
      syncKitsuLibraryAction({ anime: "invalid" }),
    ).rejects.toThrow();
    expect(f.apply).not.toHaveBeenCalled();
    f.apply.mockRejectedValueOnce(new Error("transaction aborted"));
    await expect(
      syncKitsuLibraryAction({ slug: "reader", anime: [], manga: [] }),
    ).rejects.toThrow("transaction aborted");
    expect(f.invalidate).not.toHaveBeenCalled();
    const result = {
      animeSynced: 1,
      mangaSynced: 2,
      animeChanged: 1,
      mangaChanged: 0,
      errors: [],
    };
    f.apply.mockResolvedValueOnce(result);
    expect(
      await syncKitsuLibraryAction({ slug: "reader", anime: [], manga: [] }),
    ).toEqual({
      ok: true,
      data: result,
    });
    expect(f.revalidate.mock.calls).toEqual([
      ["/sync"],
      ["/list/anime"],
      ["/list/manga"],
    ]);
  });
  it("requires authentication before every persistence or provider operation", async () => {
    f.session.mockRejectedValue(new Error("unauthorized"));
    for (const action of [
      () => startKitsuSyncLogAction("PULL"),
      () =>
        finishKitsuSyncLogAction({
          logId: "x",
          status: "FAILED",
          animeSynced: 0,
          mangaSynced: 0,
          animeChanged: 0,
          mangaChanged: 0,
          errors: [],
        }),
      getKitsuPushSnapshotAction,
      () => persistKitsuMappingsAction({ anime: [], manga: [] }),
      () => persistAniListMappingsAction({ anime: [], manga: [] }),
      () => syncKitsuLibraryAction({ slug: "reader", anime: [], manga: [] }),
    ]) {
      await expect(action()).rejects.toThrow("unauthorized");
      for (const boundary of [
        f.invalidate,
        f.revalidate,
        f.apply,
        ...Object.values(f.logs),
        ...Object.values(f.anime),
        ...Object.values(f.manga),
        ...Object.values(f.animeList),
        ...Object.values(f.mangaList),
      ])
        expect(boundary).not.toHaveBeenCalled();
    }
  });
});
