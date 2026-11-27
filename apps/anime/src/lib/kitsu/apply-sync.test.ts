import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KitsuLibraryEntry } from "./sync-payload";

const db = vi.hoisted(() => {
  const media = () => ({
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });
  const list = () => ({
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });
  return {
    anime: media(),
    manga: media(),
    animeListEntry: list(),
    mangaListEntry: list(),
  };
});
const cache = vi.hoisted(() => ({ anime: vi.fn(), manga: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/redis", () => ({
  invalidateAnimeTitleCache: cache.anime,
  invalidateMangaTitleCache: cache.manga,
}));

import { applyKitsuLibrarySync } from "./apply-sync";

function entry(overrides: Partial<KitsuLibraryEntry> = {}): KitsuLibraryEntry {
  return {
    id: "remote-entry",
    status: "CURRENT",
    progress: 3,
    rating: 14,
    updatedAt: "2026-01-02T00:00:00Z",
    notes: "notes",
    private: true,
    reconsuming: true,
    reconsumeCount: 2,
    media: {
      id: "kitsu-1",
      titles: {
        translated: "English",
        canonical: "Canonical",
        original: "日本語",
        romanized: "Romaji",
      },
      description: { en: "Synopsis" },
      status: "CURRENT",
      episodeCount: 12,
      chapterCount: 24,
      volumeCount: 3,
      averageRating: 80,
      posterImage: {
        original: { url: "https://example.invalid/cover.jpg?width=100" },
      },
      bannerImage: {
        original: { url: "https://example.invalid/banner.jpg?width=100" },
      },
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      mappings: {
        nodes: [
          { externalSite: "ANILIST_ANIME", externalId: "42" },
          { externalSite: "MYANIMELIST_ANIME", externalId: "52" },
        ],
      },
    },
    ...overrides,
  };
}
// Independent persisted fixtures: do not derive the expected result by first calling sync.
function storedMedia(kind: "anime" | "manga") {
  return {
    id: `local-${kind}`,
    kitsuId: "kitsu-1",
    anilistId: 42,
    malId: 52,
    titleEn: "English",
    titleJp: "日本語",
    titleRomaji: "Romaji",
    synopsis: "Synopsis",
    coverImageUrl: "https://example.invalid/cover.jpg",
    showStatus: "AIRING",
    averageRating: 80,
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-12-31"),
    ...(kind === "anime"
      ? {
          bannerImageUrl: "https://example.invalid/banner.jpg",
          episodeCount: 12,
        }
      : { chapterCount: 24, volumeCount: 3 }),
  };
}
function storedListEntry(kind: "anime" | "manga") {
  return {
    id: "local-entry",
    kitsuEntryId: "remote-entry",
    progress: 3,
    rating: 14,
    notes: "notes",
    private: true,
    updatedAt: new Date("2026-01-01"),
    ...(kind === "anime"
      ? {
          animeId: "local-anime",
          watchStatus: "WATCHING",
          rewatching: true,
          rewatchCount: 2,
        }
      : {
          mangaId: "local-manga",
          readStatus: "READING",
          progressVolumes: 0,
          rereading: true,
          rereadCount: 2,
        }),
  };
}
async function sync(kind: "anime" | "manga", value: KitsuLibraryEntry) {
  return applyKitsuLibrarySync({
    slug: "test",
    anime: kind === "anime" ? [value] : [],
    manga: kind === "manga" ? [value] : [],
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const kind of ["anime", "manga"] as const) {
    db[kind].findUnique.mockResolvedValue(null);
    db[kind].create.mockImplementation(async ({ data }) => ({
      id: `local-${kind}`,
      ...data,
    }));
    db[kind].update.mockImplementation(async ({ data }) => ({
      id: `local-${kind}`,
      ...data,
    }));
    db[
      kind === "anime" ? "animeListEntry" : "mangaListEntry"
    ].findUnique.mockResolvedValue(null);
  }
});

