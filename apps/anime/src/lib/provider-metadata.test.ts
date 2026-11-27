import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCached: vi.fn(), setCached: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({ ...mocks, TITLE_TTL: 86400 }));

import { getProviderSnapshot } from "./provider-metadata";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCached.mockResolvedValue(null);
  mocks.setCached.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("Kitsu metadata boundary", () => {
  it.each(["0", "-1", "1.5", "abc", "01", "12345678901", "../1", "1?x=1"])(
    "rejects unsafe provider identifier %s without requests",
    async (id) => {
      expect(await getProviderSnapshot("anime", id)).toBeNull();
      expect(mocks.getCached).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("uses cached successful and negative results without calling the provider", async () => {
    mocks.getCached
      .mockResolvedValueOnce({ detail: { id: "cached" } })
      .mockResolvedValueOnce({ missing: true });
    expect(await getProviderSnapshot("anime", "1")).toEqual({ id: "cached" });
    expect(await getProviderSnapshot("manga", "1")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getCached.mock.calls).toEqual([
      ["provider:metadata:v1:anime:1"],
      ["provider:metadata:v1:manga:1"],
    ]);
  });
  it("negative-caches 404 briefly but does not cache temporary provider failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await getProviderSnapshot("anime", "7")).toBeNull();
    expect(mocks.setCached).toHaveBeenCalledExactlyOnceWith(
      "provider:metadata:v1:anime:7",
      { missing: true },
      300,
    );
    await expect(getProviderSnapshot("anime", "8")).rejects.toThrow(
      "Kitsu metadata unavailable (503)",
    );
    expect(mocks.setCached).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid JSON/schema and propagates network failures instead of persisting them", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: null }))
      .mockResolvedValueOnce(new Response("{broken"))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(getProviderSnapshot("anime", "1")).rejects.toThrow(
      "Invalid Kitsu metadata response",
    );
    await expect(getProviderSnapshot("anime", "1")).rejects.toThrow();
    await expect(getProviderSnapshot("anime", "1")).rejects.toThrow("offline");
    expect(mocks.setCached).not.toHaveBeenCalled();
  });
  it("normalizes the provider payload and uses an abortable uncached request", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          id: "7",
          attributes: {
            titles: { en: "English", en_jp: "Romaji", ja_jp: "Native" },
            canonicalTitle: "Canonical",
            synopsis: "Plot",
            posterImage: { large: "cover", original: "fallback" },
            coverImage: { original: "banner" },
            episodeCount: 12,
            chapterCount: 20,
            volumeCount: 3,
            status: "current",
            averageRating: "82.5",
            startDate: "2020-01-01",
            endDate: "2020-06-01",
          },
        },
      }),
    );
    const detail = await getProviderSnapshot("anime", "7");
    expect(detail).toEqual({
      id: "kitsu:anime:7",
      kitsuId: "7",
      anilistId: null,
      titleEn: "English",
      titleRomaji: "Romaji",
      titleJp: "Native",
      synopsis: "Plot",
      coverImageUrl: "cover",
      bannerImageUrl: "banner",
      episodeCount: 12,
      chapterCount: 20,
      volumeCount: 3,
      showStatus: "AIRING",
      averageRating: 82.5,
      startDate: "2020-01-01",
      endDate: "2020-06-01",
    });
    expect(fetch).toHaveBeenCalledWith("https://kitsu.app/api/edge/anime/7", {
      headers: { Accept: "application/vnd.api+json" },
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(mocks.setCached).toHaveBeenCalledWith(
      "provider:metadata:v1:anime:7",
      { detail },
      86400,
    );
  });
  it.each([
    ["finished", "FINISHED"],
    ["upcoming", "UPCOMING"],
    ["unreleased", "UPCOMING"],
    ["new-status", "UNKNOWN"],
    [undefined, "UNKNOWN"],
  ])(
    "handles status %s and absent optional provider fields",
    async (status, expected) => {
      vi.mocked(fetch).mockResolvedValue(
        Response.json({
          data: {
            attributes: {
              canonicalTitle: "Canonical",
              posterImage: { original: "original" },
              coverImage: { large: "large" },
              averageRating: "not-a-number",
              status,
            },
          },
        }),
      );
      const result = await getProviderSnapshot("manga", "2");
      expect(result).toMatchObject({
        titleEn: "Canonical",
        titleJp: null,
        titleRomaji: null,
        synopsis: null,
        coverImageUrl: "original",
        bannerImageUrl: "large",
        showStatus: expected,
        averageRating: null,
        startDate: null,
        endDate: null,
      });
    },
  );
  it("allows sparse attributes without producing NaN ratings or invented titles", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { attributes: {} } }),
    );
    expect(await getProviderSnapshot("manga", "2")).toMatchObject({
      titleEn: null,
      coverImageUrl: null,
      bannerImageUrl: null,
      episodeCount: null,
      chapterCount: null,
      volumeCount: null,
      averageRating: null,
    });
  });
});
