import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const media = () => ({
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });
  const list = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  });
  return {
    db: {
      anime: media(),
      manga: media(),
      animeListEntry: list(),
      mangaListEntry: list(),
      syncLog: { update: vi.fn() },
    },
    token: vi.fn(),
    query: vi.fn(),
    invalidateAnime: vi.fn(),
    invalidateManga: vi.fn(),
    fetch: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ default: fake.db }));
vi.mock("@/lib/provider-links", () => ({ getToken: fake.token }));
vi.mock("@/lib/redis", () => ({
  invalidateAnimeTitleCache: fake.invalidateAnime,
  invalidateMangaTitleCache: fake.invalidateManga,
}));
vi.mock("./thunder", () => ({ anilistThunder: () => fake.query }));

import { pullAniList, pushAniList } from "./sync";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    status: "CURRENT",
    progress: 4,
    progressVolumes: 1,
    score: 7.5,
    notes: "remote",
    repeat: 2,
    private: true,
    updatedAt: 1767312000,
    startedAt: { year: 2025, month: 2, day: 3 },
    completedAt: { year: 2025 },
    media: {
      id: 42,
      idMal: 52,
      title: { english: "English", romaji: "Romaji", native: "日本語" },
      description: "Description",
      episodes: 12,
      chapters: 24,
      volumes: 3,
      status: "RELEASING",
      coverImage: {
        large: "https://example.invalid/large.jpg",
        medium: "https://example.invalid/medium.jpg",
      },
      bannerImage: "https://example.invalid/banner.jpg",
      averageScore: 80,
      startDate: { year: 2025, month: 2, day: 3 },
      endDate: null,
    },
    ...overrides,
  };
}
function local(
  kind: "anime" | "manga",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `entry-${kind}`,
    progress: 4,
    progressVolumes: 1,
    rating: 15,
    notes: "remote",
    private: true,
    rewatchCount: 2,
    rereadCount: 2,
    watchStatus: "WATCHING",
    readStatus: "READING",
    [kind]: {
      id: `media-${kind}`,
      anilistId: 42,
      malId: 52,
      titleEn: "English",
      episodeCount: 12,
      chapterCount: 24,
    },
    ...overrides,
  };
}
function pages(anime: unknown[] = [], manga: unknown[] = []) {
  fake.query.mockImplementation(async (selection) => ({
    Page: {
      pageInfo: { hasNextPage: false },
      mediaList:
        selection.Page[1].mediaList[0].type === "ANIME" ? anime : manga,
    },
  }));
}
function reply(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
}
function mutationBody(index = 0) {
  return JSON.parse(fake.fetch.mock.calls[index][1].body);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ANILIST_USERNAME", "");
  vi.stubGlobal("fetch", fake.fetch);
  for (const name of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, name).mockImplementation(() => {});
  fake.token.mockResolvedValue({
    username: "test-user",
    accessToken: "isolated-test-token",
  });
  pages();
  for (const kind of ["anime", "manga"] as const) {
    fake.db[kind].findUnique.mockResolvedValue(null);
    fake.db[kind].create.mockImplementation(async ({ data }) => ({
      id: `media-${kind}`,
      ...data,
    }));
    fake.db[kind].update.mockImplementation(async ({ data }) => ({
      id: `media-${kind}`,
      ...data,
    }));
    const list =
      fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"];
    list.findUnique.mockResolvedValue(null);
    list.findMany.mockResolvedValue([]);
  }
  fake.fetch.mockImplementation(async (_url, options) => {
    const { query } = JSON.parse(options.body);
    const data: Record<string, unknown> = {};
    for (const match of query.matchAll(/(s\d+): SaveMediaListEntry/g))
      data[match[1]] = { id: 900 + Number(match[1].slice(1)) };
    return reply(data);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AniList pull", () => {
  it("requires a configured username without making a provider request", async () => {
    fake.token.mockResolvedValue(null);
    await expect(pullAniList("log")).rejects.toThrow(
      "No AniList username configured",
    );
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("accepts the explicit public username when no linked username exists", async () => {
    fake.token.mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_ANILIST_USERNAME", "public-user");
    await pullAniList("log");
    expect(fake.query.mock.calls[0][0].Page[1].mediaList[0].userName).toBe(
      "public-user",
    );
  });
  it.each(["anime", "manga"] as const)(
    "normalizes new %s details, dates, rating scale and list state",
    async (kind) => {
      pages(kind === "anime" ? [item()] : [], kind === "manga" ? [item()] : []);
      await pullAniList("log");
      expect(fake.db[kind].create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          anilistId: 42,
          malId: 52,
          titleEn: "English",
          synopsis: "Description",
          showStatus: "AIRING",
          averageRating: 8,
          coverImageUrl: "https://example.invalid/large.jpg",
          startDate: new Date(2025, 1, 3),
          endDate: null,
        }),
      });
      expect(
        fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"].upsert,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            anilistEntryId: 100,
            progress: 4,
            rating: 15,
            notes: "remote",
            private: true,
            startedAt: new Date(2025, 1, 3),
            completedAt: new Date(2025, 0, 1),
          }),
        }),
      );
      expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
        status: "COMPLETED",
        [`${kind}Synced`]: 1,
        errors: [],
      });
    },
  );
  it.each([
    ["CURRENT", "WATCHING", "READING"],
    ["REPEATING", "WATCHING", "READING"],
    ["PLANNING", "PLAN_TO_WATCH", "PLAN_TO_READ"],
    ["COMPLETED", "COMPLETED", "COMPLETED"],
    ["PAUSED", "ON_HOLD", "ON_HOLD"],
    ["DROPPED", "DROPPED", "DROPPED"],
    [null, "PLAN_TO_WATCH", "PLAN_TO_READ"],
  ])(
    "maps remote status %s for anime and manga",
    async (remote, anime, manga) => {
      pages([item({ status: remote })], [item({ status: remote })]);
      await pullAniList("log");
      expect(
        fake.db.animeListEntry.upsert.mock.calls[0][0].update.watchStatus,
      ).toBe(anime);
      expect(
        fake.db.mangaListEntry.upsert.mock.calls[0][0].update.readStatus,
      ).toBe(manga);
      expect(
        fake.db.animeListEntry.upsert.mock.calls[0][0].update.rewatching,
      ).toBe(remote === "REPEATING");
    },
  );
  it.each(["romaji", "native"])(
    "falls back to the %s title when English is missing",
    async (source) => {
      const value = item();
      value.media.title = {
        english: null,
        romaji: source === "romaji" ? "Fallback" : null,
        native: "Fallback",
      } as unknown as typeof value.media.title;
      pages([value]);
      await pullAniList("log");
      expect(fake.db.anime.create.mock.calls[0][0].data.titleEn).toBe(
        "Fallback",
      );
    },
  );
  it("skips missing/invalid media and entry data before database writes", async () => {
    pages([
      item({ media: null }),
      item({ media: { id: -1, title: {} } }),
      item({ progress: -1 }),
      item({ score: 11 }),
    ]);
    await pullAniList("log");
    expect(fake.db.anime.create).not.toHaveBeenCalled();
    expect(fake.db.animeListEntry.upsert).not.toHaveBeenCalled();
  });
  it.each(["anime", "manga"] as const)(
    "preserves Kitsu details/local rating and only raises %s counts",
    async (kind) => {
      const model = {
        id: "existing",
        kitsuId: "kitsu",
        titleEn: "Local title",
        episodeCount: 1,
        chapterCount: 1,
        volumeCount: 1,
      };
      fake.db[kind].findUnique.mockResolvedValue(model);
      fake.db[kind].update.mockImplementation(async ({ data }) => ({
        ...model,
        ...data,
      }));
      const list =
        fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"];
      list.findUnique.mockResolvedValue({
        id: "existing-entry",
        rating: 17,
        updatedAt: new Date("2020-01-01"),
        progress: 0,
      });
      pages(kind === "anime" ? [item()] : [], kind === "manga" ? [item()] : []);
      await pullAniList("log");
      expect(fake.db[kind].update.mock.calls[0][0].data).toEqual(
        kind === "anime"
          ? { episodeCount: 12 }
          : { chapterCount: 24, volumeCount: 3 },
      );
      expect(list.upsert.mock.calls[0][0].update.rating).toBe(17);
      expect(
        kind === "anime" ? fake.invalidateAnime : fake.invalidateManga,
      ).toHaveBeenCalledWith("existing", "kitsu");
    },
  );
  it.each(["anime", "manga"] as const)(
    "retains newer local %s list state but refreshes the provider entry ID",
    async (kind) => {
      fake.db[kind].findUnique.mockResolvedValue({
        id: "existing",
        episodeCount: 100,
        chapterCount: 100,
        volumeCount: 100,
      });
      const list =
        fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"];
      list.findUnique.mockResolvedValue({
        rating: 20,
        updatedAt: new Date("2030-01-01"),
      });
      pages(kind === "anime" ? [item()] : [], kind === "manga" ? [item()] : []);
      await pullAniList("log");
      expect(list.upsert).not.toHaveBeenCalled();
      expect(list.update).toHaveBeenCalledWith({
        where: { [`${kind}Id`]: "existing" },
        data: { anilistEntryId: 100 },
      });
      expect(fake.db[kind].update).not.toHaveBeenCalled();
    },
  );
  it("paginates both types and treats a missing Page as the end", async () => {
    fake.query
      .mockResolvedValueOnce({
        Page: { pageInfo: { hasNextPage: true }, mediaList: [] },
      })
      .mockResolvedValueOnce({ Page: { mediaList: [] } })
      .mockResolvedValueOnce({ Page: null });
    await pullAniList("log");
    expect(fake.query.mock.calls.map(([q]) => q.Page[0].page)).toEqual([
      1, 2, 1,
    ]);
    expect(fake.db.syncLog.update.mock.calls[0][0].data.status).toBe(
      "COMPLETED",
    );
  });
  it("isolates failed entries and reports bounded useful Prisma errors", async () => {
    fake.db.anime.create.mockRejectedValueOnce(
      new Error("Invalid `prisma.anime.create()` invocation\ninternal detail"),
    );
    pages([item(), item({ id: 101 })]);
    await pullAniList("log");
    expect(fake.db.animeListEntry.upsert).toHaveBeenCalledTimes(1);
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      errors: ["anime 42: Invalid create()"],
    });
  });
});