describe.each(["anime", "manga"] as const)("Kitsu %s sync", (kind) => {
  const listKind = kind === "anime" ? "animeListEntry" : "mangaListEntry";
  it("normalizes provider fields, identifiers and list state and invalidates the changed title", async () => {
    const result = await sync(kind, entry());
    expect(result.errors).toEqual([]);
    expect(result[`${kind}Synced`]).toBe(1);
    expect(result[`${kind}Changed`]).toBe(1);
    expect(db[kind].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kitsuId: "kitsu-1",
        anilistId: 42,
        malId: 52,
        titleEn: "English",
        titleJp: "日本語",
        titleRomaji: "Romaji",
        synopsis: "Synopsis",
        coverImageUrl: "https://example.invalid/cover.jpg",
        showStatus: "AIRING",
        averageRating: 80,
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-12-31"),
      }),
    });
    expect(db[listKind].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kitsuEntryId: "remote-entry",
        progress: 3,
        rating: 14,
        notes: "notes",
        private: true,
        updatedAt: new Date("2026-01-02"),
        ...(kind === "anime"
          ? {
              animeId: "local-anime",
              watchStatus: "WATCHING",
              rewatching: true,
              rewatchCount: 2,
            }
          : {
              mangaId: "local-manga",
              readStatus: "READING",
              progressVolumes: 0,
              rereading: true,
              rereadCount: 2,
            }),
      }),
    });
    expect(cache[kind]).toHaveBeenCalledWith(`local-${kind}`, "kitsu-1");
  });
  it.each([
    ["PLANNED", kind === "anime" ? "PLAN_TO_WATCH" : "PLAN_TO_READ"],
    ["COMPLETED", "COMPLETED"],
    ["ON_HOLD", "ON_HOLD"],
    ["DROPPED", "DROPPED"],
    ["UNRECOGNIZED", kind === "anime" ? "PLAN_TO_WATCH" : "PLAN_TO_READ"],
  ])(
    "maps library state %s without relying on enum ordinal values",
    async (remote, local) => {
      await sync(kind, entry({ status: remote }));
      expect(
        db[listKind].create.mock.calls[0][0].data[
          kind === "anime" ? "watchStatus" : "readStatus"
        ],
      ).toBe(local);
    },
  );
  it("uses canonical title and multilingual description fallbacks and omits unusable IDs", async () => {
    const value = entry();
    value.media = {
      id: "kitsu-1",
      titles: { canonical: "Canonical" },
      description: { ja: "説明" },
      mappings: {
        nodes: [{ externalSite: "ANILIST", externalId: "not-a-number" }],
      },
    };
    await sync(kind, value);
    expect(db[kind].create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        titleEn: "Canonical",
        titleJp: null,
        titleRomaji: null,
        synopsis: "説明",
        coverImageUrl: null,
        showStatus: "UNKNOWN",
        startDate: null,
        endDate: null,
      }),
    });
    expect(db[kind].create.mock.calls[0][0].data).not.toHaveProperty(
      "anilistId",
    );
    expect(db[kind].create.mock.calls[0][0].data).not.toHaveProperty("malId");
  });
  it.each([
    ["FINISHED", "FINISHED"],
    ["UPCOMING", "UPCOMING"],
    ["TBA", "UPCOMING"],
    ["UNRELEASED", "UPCOMING"],
  ])("maps media publication state %s", async (status, expected) => {
    const value = entry();
    value.media.status = status;
    await sync(kind, value);
    expect(db[kind].create.mock.calls[0][0].data.showStatus).toBe(expected);
  });
  it("falls back to Unknown and safe list defaults for sparse provider payloads", async () => {
    await sync(kind, { id: "sparse", media: { id: "kitsu-1" } });
    expect(db[kind].create.mock.calls[0][0].data).toMatchObject({
      titleEn: "Unknown",
      synopsis: null,
      averageRating: null,
    });
    expect(db[listKind].create.mock.calls[0][0].data).toMatchObject({
      progress: 0,
      rating: null,
      notes: null,
      private: false,
    });
  });
  it("rejects negative progress before writing any records", async () => {
    const result = await sync(kind, entry({ progress: -1 }));
    expect(result.errors).toEqual([
      expect.stringContaining("invalid progress"),
    ]);
    expect(db[kind].findUnique).not.toHaveBeenCalled();
    expect(db[kind].create).not.toHaveBeenCalled();
  });
  it.each([
    ["kitsuId", "other"],
    ["anilistId", 999],
    ["malId", 999],
  ])(
    "refuses conflicting %s rather than overwriting another identity",
    async (key, value) => {
      db[kind].findUnique.mockResolvedValue({
        id: "existing",
        kitsuId: "kitsu-1",
        anilistId: 42,
        malId: 52,
        [key]: value,
      });
      const result = await sync(kind, entry());
      expect(result.errors).toEqual([expect.stringContaining("conflicting")]);
      expect(db[kind].update).not.toHaveBeenCalled();
      expect(db[listKind].create).not.toHaveBeenCalled();
    },
  );
  it("matches an unlinked local record by AniList ID and preserves its existing identifier", async () => {
    db[kind].findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "existing",
      kitsuId: null,
      anilistId: 42,
      malId: 52,
    });
    await sync(kind, entry());
    expect(db[kind].findUnique.mock.calls.slice(0, 2)).toEqual([
      [{ where: { kitsuId: "kitsu-1" } }],
      [{ where: { anilistId: 42 } }],
    ]);
    expect(db[kind].update.mock.calls[0][0]).toMatchObject({
      where: { id: "existing" },
      data: { kitsuId: "kitsu-1" },
    });
    expect(db[kind].update.mock.calls[0][0].data).not.toHaveProperty(
      "anilistId",
    );
  });
  it("falls back to MyAnimeList ID when no Kitsu/AniList record matches", async () => {
    db[kind].findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "existing",
        kitsuId: null,
        anilistId: null,
        malId: 52,
      });
    await sync(kind, entry());
    expect(db[kind].findUnique).toHaveBeenNthCalledWith(3, {
      where: { malId: 52 },
    });
    expect(db[kind].create).not.toHaveBeenCalled();
  });
  it("does not overwrite newer local progress with a stale provider entry", async () => {
    db[listKind].findUnique.mockResolvedValue({
      id: "local-entry",
      updatedAt: new Date("2026-02-01"),
      progress: 9,
    });
    await sync(kind, entry());
    expect(db[listKind].update).not.toHaveBeenCalled();
    expect(db[listKind].create).not.toHaveBeenCalled();
  });
  it("avoids needless writes/invalidation for an identical newer provider snapshot", async () => {
    await sync(kind, entry());
    const storedMedia = {
      id: `local-${kind}`,
      ...db[kind].create.mock.calls[0][0].data,
    };
    const storedEntry = {
      id: "local-entry",
      ...db[listKind].create.mock.calls[0][0].data,
      updatedAt: new Date("2026-01-01"),
    };
    vi.clearAllMocks();
    db[kind].findUnique.mockResolvedValue(storedMedia);
    db[listKind].findUnique.mockResolvedValue(storedEntry);
    const result = await sync(kind, entry());
    expect(result[`${kind}Changed`]).toBe(0);
    expect(db[kind].update).not.toHaveBeenCalled();
    expect(db[listKind].update).not.toHaveBeenCalled();
    expect(cache[kind]).not.toHaveBeenCalled();
  });
  it("rejects invalid external numeric IDs before database lookup", async () => {
    const value = entry();
    value.media.mappings = {
      nodes: [{ externalSite: "ANILIST", externalId: "-1" }],
    };
    const result = await sync(kind, value);
    expect(result.errors).toEqual([
      expect.stringContaining("invalid anilistId"),
    ]);
    expect(db[kind].findUnique).not.toHaveBeenCalled();
  });
  it.each(
    kind === "anime"
      ? [
          "titleEn",
          "titleJp",
          "titleRomaji",
          "synopsis",
          "coverImageUrl",
          "bannerImageUrl",
          "episodeCount",
          "showStatus",
          "averageRating",
          "startDate",
          "endDate",
        ]
      : [
          "titleEn",
          "titleJp",
          "titleRomaji",
          "synopsis",
          "coverImageUrl",
          "chapterCount",
          "volumeCount",
          "showStatus",
          "averageRating",
          "startDate",
          "endDate",
        ],
  )(
    "refreshes changed media field %s and invalidates its title cache",
    async (field) => {
      const expectedMedia = storedMedia(kind);
      const expected = (expectedMedia as Record<string, unknown>)[field];
      const stored = {
        ...expectedMedia,
        [field]: field === "showStatus" ? "FINISHED" : null,
      };
      const savedEntry = storedListEntry(kind);
      db[kind].findUnique.mockResolvedValue(stored);
      db[listKind].findUnique.mockResolvedValue(savedEntry);
      await sync(kind, entry());
      expect(db[kind].update).toHaveBeenCalledTimes(1);
      const written = db[kind].update.mock.calls[0][0].data[field];
      expect(written).toEqual(expected);
      expect(cache[kind]).toHaveBeenCalledTimes(1);
    },
  );
  it.each(
    kind === "anime"
      ? [
          "watchStatus",
          "progress",
          "rating",
          "notes",
          "private",
          "rewatching",
          "rewatchCount",
          "kitsuEntryId",
        ]
      : [
          "readStatus",
          "progress",
          "rating",
          "notes",
          "private",
          "rereading",
          "rereadCount",
          "kitsuEntryId",
        ],
  )(
    "synchronizes a changed library field %s without rewriting media",
    async (field) => {
      const expectedEntry = storedListEntry(kind);
      const expected = (expectedEntry as Record<string, unknown>)[field];
      const stored = storedMedia(kind);
      const differences: Record<string, unknown> = {
        watchStatus: "PLAN_TO_WATCH",
        readStatus: "PLAN_TO_READ",
        progress: 0,
        rating: null,
        notes: null,
        private: false,
        rewatching: false,
        rereading: false,
        rewatchCount: 0,
        rereadCount: 0,
        kitsuEntryId: null,
      };
      const savedEntry = {
        ...expectedEntry,
        [field]: differences[field],
      };
      vi.clearAllMocks();
      db[kind].findUnique.mockResolvedValue(stored);
      db[listKind].findUnique.mockResolvedValue(savedEntry);
      await sync(kind, entry());
      expect(db[listKind].update).toHaveBeenCalledTimes(1);
      expect(db[listKind].update.mock.calls[0][0].where).toEqual({
        id: "local-entry",
      });
      expect(db[listKind].update.mock.calls[0][0].data[field]).toEqual(
        expected,
      );
      expect(db[kind].update).not.toHaveBeenCalled();
    },
  );
});
it("continues after individual provider/database failures and reports errors by media type", async () => {
  db.anime.create.mockRejectedValueOnce(new Error("database unavailable"));
  db.manga.create.mockRejectedValueOnce("rejected");
  const result = await applyKitsuLibrarySync({
    slug: "test",
    anime: [entry(), entry({ id: "second" })],
    manga: [entry()],
  });
  expect(result).toMatchObject({
    animeSynced: 1,
    mangaSynced: 0,
    animeChanged: 1,
    errors: [
      "anime remote-entry: database unavailable",
      "manga remote-entry: rejected",
    ],
  });
});

