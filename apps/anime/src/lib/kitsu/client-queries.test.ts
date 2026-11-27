import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), client: vi.fn() }));
vi.mock("./browser-client", () => ({ kitsuBrowserClient: mocks.client }));

import { MappingExternalSiteEnum as Site } from "@/lib/zeus/kitsu";
import {
  getAnimeResolvePayloadBySlug,
  getAnimeSeriesDetailBySlug,
  getMangaResolvePayloadBySlug,
  getMangaSeriesDetailBySlug,
  resolveAniListIdByKitsuIdClient,
  resolveKitsuIdByExternalIdsClient,
  searchAnimeByTitleClient,
  searchMangaByTitleClient,
} from "./client-queries";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockReturnValue(mocks.query);
  mocks.query.mockResolvedValue({});
});

describe("Kitsu browser query projections", () => {
  it("does not resolve absent IDs and searches provider mappings in priority order with type validation", async () => {
    expect(
      await resolveKitsuIdByExternalIdsClient("anime", {
        anilistId: null,
        malId: null,
      }),
    ).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query
      .mockResolvedValueOnce({
        lookupMapping: { __typename: "Manga", id: "wrong-kind" },
      })
      .mockResolvedValueOnce({ lookupMapping: { __typename: "Anime", id: 7 } });
    expect(
      await resolveKitsuIdByExternalIdsClient("anime", {
        anilistId: 1,
        malId: 2,
      }),
    ).toBe("7");
    expect(mocks.query.mock.calls[0][0].lookupMapping[0]).toEqual({
      externalId: 1,
      externalSite: Site.ANILIST_ANIME,
    });
    expect(mocks.query.mock.calls[1][0].lookupMapping[0]).toEqual({
      externalId: 2,
      externalSite: Site.MYANIMELIST_ANIME,
    });
    mocks.query.mockResolvedValueOnce({
      lookupMapping: { __typename: "Manga", id: "8" },
    });
    expect(
      await resolveKitsuIdByExternalIdsClient("manga", {
        anilistId: 3,
        malId: 4,
      }),
    ).toBe("8");
    expect(mocks.query.mock.calls[2][0].lookupMapping[0].externalSite).toBe(
      Site.ANILIST_MANGA,
    );
    mocks.query.mockResolvedValueOnce({ lookupMapping: null });
    expect(
      await resolveKitsuIdByExternalIdsClient("manga", {
        anilistId: null,
        malId: 4,
      }),
    ).toBeNull();
    expect(mocks.query.mock.calls[3][0].lookupMapping[0].externalSite).toBe(
      Site.MYANIMELIST_MANGA,
    );
  });
  it("handles absent search containers and discards nodes without identifiers", async () => {
    expect(await searchAnimeByTitleClient("query")).toEqual([]);
    expect(await searchMangaByTitleClient("query")).toEqual([]);
    const nodes = [
      null,
      {},
      {
        id: "7",
        titles: {
          canonical: "C",
          translated: "T",
          romanized: "R",
          original: "J",
        },
        posterImage: { original: { url: "cover" } },
      },
      { id: "8" },
    ];
    mocks.query.mockResolvedValue({
      searchAnimeByTitle: { nodes },
      searchMangaByTitle: { nodes },
    });
    const expected = [
      {
        kitsuId: "7",
        rawId: "7",
        titleTranslated: "T",
        titleEn: "C",
        titleRomaji: "R",
        titleJp: "J",
        posterUrl: "cover",
      },
      {
        kitsuId: "8",
        rawId: "8",
        titleTranslated: null,
        titleEn: null,
        titleRomaji: null,
        titleJp: null,
        posterUrl: null,
      },
    ];
    expect(await searchAnimeByTitleClient("a")).toEqual(expected);
    expect(await searchMangaByTitleClient("m")).toEqual(expected);
    expect(mocks.query.mock.calls[2][0].searchAnimeByTitle[0]).toEqual({
      title: "a",
      first: 10,
    });
    expect(mocks.query.mock.calls[3][0].searchMangaByTitle[0]).toEqual({
      title: "m",
      first: 10,
    });
  });
  it("returns null for missing media rather than inventing resolve or detail payloads", async () => {
    for (const load of [
      getAnimeResolvePayloadBySlug,
      getMangaResolvePayloadBySlug,
      getAnimeSeriesDetailBySlug,
      getMangaSeriesDetailBySlug,
    ])
      expect(await load("missing")).toBeNull();
    expect(await resolveAniListIdByKitsuIdClient("anime", "1")).toBeNull();
    expect(await resolveAniListIdByKitsuIdClient("manga", "2")).toBeNull();
  });
  it("normalizes full resolve payloads and ignores nonnumeric/zero mapping IDs", async () => {
    const data = {
      titles: { canonical: "C", romanized: "R", original: "J" },
      episodeCount: 12,
      chapterCount: 0,
      chapterCountGuess: 99,
      volumeCount: 5,
      averageRating: 80,
      posterImage: { original: { url: "cover" } },
      bannerImage: { original: { url: "banner" } },
      mappings: {
        nodes: [
          null,
          { externalSite: Site.ANILIST_ANIME, externalId: "bad" },
          { externalSite: Site.ANILIST_ANIME, externalId: "0" },
          { externalSite: Site.ANILIST_ANIME, externalId: "10" },
          { externalSite: Site.MYANIMELIST_ANIME, externalId: "20" },
          { externalSite: Site.ANILIST_MANGA, externalId: "30" },
          { externalSite: Site.MYANIMELIST_MANGA, externalId: "40" },
        ],
      },
    };
    mocks.query.mockResolvedValue({ findAnimeById: data, findMangaById: data });
    expect(await getAnimeResolvePayloadBySlug("7")).toEqual({
      kitsuId: "7",
      anilistId: 10,
      malId: 20,
      titleEn: "C",
      titleRomaji: "R",
      titleJp: "J",
      episodeCount: 12,
      averageRating: 80,
      coverImageUrl: "cover",
      bannerImageUrl: "banner",
    });
    expect(await getMangaResolvePayloadBySlug("8")).toEqual({
      kitsuId: "8",
      anilistId: 30,
      malId: 40,
      titleEn: "C",
      titleRomaji: "R",
      titleJp: "J",
      chapterCount: 0,
      volumeCount: 5,
      averageRating: 80,
      coverImageUrl: "cover",
    });
    expect(await resolveAniListIdByKitsuIdClient("anime", "7")).toBe(10);
    expect(await resolveAniListIdByKitsuIdClient("manga", "8")).toBe(30);
  });
  it("retains sparse nullable fields and uses the chapter guess only when actual chapters are absent", async () => {
    mocks.query.mockResolvedValue({
      findAnimeById: {},
      findMangaById: { chapterCountGuess: 5 },
    });
    expect(await getAnimeResolvePayloadBySlug("1")).toMatchObject({
      kitsuId: "1",
      anilistId: null,
      malId: null,
      titleEn: null,
      episodeCount: null,
      bannerImageUrl: null,
    });
    expect(await getMangaResolvePayloadBySlug("2")).toMatchObject({
      chapterCount: 5,
      volumeCount: null,
      averageRating: null,
      coverImageUrl: null,
    });
    mocks.query.mockResolvedValue({ findMangaById: {} });
    expect(await getMangaResolvePayloadBySlug("2")).toMatchObject({
      chapterCount: null,
    });
  });
  it("builds series summaries and distinguishes unknown totals from a legitimate zero", async () => {
    const full = {
      titles: { canonical: "C", romanized: "R" },
      episodeCount: 12,
      chapterCount: 0,
      volumeCount: 5,
      posterImage: { original: { url: "cover" } },
      updatedAt: "2026-01-01",
    };
    mocks.query.mockResolvedValue({
      findAnimeBySlug: full,
      findMangaById: full,
    });
    expect(await getAnimeSeriesDetailBySlug("slug")).toEqual({
      kitsuId: "slug",
      titleEn: "C",
      titleRomaji: "R",
      episodeCount: 12,
      posterUrl: "cover",
      updatedAt: "2026-01-01",
    });
    expect(await getMangaSeriesDetailBySlug("2")).toEqual({
      kitsuId: "2",
      titleEn: "C",
      titleRomaji: "R",
      totalChapters: 0,
      totalVolumes: 5,
      totalsFromKitsu: true,
      posterUrl: "cover",
      updatedAt: "2026-01-01",
    });
    mocks.query.mockResolvedValue({
      findAnimeBySlug: { updatedAt: "now" },
      findMangaById: { updatedAt: "now" },
    });
    expect(await getAnimeSeriesDetailBySlug("s")).toMatchObject({
      titleEn: null,
      titleRomaji: null,
      episodeCount: null,
      posterUrl: null,
    });
    expect(await getMangaSeriesDetailBySlug("2")).toMatchObject({
      totalChapters: null,
      totalVolumes: null,
      totalsFromKitsu: false,
      posterUrl: null,
    });
    mocks.query.mockResolvedValue({ findMangaById: { chapterCountGuess: 4 } });
    expect(await getMangaSeriesDetailBySlug("2")).toMatchObject({
      totalChapters: 4,
      totalsFromKitsu: true,
    });
  });
  it("propagates transport errors to callers rather than returning misleading empty success", async () => {
    mocks.query.mockRejectedValue(new Error("provider down"));
    await expect(searchAnimeByTitleClient("q")).rejects.toThrow(
      "provider down",
    );
  });
});