describe("AniList publication normalization", () => {
  it.each([
    ["FINISHED", "FINISHED"],
    ["NOT_YET_RELEASED", "UPCOMING"],
    ["CANCELLED", "CANCELLED"],
    ["HIATUS", "UNKNOWN"],
    [null, "UNKNOWN"],
  ])("maps provider media state %s", async (remote, expected) => {
    const value = item();
    value.media.status = remote as typeof value.media.status;
    pages([value]);
    await pullAniList("log");
    expect(fake.db.anime.create.mock.calls[0][0].data.showStatus).toBe(
      expected,
    );
  });
  it("handles sparse media fields, native title and absent rating/date fields", async () => {
    pages([
      item({
        score: null,
        startedAt: null,
        completedAt: null,
        media: { id: 42, title: { native: "日本語" } },
      }),
    ]);
    await pullAniList("log");
    expect(fake.db.anime.create.mock.calls[0][0].data).toMatchObject({
      titleEn: "日本語",
      titleJp: "日本語",
      titleRomaji: null,
      synopsis: null,
      coverImageUrl: null,
      averageRating: null,
      startDate: null,
      endDate: null,
    });
    expect(fake.db.animeListEntry.upsert.mock.calls[0][0].update).toMatchObject(
      { rating: null, startedAt: null, completedAt: null },
    );
  });
});