describe("Kitsu optional provider metadata", () => {
  it.each(["anime", "manga"] as const)(
    "accepts a missing local update timestamp for %s",
    async (kind) => {
      await sync(kind, entry());
      const listKind = kind === "anime" ? "animeListEntry" : "mangaListEntry";
      const record = {
        id: `local-${kind}`,
        ...db[kind].create.mock.calls[0][0].data,
      };
      const saved = {
        id: "existing",
        ...db[listKind].create.mock.calls[0][0].data,
        progress: 0,
        updatedAt: null,
      };
      vi.clearAllMocks();
      db[kind].findUnique.mockResolvedValue(record);
      db[listKind].findUnique.mockResolvedValue(saved);
      await sync(kind, entry());
      expect(db[listKind].update).toHaveBeenCalledWith({
        where: { id: "existing" },
        data: expect.objectContaining({ progress: 3 }),
      });
    },
  );
  it("accepts a provider snapshot without an update timestamp and assigns a current timestamp", async () => {
    await sync("anime", entry());
    const record = {
      id: "local-anime",
      ...db.anime.create.mock.calls[0][0].data,
    };
    const saved = {
      id: "existing",
      ...db.animeListEntry.create.mock.calls[0][0].data,
      progress: 0,
    };
    vi.clearAllMocks();
    db.anime.findUnique.mockResolvedValue(record);
    db.animeListEntry.findUnique.mockResolvedValue(saved);
    await sync("anime", entry({ updatedAt: null }));
    expect(db.animeListEntry.update).toHaveBeenCalledWith({
      where: { id: "existing" },
      data: expect.objectContaining({
        progress: 3,
        updatedAt: expect.any(Date),
      }),
    });
  });
  it.each([null, {}, { en_jp: "Romaji description" }] as (Record<
    string,
    string
  > | null)[])(
    "handles absent/empty/non-English descriptions",
    async (description) => {
      const value = entry();
      value.media.description = description;
      await sync("anime", value);
      expect(db.anime.create.mock.calls[0][0].data.synopsis).toBe(
        description && "en_jp" in description ? "Romaji description" : null,
      );
    },
  );
  it("preserves non-Error failures as a useful per-entry message", async () => {
    db.anime.create.mockRejectedValueOnce("write rejected");
    expect((await sync("anime", entry())).errors).toEqual([
      "anime remote-entry: write rejected",
    ]);
  });
});
