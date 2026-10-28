import { afterEach, describe, expect, it, vi } from "vitest";
import { formatContiguousRanges } from "./formatRanges";
import { getLibraryPageTitle } from "./library-page-title";
import {
  formatHalfStepRatingOutOfTen,
  normalizeListRatingToTen,
} from "./media-display";
import {
  getAnimeDetailPath,
  getMangaDetailPath,
  slugifyTitle,
} from "./media-routing";
import { anilistFuzzyDate, cleanString } from "./media-values";
import {
  selectTitleFromAniList,
  validateAnimeListEntry,
  validateMangaListEntry,
  validateMediaRecord,
} from "./validation";

afterEach(() => vi.unstubAllEnvs());

describe("display and route contracts", () => {
  it("deduplicates and sorts ranges without mutating provider progress data", () => {
    const input = [8, 3, 2, 1, 6, 5, 3];
    expect(formatContiguousRanges(input)).toBe("1-3, 5-6, 8");
    expect(input).toEqual([8, 3, 2, 1, 6, 5, 3]);
    expect(formatContiguousRanges([])).toBe("");
    expect(formatContiguousRanges([0])).toBe("0");
  });
  it("normalizes ratings without confusing zero, unknown and half-step display", () => {
    expect([undefined, null, Number.NaN].map(normalizeListRatingToTen)).toEqual(
      [null, null, null],
    );
    expect([0, 1, 15, 20].map(normalizeListRatingToTen)).toEqual([
      0, 0.5, 7.5, 10,
    ]);
    expect([null, 0, 7.5, 10].map(formatHalfStepRatingOutOfTen)).toEqual([
      "Unknown",
      "0/10",
      "7.5/10",
      "10/10",
    ]);
  });
  it("builds stable safe slugs and falls back through translated titles and local IDs", () => {
    expect(slugifyTitle("  Café / déjà--vu!  ")).toBe("cafe-deja-vu");
    expect(slugifyTitle("日本語 🎬")).toBe("untitled");
    const media = {
      id: "local",
      kitsuId: "42",
      titleEn: " English ",
      titleRomaji: "Romaji",
      titleJp: "日本語",
    };
    expect(getAnimeDetailPath(media)).toBe("/anime/english/42");
    expect(
      getMangaDetailPath({
        ...media,
        kitsuId: null,
        titleEn: " ",
        titleRomaji: " Romaji ",
      }),
    ).toBe("/manga/romaji/local");
    expect(
      getAnimeDetailPath({ ...media, titleEn: null, titleRomaji: null }),
    ).toBe("/anime/untitled/42");
    expect(
      getAnimeDetailPath({
        ...media,
        titleEn: null,
        titleRomaji: null,
        titleJp: null,
      }),
    ).toBe("/anime/untitled/42");
  });
  it("uses a trimmed optional display name across both library kinds", () => {
    vi.stubEnv("NEXT_PUBLIC_LIST_DISPLAYNAME", "  Yuki  ");
    expect(getLibraryPageTitle("anime", "list")).toBe("Yuki's Anime List");
    expect(getLibraryPageTitle("manga", "collection")).toBe(
      "Yuki's Manga Collection",
    );
    vi.stubEnv("NEXT_PUBLIC_LIST_DISPLAYNAME", " ");
    expect(getLibraryPageTitle("anime", "collection")).toBe("Anime Collection");
  });
  it("cleans unknown provider text and preserves partial UTC dates", () => {
    expect([null, undefined, 1, {}, " "].map(cleanString)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(cleanString("  A title  ")).toBe("A title");
    expect(anilistFuzzyDate(undefined)).toBeNull();
    expect(anilistFuzzyDate({ year: "2026" })).toBeNull();
    expect(anilistFuzzyDate({ year: 2024 })).toBe("2024-01-01T00:00:00.000Z");
    expect(anilistFuzzyDate({ year: 2024, month: 2 })).toBe(
      "2024-02-01T00:00:00.000Z",
    );
    expect(anilistFuzzyDate({ year: 2024, month: 2, day: 29 })).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });
});

describe("sync input validation", () => {
  it("accepts empty optional progress and inclusive rating boundaries", () => {
    expect(validateAnimeListEntry({})).toEqual([]);
    expect(
      validateAnimeListEntry({ progress: 0, rating: 0, rewatchCount: 0 }),
    ).toEqual([]);
    expect(
      validateMangaListEntry({
        progress: 10,
        progressVolumes: 2,
        rating: 20,
        rereadCount: 1,
      }),
    ).toEqual([]);
  });
  it("reports every invalid progress/rating field instead of short-circuiting", () => {
    expect(
      validateAnimeListEntry({ progress: -1, rating: 21, rewatchCount: 0.5 }),
    ).toEqual(["invalid progress", "invalid rating", "invalid rewatch count"]);
    expect(
      validateMangaListEntry({
        progress: 1.5,
        progressVolumes: -1,
        rating: -1,
        rereadCount: -2,
      }),
    ).toEqual([
      "invalid progress",
      "invalid progress volumes",
      "invalid rating",
      "invalid reread count",
    ]);
    expect(
      validateAnimeListEntry({ progress: Number.NaN, rating: Number.NaN }),
    ).toEqual(["invalid progress", "invalid rating"]);
  });
  it("requires titles and rejects zero/negative external identifiers", () => {
    expect(
      validateMediaRecord({
        titleEn: "Title",
        anilistId: null,
        malId: undefined,
      }),
    ).toEqual([]);
    expect(
      validateMediaRecord({ titleEn: "Title", anilistId: 1, malId: 2 }),
    ).toEqual([]);
    expect(validateMediaRecord({ anilistId: 0, malId: -1 })).toEqual([
      "invalid anilistId",
      "invalid malId",
      "missing title",
    ]);
  });
  it("reports title fallback provenance for provider schema changes", () => {
    expect(selectTitleFromAniList("English", "Romaji", "Native")).toEqual({
      title: "English",
      fallbackUsed: null,
    });
    expect(selectTitleFromAniList(null, "Romaji", "Native")).toEqual({
      title: "Romaji",
      fallbackUsed: "romaji",
    });
    expect(selectTitleFromAniList("", null, "Native")).toEqual({
      title: "Native",
      fallbackUsed: "native",
    });
    expect(selectTitleFromAniList(undefined, undefined, undefined)).toEqual({
      title: null,
      fallbackUsed: "missing_all",
    });
  });
});
