import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  snapshot: vi.fn(),
  kitsu: vi.fn(),
  anilist: vi.fn(),
  persistKitsu: vi.fn(),
  persistAni: vi.fn(),
}));
vi.mock("@/lib/actions/kitsu-sync", () => ({
  getKitsuPushSnapshotAction: f.snapshot,
  persistKitsuMappingsAction: f.persistKitsu,
  persistAniListMappingsAction: f.persistAni,
}));
vi.mock("./client-queries", () => ({
  resolveKitsuIdByExternalIdsClient: f.kitsu,
  resolveAniListIdByKitsuIdClient: f.anilist,
}));

import { repairMissingKitsuMappings } from "./client-mapping-repair";

beforeEach(() => {
  vi.clearAllMocks();
  f.snapshot.mockResolvedValue({ ok: true, data: { anime: [], manga: [] } });
  f.kitsu.mockResolvedValue(null);
  f.anilist.mockResolvedValue(null);
  f.persistKitsu.mockResolvedValue({
    ok: true,
    data: { anime: 1, manga: 1, errors: [] },
  });
  f.persistAni.mockResolvedValue({
    ok: true,
    data: { anime: 1, manga: 1, errors: [] },
  });
});

describe("repair missing cross-provider mappings", () => {
  it("fails when snapshot retrieval fails or omits data", async () => {
    f.snapshot
      .mockResolvedValueOnce({ ok: false, error: "Unauthorized" })
      .mockResolvedValueOnce({ ok: true });
    await expect(repairMissingKitsuMappings()).rejects.toThrow("Unauthorized");
    await expect(repairMissingKitsuMappings()).rejects.toThrow(
      "Unable to load local media mappings",
    );
    expect(f.kitsu).not.toHaveBeenCalled();
  });
  it("does not perform lookups or writes for already-complete records", async () => {
    f.snapshot.mockResolvedValue({
      ok: true,
      data: {
        anime: [{ anime: { id: "a", kitsuId: "1", anilistId: 2 } }],
        manga: [{ manga: { id: "m", kitsuId: "3", anilistId: 4 } }],
      },
    });
    expect(await repairMissingKitsuMappings()).toEqual({
      repairedAnime: 0,
      repairedManga: 0,
      repairedAniListAnime: 0,
      repairedAniListManga: 0,
      unavailableAniListMappings: [],
      unresolved: [],
    });
    expect(f.kitsu).not.toHaveBeenCalled();
    expect(f.anilist).not.toHaveBeenCalled();
    expect(f.persistKitsu).not.toHaveBeenCalled();
    expect(f.persistAni).not.toHaveBeenCalled();
  });
  it("uses repaired Kitsu IDs for the second phase and persists anime/manga payloads independently", async () => {
    f.snapshot.mockResolvedValue({
      ok: true,
      data: {
        anime: [
          { anime: { id: "a", kitsuId: null, anilistId: null, malId: 1 } },
        ],
        manga: [
          { manga: { id: "m", kitsuId: null, anilistId: null, malId: 2 } },
        ],
      },
    });
    f.kitsu.mockResolvedValueOnce("11").mockResolvedValueOnce("22");
    f.anilist.mockResolvedValueOnce(111).mockResolvedValueOnce(222);
    expect(await repairMissingKitsuMappings()).toEqual({
      repairedAnime: 1,
      repairedManga: 1,
      repairedAniListAnime: 1,
      repairedAniListManga: 1,
      unavailableAniListMappings: [],
      unresolved: [],
    });
    expect(f.kitsu.mock.calls).toEqual([
      ["anime", { anilistId: null, malId: 1 }],
      ["manga", { anilistId: null, malId: 2 }],
    ]);
    expect(f.anilist.mock.calls).toEqual([
      ["anime", "11"],
      ["manga", "22"],
    ]);
    expect(f.persistKitsu).toHaveBeenCalledWith({
      anime: [{ id: "a", kitsuId: "11" }],
      manga: [{ id: "m", kitsuId: "22" }],
    });
    expect(f.persistAni).toHaveBeenCalledWith({
      anime: [{ id: "a", anilistId: 111 }],
      manga: [{ id: "m", anilistId: 222 }],
    });
  });
  it("reports unresolved and unavailable mappings without overwriting valid existing IDs", async () => {
    f.snapshot.mockResolvedValue({
      ok: true,
      data: {
        anime: [
          {
            anime: {
              id: "a",
              titleEn: "Anime",
              kitsuId: null,
              anilistId: null,
            },
          },
          { anime: { id: "b", kitsuId: "1", anilistId: null } },
        ],
        manga: [
          { manga: { id: "m", kitsuId: null, anilistId: null } },
          {
            manga: { id: "n", titleEn: "Manga", kitsuId: "2", anilistId: null },
          },
        ],
      },
    });
    const result = await repairMissingKitsuMappings();
    expect(result.unresolved).toEqual(['anime "Anime"', 'manga "m"']);
    expect(result.unavailableAniListMappings).toEqual([
      'anime "b" missing an AniList mapping',
      'manga "Manga" missing an AniList mapping',
    ]);
    expect(f.anilist.mock.calls).toEqual([
      ["anime", "1"],
      ["manga", "2"],
    ]);
    expect(f.persistKitsu).not.toHaveBeenCalled();
    expect(f.persistAni).not.toHaveBeenCalled();
  });
  it("includes persistence errors and returns persisted counts rather than assuming every lookup was saved", async () => {
    f.snapshot.mockResolvedValue({
      ok: true,
      data: {
        anime: [{ anime: { id: "a", kitsuId: null, anilistId: null } }],
        manga: [],
      },
    });
    f.kitsu.mockResolvedValue("1");
    f.anilist.mockResolvedValue(2);
    f.persistKitsu.mockResolvedValue({
      ok: true,
      data: { anime: 0, manga: 0, errors: ["kitsu conflict"] },
    });
    f.persistAni.mockResolvedValue({
      ok: true,
      data: { anime: 0, manga: 0, errors: ["anilist conflict"] },
    });
    expect(await repairMissingKitsuMappings()).toMatchObject({
      repairedAnime: 0,
      repairedAniListAnime: 0,
      unresolved: ["kitsu conflict", "anilist conflict"],
    });
  });
  it.each(["kitsu", "anilist"])(
    "propagates rejected %s persistence",
    async (provider) => {
      f.snapshot.mockResolvedValue({
        ok: true,
        data: {
          anime: [{ anime: { id: "a", kitsuId: null, anilistId: null } }],
          manga: [],
        },
      });
      f.kitsu.mockResolvedValue("1");
      f.anilist.mockResolvedValue(2);
      (provider === "kitsu" ? f.persistKitsu : f.persistAni).mockResolvedValue({
        ok: false,
        error: "write denied",
      });
      await expect(repairMissingKitsuMappings()).rejects.toThrow(
        "write denied",
      );
    },
  );
});