describe("AniList push", () => {
  it("requires an access token before any remote or database action", async () => {
    fake.token.mockResolvedValue(null);
    await expect(pushAniList("log")).rejects.toThrow("Not logged in");
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("requires a username even with a token", async () => {
    fake.token.mockResolvedValue({ accessToken: "isolated" });
    await expect(pushAniList("log")).rejects.toThrow("No AniList username");
  });
  it("does not write unchanged entries, including completed count differences and rating precision", async () => {
    pages(
      [item({ status: "COMPLETED", progress: 12, score: 7.9 })],
      [
        item({
          status: "COMPLETED",
          progress: 24,
          progressVolumes: 3,
          score: 7.9,
        }),
      ],
    );
    fake.db.animeListEntry.findMany.mockResolvedValue([
      local("anime", { watchStatus: "COMPLETED", progress: 10, rating: 15.9 }),
    ]);
    fake.db.mangaListEntry.findMany.mockResolvedValue([
      local("manga", {
        readStatus: "COMPLETED",
        progress: 22,
        progressVolumes: 2,
        rating: 15.9,
      }),
    ]);
    await pushAniList("log");
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      animeSynced: 1,
      mangaSynced: 1,
      animeChanged: 0,
      mangaChanged: 0,
    });
  });
  it("protects remote entries from deletion when a corresponding local entry is invalid", async () => {
    pages([item()], [item()]);
    fake.db.animeListEntry.findMany.mockResolvedValue([
      local("anime", { progress: -1 }),
    ]);
    fake.db.mangaListEntry.findMany.mockResolvedValue([
      local("manga", { rating: 30 }),
    ]);
    await pushAniList("log");
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      deletions: [],
      errors: [
        expect.stringContaining("invalid progress"),
        expect.stringContaining("invalid rating"),
      ],
    });
  });
  it.each(["anime", "manga"] as const)(
    "updates %s against the remote ID and clamps progress to its authoritative count",
    async (kind) => {
      pages(
        kind === "anime" ? [item({ progress: 0 })] : [],
        kind === "manga" ? [item({ progress: 0 })] : [],
      );
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([local(kind, { progress: 99 })]);
      await pushAniList("log");
      const request = mutationBody();
      expect(request.variables).toMatchObject({
        id_0: 100,
        progress_0: kind === "anime" ? 12 : 24,
        score_0: 7.5,
      });
      expect(request.variables).not.toHaveProperty("mediaId_0");
      expect(
        fake.db.syncLog.update.mock.calls[0][0].data[`${kind}Changed`],
      ).toBe(1);
      expect(fake.fetch.mock.calls[0][1]).toMatchObject({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer isolated-test-token",
        }),
      });
    },
  );
  it.each(["anime", "manga"] as const)(
    "creates absent %s entries and persists returned AniList entry IDs",
    async (kind) => {
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([
        local(kind, { progress: 99, rating: null, notes: null }),
      ]);
      await pushAniList("log");
      expect(mutationBody().variables).toMatchObject({
        mediaId_0: 42,
        progress_0: kind === "anime" ? 12 : 24,
        score_0: 0,
        notes_0: "",
      });
      expect(
        fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"].update,
      ).toHaveBeenCalledWith({
        where: { id: `entry-${kind}` },
        data: { anilistEntryId: 900 },
      });
    },
  );
  it("matches a remote entry by MAL ID instead of deleting and recreating it", async () => {
    pages([item({ progress: 0 })]);
    const value = local("anime", {
      anime: {
        id: "media-anime",
        anilistId: 999,
        malId: 52,
        titleEn: "English",
        episodeCount: 12,
      },
    });
    fake.db.animeListEntry.findMany.mockResolvedValue([value]);
    await pushAniList("log");
    expect(mutationBody().variables).toHaveProperty("id_0", 100);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });
  it("deletes remote-only anime and manga using their library-entry IDs", async () => {
    pages([item()], [item({ id: 101 })]);
    await pushAniList("log");
    const req = mutationBody();
    expect(req.query).toContain("DeleteMediaListEntry");
    expect(req.variables).toEqual({ id_0: 100, id_1: 101 });
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      animeChanged: 1,
      mangaChanged: 1,
      deletions: [
        expect.stringContaining("anime"),
        expect.stringContaining("manga"),
      ],
    });
  });
  it("chunks more than ten writes without losing aliases or local IDs", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) =>
        local("anime", {
          id: `entry-${i}`,
          anime: {
            id: `media-${i}`,
            anilistId: i + 1,
            titleEn: `Anime ${i}`,
            episodeCount: 12,
          },
        }),
      ),
    );
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    expect(fake.db.animeListEntry.update).toHaveBeenCalledTimes(11);
    expect(mutationBody(0).query.match(/SaveMediaListEntry/g)).toHaveLength(10);
    expect(mutationBody(1).query).toContain("s10: SaveMediaListEntry");
  });
  it("reports Cloudflare blocking without trying to parse the challenge HTML as JSON", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValue(
      new Response("challenge", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      }),
    );
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      errors: [expect.stringContaining("Cloudflare challenge")],
    });
  });
  it("isolates a rejected validation entry by retrying the batch individually", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [
            {
              message: "invalid input",
              validation: { progress: ["too large"] },
            },
          ],
        }),
        { status: 400 },
      ),
    );
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    expect(fake.db.animeListEntry.update).toHaveBeenCalledTimes(1);
    expect(fake.db.syncLog.update.mock.calls[0][0].data.status).toBe(
      "COMPLETED",
    );
  });
  it("stops after five rate-limit responses using the provider Retry-After interval", async () => {
    vi.useFakeTimers();
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValue(
      new Response("", { status: 429, headers: { "Retry-After": "1" } }),
    );
    const result = pushAniList("log");
    await vi.runAllTimersAsync();
    await result;
    expect(fake.fetch).toHaveBeenCalledTimes(5);
    expect(fake.db.syncLog.update.mock.calls[0][0].data.errors).toEqual([
      expect.stringContaining("exceeded retry limit"),
    ]);
  });
  it("records deletion failures without falsely reporting a successful deletion", async () => {
    pages([item()]);
    fake.fetch.mockRejectedValue(new Error("network unavailable"));
    await pushAniList("log");
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      animeChanged: 0,
      deletions: [],
      errors: [expect.stringContaining("delete batch 1")],
    });
  });
  it("recovers an obsolete media ID via MAL and persists both corrected IDs", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    const invalid = () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              message: "invalid media",
              validation: { mediaId: ["not found"] },
            },
          ],
        }),
        { status: 400 },
      );
    fake.fetch
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(reply({ Media: { id: 43 } }));
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(4);
    expect(mutationBody(2).variables).toEqual({ malId: 52, type: "ANIME" });
    expect(mutationBody(3).variables).toHaveProperty("mediaId_0", 43);
    expect(fake.db.anime.update).toHaveBeenCalledWith({
      where: { id: "media-anime" },
      data: { anilistId: 43 },
    });
    expect(fake.db.animeListEntry.update).toHaveBeenCalledWith({
      where: { id: "entry-anime" },
      data: { anilistEntryId: 900 },
    });
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "COMPLETED",
      animeChanged: 1,
    });
  });
  it.each([null, 42])(
    "does not repeatedly retry unresolved/unchanged MAL recovery (%s)",
    async (id) => {
      fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
      const invalid = () =>
        new Response(
          JSON.stringify({
            errors: [
              { message: "invalid media", validation: { mediaId: "unknown" } },
            ],
          }),
          { status: 400 },
        );
      fake.fetch
        .mockResolvedValueOnce(invalid())
        .mockResolvedValueOnce(invalid())
        .mockResolvedValueOnce(reply({ Media: id === null ? null : { id } }));
      await pushAniList("log");
      expect(fake.fetch).toHaveBeenCalledTimes(3);
      expect(fake.db.anime.update).not.toHaveBeenCalled();
      expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
      expect(fake.db.syncLog.update.mock.calls[0][0].data.animeChanged).toBe(0);
    },
  );
  it("records a failed local identity repair instead of reporting a successful remote change", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.db.anime.update.mockRejectedValueOnce(new Error("write failed"));
    const invalid = () =>
      new Response(
        JSON.stringify({
          errors: [{ message: "invalid media", validation: { mediaId: true } }],
        }),
        { status: 400 },
      );
    fake.fetch
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(reply({ Media: { id: 43 } }));
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(3);
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      animeChanged: 0,
      errors: ["update anilistId: write failed"],
    });
  });
  it("reports a failed mutation after identity recovery without persisting a returned library ID", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    const invalid = () =>
      new Response(
        JSON.stringify({
          errors: [{ message: "invalid media", validation: { mediaId: true } }],
        }),
        { status: 400 },
      );
    fake.fetch
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(reply({ Media: { id: 43 } }))
      .mockRejectedValueOnce(new Error("retry failed"));
    await pushAniList("log");
    expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      animeChanged: 0,
      errors: ["save s0 (recovered attempt): retry failed"],
    });
  });
  it("does not invent a replacement media ID when the local record has no MAL mapping", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([
      local("anime", {
        anime: {
          id: "media-anime",
          anilistId: 42,
          malId: null,
          titleEn: "English",
          episodeCount: 12,
        },
      }),
    ]);
    const invalid = () =>
      new Response(
        JSON.stringify({
          errors: [
            { message: "invalid media", validation: { mediaId: ["unknown"] } },
          ],
        }),
        { status: 400 },
      );
    fake.fetch
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid());
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    expect(fake.db.anime.update).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data.status).toBe("FAILED");
  });
  it("handles GraphQL validation errors even when HTTP status is successful", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    const invalid = () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              message: "invalid",
              validation: {
                score: ["bad", 123],
                rating: "invalid",
                progress: null,
              },
            },
          ],
        }),
      );
    fake.fetch
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid());
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data.errors).toEqual([
      expect.stringContaining("[VALIDATION:other]"),
    ]);
  });
  it("keeps non-validation upstream HTTP failures bounded in the sync log", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValueOnce(
      new Response("x".repeat(400), { status: 503 }),
    );
    await pushAniList("log");
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    const error = fake.db.syncLog.update.mock.calls[0][0].data.errors[0];
    expect(error).toContain("AniList HTTP 503");
    expect(error.length).toBeLessThanOrEqual(114);
  });
  it("does not report a write or update local IDs when a response omits the requested mutation", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValueOnce(reply({}));
    await pushAniList("log");
    expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data.animeChanged).toBe(0);
  });
  it("ignores remote rows without valid media/library IDs rather than deleting guessed IDs", async () => {
    pages([item({ id: null }), item({ media: null })]);
    await pushAniList("log");
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("protects a remote MAL match from deletion when local validation fails without an AniList ID", async () => {
    pages([item()]);
    fake.db.animeListEntry.findMany.mockResolvedValue([
      local("anime", {
        progress: -1,
        anime: {
          id: "media-anime",
          anilistId: null,
          malId: 52,
          titleEn: "English",
          episodeCount: 12,
        },
      }),
    ]);
    await pushAniList("log");
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data.deletions).toEqual([]);
  });
});

