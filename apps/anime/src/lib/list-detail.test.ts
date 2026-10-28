import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ library: vi.fn(), provider: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/library", () => ({ getLibrarySnapshot: mocks.library }));
vi.mock("@/lib/provider-metadata", () => ({
  getProviderSnapshot: mocks.provider,
}));

import { getAnimeListSnapshot, getMangaListSnapshot } from "./list";
import { getAnimeDetailSnapshot, getMangaDetailSnapshot } from "./media-detail";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.library.mockResolvedValue({ anime: [], manga: [] });
  mocks.provider.mockResolvedValue(null);
});

describe("library list and detail projections", () => {
  it("excludes collection-only items, strips collections and counts repeated status groups", async () => {
    mocks.library.mockResolvedValue({
      anime: [
        {
          id: "a",
          listEntry: { watchStatus: "WATCHING" },
          collectionItems: [1],
        },
        { id: "b", listEntry: null, collectionItems: [2] },
        {
          id: "c",
          listEntry: { watchStatus: "WATCHING" },
          collectionItems: [],
        },
        {
          id: "d",
          listEntry: { watchStatus: "COMPLETED" },
          collectionItems: [],
        },
      ],
      manga: [
        { id: "m", listEntry: { readStatus: "READING" }, collectionItems: [] },
        { id: "n", listEntry: { readStatus: "READING" }, collectionItems: [] },
        { id: "o", listEntry: null, collectionItems: [1] },
      ],
    });
    expect(await getAnimeListSnapshot()).toEqual({
      items: [
        { id: "a", listEntry: { watchStatus: "WATCHING" } },
        { id: "c", listEntry: { watchStatus: "WATCHING" } },
        { id: "d", listEntry: { watchStatus: "COMPLETED" } },
      ],
      counts: { ALL: 3, WATCHING: 2, COMPLETED: 1 },
    });
    expect((await getMangaListSnapshot()).counts).toEqual({
      ALL: 2,
      READING: 2,
    });
  });
  it("returns an explicit zero total for an empty library", async () => {
    expect(await getAnimeListSnapshot()).toEqual({
      items: [],
      counts: { ALL: 0 },
    });
    expect(await getMangaListSnapshot()).toEqual({
      items: [],
      counts: { ALL: 0 },
    });
  });
  it.each(["", "0", "-1", "12345678901", "../1", "cshort", "1?token=a"])(
    "rejects detail identifier %s before touching the library/provider",
    async (id) => {
      expect(await getAnimeDetailSnapshot(id)).toBeNull();
      expect(await getMangaDetailSnapshot(id)).toBeNull();
      expect(mocks.library).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
    },
  );
  it("uses local details before provider fallback and converts Prisma dates to serializable UTC", async () => {
    const common = {
      id: `c${"a".repeat(24)}`,
      kitsuId: "12",
      anilistId: 1,
      titleEn: "A",
      titleJp: "B",
      titleRomaji: "C",
      synopsis: "Plot",
      coverImageUrl: "cover",
      showStatus: "FINISHED",
      averageRating: 80,
      startDate: new Date("2020-01-01Z"),
      endDate: null,
    };
    mocks.library.mockResolvedValue({
      anime: [{ ...common, bannerImageUrl: "banner", episodeCount: 12 }],
      manga: [{ ...common, chapterCount: 50, volumeCount: 5 }],
    });
    expect(await getAnimeDetailSnapshot("12")).toEqual({
      ...common,
      bannerImageUrl: "banner",
      episodeCount: 12,
      chapterCount: null,
      volumeCount: null,
      startDate: "2020-01-01T00:00:00.000Z",
    });
    expect(await getMangaDetailSnapshot(common.id)).toEqual({
      ...common,
      bannerImageUrl: null,
      episodeCount: null,
      chapterCount: 50,
      volumeCount: 5,
      startDate: "2020-01-01T00:00:00.000Z",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    mocks.library.mockResolvedValue({
      anime: [{ ...common, startDate: null, endDate: new Date("2021-01-01Z") }],
      manga: [{ ...common, startDate: null, endDate: new Date("2021-01-01Z") }],
    });
    expect(await getAnimeDetailSnapshot("12")).toMatchObject({
      startDate: null,
      endDate: "2021-01-01T00:00:00.000Z",
    });
    expect(await getMangaDetailSnapshot("12")).toMatchObject({
      startDate: null,
      endDate: "2021-01-01T00:00:00.000Z",
    });
  });
  it("delegates only valid uncatalogued identifiers to the right provider kind", async () => {
    mocks.provider.mockResolvedValue({ id: "remote" });
    expect(await getAnimeDetailSnapshot("42")).toEqual({ id: "remote" });
    expect(await getMangaDetailSnapshot("43")).toEqual({ id: "remote" });
    expect(mocks.provider.mock.calls).toEqual([
      ["anime", "42"],
      ["manga", "43"],
    ]);
  });
});
