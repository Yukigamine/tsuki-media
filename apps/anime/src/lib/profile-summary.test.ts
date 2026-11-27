import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ library: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/library", () => ({ getLibrarySnapshot: mocks.library }));
// Exercise the application's HTTP callback while keeping generated query assembly out of this unit boundary.
vi.mock("@/lib/zeus/anilist", () => ({
  Thunder: (request: (query: string) => unknown) => () => () =>
    request("query UserGenres"),
  UserStatisticsSort: { COUNT_DESC: "COUNT_DESC" },
}));

import { getProfileSummary } from "./profile-summary";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.library.mockResolvedValue({
    anime: [{ collectionItems: [{}, {}] }, { collectionItems: [{}] }],
    manga: [
      {
        collectionItems: [
          { volumes: [1, 2], chapters: [1, 2, 3] },
          { volumes: [3], chapters: [4] },
        ],
      },
    ],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("profile summary", () => {
  it("counts owned copies and manga ranges without an AniList identity", async () => {
    expect(await getProfileSummary(null)).toEqual({
      favoriteGenres: [],
      animeOwned: 3,
      mangaVolumesOwned: 3,
      mangaChaptersOwned: 4,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("merges genre counts, resolves ties alphabetically, skips malformed entries and returns the top three", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          User: {
            statistics: {
              anime: {
                genres: [
                  { genre: "Drama", count: 2 },
                  { genre: "Action", count: 1 },
                  { genre: "Comedy", count: 3 },
                  null,
                ],
              },
              manga: {
                genres: [
                  { genre: "Action", count: 2 },
                  { genre: "Drama", count: 1 },
                  { genre: "Unknown" },
                  {},
                ],
              },
            },
          },
        },
      }),
    );
    expect((await getProfileSummary("name")).favoriteGenres).toEqual([
      "Action",
      "Comedy",
      "Drama",
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://graphql.anilist.co",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }),
    );
  });
  it("supports empty/sparse statistics and empty libraries", async () => {
    mocks.library.mockResolvedValue({ anime: [], manga: [] });
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: { User: null } }))
      .mockResolvedValueOnce(
        Response.json({
          data: { User: { statistics: { anime: {}, manga: {} } } },
        }),
      );
    expect(await getProfileSummary("name")).toEqual({
      favoriteGenres: [],
      animeOwned: 0,
      mangaVolumesOwned: 0,
      mangaChaptersOwned: 0,
    });
    expect((await getProfileSummary("name")).favoriteGenres).toEqual([]);
  });
  it.each([
    new Response("failure", { status: 503 }),
    Response.json({ errors: [{ message: "denied" }] }),
    Response.json({}),
  ])("keeps local ownership available when AniList fails", async (response) => {
    vi.mocked(fetch).mockResolvedValue(response);
    expect(await getProfileSummary("name")).toMatchObject({
      animeOwned: 3,
      favoriteGenres: [],
    });
    expect(console.error).toHaveBeenCalled();
  });
  it("keeps network failures best-effort but propagates unavailable local library", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    expect((await getProfileSummary("name")).favoriteGenres).toEqual([]);
    mocks.library.mockRejectedValue(new Error("db down"));
    await expect(getProfileSummary(null)).rejects.toThrow("db down");
  });
});