describe("AniList optional fields and provider recovery", () => {
  it.each(["anime", "manga"] as const)(
    "supplies safe defaults for sparse %s provider entries",
    async (kind) => {
      const row = {
        id: 100,
        media: {
          id: 42,
          title: { romaji: "Fallback" },
          coverImage: { medium: "https://example.invalid/medium.jpg" },
        },
      };
      pages(kind === "anime" ? [row] : [], kind === "manga" ? [row] : []);
      await pullAniList("log");
      const data = fake.db[kind].create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        titleEn: "Fallback",
        titleJp: null,
        coverImageUrl: "https://example.invalid/medium.jpg",
        averageRating: null,
        startDate: null,
        endDate: null,
      });
      const list =
        fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"].upsert
          .mock.calls[0][0].update;
      expect(list).toMatchObject({
        progress: 0,
        rating: null,
        notes: null,
        private: false,
      });
      expect(list.updatedAt).toBeInstanceOf(Date);
    },
  );
  it.each(["anime", "manga"] as const)(
    "rejects invalid %s entries and tolerates missing media without writes",
    async (kind) => {
      const invalid = [
        item({ media: null }),
        item({ media: { id: 0, title: {} }, status: null, progress: null }),
        item({ progress: -1 }),
        item({ repeat: -1 }),
      ];
      pages(kind === "anime" ? invalid : [], kind === "manga" ? invalid : []);
      await pullAniList("log");
      expect(fake.db[kind].create).not.toHaveBeenCalled();
      expect(
        fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"].upsert,
      ).not.toHaveBeenCalled();
    },
  );
  it.each(["anime", "manga"] as const)(
    "uses a MAL match when %s has not been linked to AniList",
    async (kind) => {
      fake.db[kind].findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "matched",
          episodeCount: null,
          chapterCount: null,
          volumeCount: null,
        });
      fake.db[kind].update.mockImplementation(async ({ data }) => ({
        id: "matched",
        ...data,
      }));
      pages(kind === "anime" ? [item()] : [], kind === "manga" ? [item()] : []);
      await pullAniList("log");
      expect(fake.db[kind].findUnique).toHaveBeenNthCalledWith(2, {
        where: { malId: 52 },
      });
      expect(fake.db[kind].create).not.toHaveBeenCalled();
    },
  );
  it.each(["anime", "manga"] as const)(
    "does not invent zero %s counts when both local and remote values are missing",
    async (kind) => {
      fake.db[kind].findUnique.mockResolvedValue({
        id: "matched",
        episodeCount: null,
        chapterCount: null,
        volumeCount: null,
      });
      pages(
        kind === "anime"
          ? [item({ media: { id: 42, title: { english: "Title" } } })]
          : [],
        kind === "manga"
          ? [item({ media: { id: 42, title: { english: "Title" } } })]
          : [],
      );
      await pullAniList("log");
      expect(fake.db[kind].update).not.toHaveBeenCalled();
    },
  );
  it.each(["anime", "manga"] as const)(
    "treats an equal existing %s list state as unchanged",
    async (kind) => {
      fake.db[kind].findUnique.mockResolvedValue({
        id: "matched",
        episodeCount: 100,
        chapterCount: 100,
        volumeCount: 100,
      });
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findUnique.mockResolvedValue({
        watchStatus: "WATCHING",
        readStatus: "READING",
        progress: 4,
        rating: 15,
        notes: "remote",
        rewatchCount: 2,
        rereadCount: 2,
        rewatching: false,
        rereading: false,
        updatedAt: new Date("2020-01-01"),
      });
      pages(kind === "anime" ? [item()] : [], kind === "manga" ? [item()] : []);
      await pullAniList("log");
      expect(
        fake.db.syncLog.update.mock.calls[0][0].data[`${kind}Changed`],
      ).toBe(0);
    },
  );
  for (const kind of ["anime", "manga"] as const) {
    it.each(["status", "progress", "rating", "notes", "repeat", "reconsuming"])(
      `counts a changed ${kind} %s after preserving primary-source fields`,
      async (field) => {
        const prior = {
          watchStatus: "WATCHING",
          readStatus: "READING",
          progress: 4,
          rating: 15 as number | null,
          notes: "remote",
          rewatchCount: 2,
          rereadCount: 2,
          rewatching: false,
          rereading: false,
          updatedAt: new Date("2020-01-01"),
        };
        if (field === "status") {
          prior.watchStatus = "PLAN_TO_WATCH";
          prior.readStatus = "PLAN_TO_READ";
        }
        if (field === "progress") prior.progress = 0;
        if (field === "rating") prior.rating = null;
        if (field === "notes") prior.notes = "old";
        if (field === "repeat") {
          prior.rewatchCount = 0;
          prior.rereadCount = 0;
        }
        fake.db[kind].findUnique.mockResolvedValue({
          id: "matched",
          episodeCount: 100,
          chapterCount: 100,
          volumeCount: 100,
        });
        fake.db[
          kind === "anime" ? "animeListEntry" : "mangaListEntry"
        ].findUnique.mockResolvedValue(prior);
        const row = item({
          status: field === "reconsuming" ? "REPEATING" : "CURRENT",
        });
        pages(kind === "anime" ? [row] : [], kind === "manga" ? [row] : []);
        await pullAniList("log");
        expect(
          fake.db.syncLog.update.mock.calls[0][0].data[`${kind}Changed`],
        ).toBe(1);
        const write =
          fake.db[kind === "anime" ? "animeListEntry" : "mangaListEntry"].upsert
            .mock.calls[0][0];
        expect(write.where).toEqual(
          kind === "anime" ? { animeId: "matched" } : { mangaId: "matched" },
        );
        expect(write.update).toMatchObject({
          progress: 4,
          rating: 15,
          notes: "remote",
          ...(kind === "anime"
            ? {
                watchStatus: "WATCHING",
                rewatchCount: 2,
                rewatching: field === "reconsuming",
              }
            : {
                readStatus: "READING",
                rereadCount: 2,
                rereading: field === "reconsuming",
              }),
        });
      },
    );
  }
  it.each(["anime", "manga"] as const)(
    "handles a sparse native-title %s without a MAL identifier",
    async (kind) => {
      pages(
        kind === "anime"
          ? [item({ media: { id: 42, title: { native: "日本語" } } })]
          : [],
        kind === "manga"
          ? [item({ media: { id: 42, title: { native: "日本語" } } })]
          : [],
      );
      await pullAniList("log");
      expect(fake.db[kind].create.mock.calls[0][0].data).toMatchObject({
        titleEn: "日本語",
        titleRomaji: null,
      });
      expect(fake.db[kind].create.mock.calls[0][0].data).not.toHaveProperty(
        "malId",
      );
    },
  );
  it("records non-Error database failures without abandoning other entries", async () => {
    fake.db.anime.create.mockRejectedValueOnce("database rejected");
    pages([item(), item({ id: 101 })]);
    await pullAniList("log");
    expect(fake.db.animeListEntry.upsert).toHaveBeenCalledTimes(1);
    expect(fake.db.syncLog.update.mock.calls[0][0].data.errors).toEqual([
      "anime 42: database rejected",
    ]);
  });
  it("handles empty media-list and page-info responses when pulling", async () => {
    fake.query.mockResolvedValue({ Page: {} });
    await pullAniList("log");
    expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
      animeSynced: 0,
      mangaSynced: 0,
      status: "COMPLETED",
    });
  });
  it("handles an absent Page when scanning remote data for a push", async () => {
    fake.query.mockResolvedValue({ Page: null });
    await pushAniList("log");
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("uses the public username for push when the linked account omits it", async () => {
    fake.token.mockResolvedValue({ accessToken: "isolated-token" });
    vi.stubEnv("NEXT_PUBLIC_ANILIST_USERNAME", "fallback-user");
    await pushAniList("log");
    expect(fake.query.mock.calls[0][0].Page[1].mediaList[0].userName).toBe(
      "fallback-user",
    );
  });
  it.each([
    ["PLAN_TO_WATCH", "PLAN_TO_READ", "PLANNING"],
    ["ON_HOLD", "ON_HOLD", "PAUSED"],
    ["DROPPED", "DROPPED", "DROPPED"],
  ])(
    "serializes local %s/%s states as %s",
    async (watchStatus, readStatus, remote) => {
      fake.db.animeListEntry.findMany.mockResolvedValue([
        local("anime", { watchStatus }),
      ]);
      fake.db.mangaListEntry.findMany.mockResolvedValue([
        local("manga", { readStatus }),
      ]);
      await pushAniList("log");
      expect(mutationBody().variables).toMatchObject({
        status_0: remote,
        status_1: remote,
      });
    },
  );
  it.each(["anime", "manga"] as const)(
    "treats null remote %s fields as their empty equivalents",
    async (kind) => {
      const row = item({
        progress: null,
        progressVolumes: null,
        score: null,
        notes: null,
        repeat: null,
        private: null,
      });
      pages(kind === "anime" ? [row] : [], kind === "manga" ? [row] : []);
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([
        local(kind, {
          progress: 0,
          progressVolumes: 0,
          rating: null,
          notes: null,
          rewatchCount: 0,
          rereadCount: 0,
          private: false,
        }),
      ]);
      await pushAniList("log");
      expect(fake.fetch).not.toHaveBeenCalled();
    },
  );
  for (const kind of ["anime", "manga"] as const) {
    it.each([
      "status",
      "rating",
      "notes",
      "repeat",
      "private",
      ...(kind === "manga" ? ["volumes"] : []),
    ])(
      `pushes changed ${kind} %s fields and normalizes optional provider values`,
      async (field) => {
        const override: Record<string, unknown> = {};
        if (field === "status") override.status = "DROPPED";
        if (field === "rating") override.score = 0;
        if (field === "notes") override.notes = null;
        if (field === "repeat") override.repeat = null;
        if (field === "private") override.private = null;
        if (field === "volumes") override.progressVolumes = 0;
        pages(
          kind === "anime" ? [item(override)] : [],
          kind === "manga" ? [item(override)] : [],
        );
        fake.db[
          kind === "anime" ? "animeListEntry" : "mangaListEntry"
        ].findMany.mockResolvedValue([local(kind)]);
        await pushAniList("log");
        expect(mutationBody().variables).toMatchObject({
          id_0: 100,
          score_0: 7.5,
          notes_0: "remote",
          repeat_0: 2,
          private_0: true,
          status_0: "CURRENT",
          ...(kind === "manga" ? { progressVolumes_0: 1 } : {}),
        });
      },
    );
  }
  it.each(["anime", "manga"] as const)(
    "keeps local progress when the remote %s count is unavailable",
    async (kind) => {
      const value = item({ progress: 0 });
      value.media.episodes = null as unknown as number;
      value.media.chapters = null as unknown as number;
      pages(kind === "anime" ? [value] : [], kind === "manga" ? [value] : []);
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([local(kind, { progress: 99 })]);
      await pushAniList("log");
      expect(mutationBody().variables.progress_0).toBe(99);
    },
  );
  it.each(["anime", "manga"] as const)(
    "clamps %s progress using the remote count when local metadata disagrees",
    async (kind) => {
      const value = item({ progress: 0 });
      pages(kind === "anime" ? [value] : [], kind === "manga" ? [value] : []);
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([
        local(kind, {
          progress: 99,
          [kind]: {
            id: "local",
            anilistId: 42,
            titleEn: "Title",
            episodeCount: 100,
            chapterCount: 100,
          },
        }),
      ]);
      await pushAniList("log");
      expect(mutationBody().variables.progress_0).toBe(
        kind === "anime" ? 12 : 24,
      );
    },
  );
  it.each(["anime", "manga"] as const)(
    "does not invent a zero %s count during creation when metadata is missing",
    async (kind) => {
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([
        local(kind, {
          [kind]: {
            id: "local",
            anilistId: 42,
            titleEn: "Title",
            episodeCount: null,
            chapterCount: null,
          },
        }),
      ]);
      await pushAniList("log");
      expect(mutationBody().variables.progress_0).toBe(4);
    },
  );
  it("matches manga by MAL without deleting/recreating the same remote entry", async () => {
    pages([], [item({ progress: 0 })]);
    fake.db.mangaListEntry.findMany.mockResolvedValue([
      local("manga", {
        manga: {
          id: "local",
          anilistId: 999,
          malId: 52,
          titleEn: "Title",
          chapterCount: 24,
        },
      }),
    ]);
    await pushAniList("log");
    expect(mutationBody().variables.id_0).toBe(100);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["anime", "manga"] as const)(
    "skips unlinked local %s rather than creating guessed provider IDs",
    async (kind) => {
      fake.db[
        kind === "anime" ? "animeListEntry" : "mangaListEntry"
      ].findMany.mockResolvedValue([
        local(kind, {
          [kind]: {
            id: "local",
            anilistId: null,
            malId: null,
            titleEn: "Title",
            episodeCount: 12,
            chapterCount: 24,
          },
        }),
      ]);
      await pushAniList("log");
      expect(fake.fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["http", "graphql", "network"])(
    "does not corrupt local IDs when MAL recovery fails at the %s boundary",
    async (boundary) => {
      fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
      const invalid = () =>
        new Response(
          JSON.stringify({
            errors: [
              { message: "validation failed", validation: { mediaId: [] } },
            ],
          }),
          { status: 400 },
        );
      fake.fetch
        .mockResolvedValueOnce(invalid())
        .mockResolvedValueOnce(invalid());
      if (boundary === "http")
        fake.fetch.mockResolvedValueOnce(
          new Response("unavailable", { status: 503 }),
        );
      if (boundary === "graphql")
        fake.fetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ errors: [{ message: "lookup failed" }] }),
          ),
        );
      if (boundary === "network")
        fake.fetch.mockRejectedValueOnce("lookup unavailable");
      await pushAniList("log");
      expect(fake.fetch).toHaveBeenCalledTimes(3);
      expect(fake.db.anime.update).not.toHaveBeenCalled();
      expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
    },
  );
  it("repairs a manga media ID via MAL using the correct GraphQL media type", async () => {
    fake.db.mangaListEntry.findMany.mockResolvedValue([local("manga")]);
    const invalid = () =>
      new Response(
        JSON.stringify({
          errors: [
            {
              message: "validation failed",
              validation: { mediaId: "missing" },
            },
          ],
        }),
      );
    fake.fetch
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(reply({ Media: { id: 43 } }));
    await pushAniList("log");
    expect(mutationBody(2).variables).toEqual({ malId: 52, type: "MANGA" });
    expect(fake.db.manga.update).toHaveBeenCalledWith({
      where: { id: "media-manga" },
      data: { anilistId: 43 },
    });
    expect(fake.db.mangaListEntry.update).toHaveBeenCalledTimes(1);
  });
  it.each([
    new Error(""),
    new Error("Invalid response\nprivate detail"),
    "transport rejected",
  ])("records useful provider transport failures (%s)", async (error) => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockRejectedValueOnce(error);
    await pushAniList("log");
    const message = fake.db.syncLog.update.mock.calls[0][0].data.errors[0];
    expect(message).not.toContain("private detail");
    expect(message).not.toBe("save batch 1: ");
    expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
  });
  it.each(["", "provider unavailable"])(
    "handles GraphQL errors without validation details (%s)",
    async (message) => {
      fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
      fake.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message }] }), {
          status: 503,
        }),
      );
      await pushAniList("log");
      expect(fake.db.syncLog.update.mock.calls[0][0].data).toMatchObject({
        status: "FAILED",
        animeChanged: 0,
      });
    },
  );
  it("does not count missing response data as a persisted remote write", async () => {
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValueOnce(new Response("{}"));
    await pushAniList("log");
    expect(fake.db.animeListEntry.update).not.toHaveBeenCalled();
    expect(fake.db.syncLog.update.mock.calls[0][0].data.animeChanged).toBe(0);
  });
  it("uses the documented backoff when Retry-After is absent, then succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    fake.db.animeListEntry.findMany.mockResolvedValue([local("anime")]);
    fake.fetch.mockResolvedValueOnce(new Response("", { status: 429 }));
    const result = pushAniList("log");
    await vi.runAllTimersAsync();
    await result;
    expect(Date.now()).toBe(60000);
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    expect(fake.db.syncLog.update.mock.calls[0][0].data.animeChanged).toBe(1);
  });
});
