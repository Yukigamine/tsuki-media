import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ query: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/kitsu/browser-client", () => ({ kitsuBrowserClient: f.client }));

import { useKitsuProfile } from "./useKitsuProfile";

function wrapper({ children }: PropsWithChildren) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  f.client.mockReturnValue(f.query);
});
describe("Kitsu profile hook", () => {
  it("does not request an empty slug", () => {
    const { result } = renderHook(() => useKitsuProfile(""), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("distinguishes missing profiles from failed requests", async () => {
    f.query.mockResolvedValueOnce({ findProfileBySlug: null });
    const missing = renderHook(() => useKitsuProfile("missing"), { wrapper });
    await waitFor(() => expect(missing.result.current.data).toBeNull());
    f.query.mockRejectedValueOnce(new Error("provider unavailable"));
    const failed = renderHook(() => useKitsuProfile("failed"), { wrapper });
    await waitFor(() =>
      expect(failed.result.current.error?.message).toBe("provider unavailable"),
    );
    expect(failed.result.current.data).toBeUndefined();
  });
  it("maps all favorite union variants and profile statistics without leaking unsupported nodes", async () => {
    f.query.mockResolvedValue({
      findProfileBySlug: {
        slug: "reader",
        name: "Reader",
        about: "hello",
        avatarImage: { original: { url: "avatar" } },
        bannerImage: { original: { url: "banner" } },
        birthday: "2000-01-01",
        createdAt: "2020-01-01",
        gender: "Other",
        location: "Earth",
        waifu: {
          slug: "hero",
          names: { canonical: "Hero" },
          image: { original: { url: "hero.png" } },
        },
        waifuOrHusbando: "Husbando",
        stats: {
          animeAmountConsumed: { time: 100, completed: 2, units: 3 },
          mangaAmountConsumed: { completed: 4, units: 5 },
        },
        favorites: {
          nodes: [
            null,
            { item: null },
            ...["Anime", "Manga", "Character", "Person"].map((type, index) => ({
              id: index,
              item: {
                __typename: type,
                slug: `item-${index}`,
                titles: { canonical: `Title ${index}` },
                names: { canonical: `Name ${index}` },
                posterImage: { original: { url: "poster" } },
                image: { original: { url: "portrait" } },
              },
            })),
            { item: { __typename: "Studio" } },
          ],
        },
      },
    });
    const { result } = renderHook(() => useKitsuProfile("reader"), { wrapper });
    await waitFor(() => expect(result.current.data?.name).toBe("Reader"));
    expect(f.client).toHaveBeenCalledWith("query");
    expect(f.query).toHaveBeenCalledWith(
      expect.objectContaining({
        findProfileBySlug: [{ slug: "reader" }, expect.any(Object)],
      }),
    );
    expect(result.current.data).toMatchObject({
      slug: "reader",
      about: "hello",
      avatarUrl: "avatar",
      bannerUrl: "banner",
      birthday: "2000-01-01",
      createdAt: "2020-01-01",
      gender: "Other",
      location: "Earth",
      waifu: {
        slug: "hero",
        name: "Hero",
        imageUrl: "hero.png",
        label: "Husbando",
      },
      stats: {
        animeTimeSecs: 100,
        animeCompleted: 2,
        animeEpisodes: 3,
        mangaCompleted: 4,
        mangaChapters: 5,
      },
    });
    expect(result.current.data?.favorites).toEqual({
      anime: [
        {
          id: "0",
          slug: "item-0",
          name: "Title 0",
          imageUrl: "poster",
          type: "anime",
        },
      ],
      manga: [
        {
          id: "1",
          slug: "item-1",
          name: "Title 1",
          imageUrl: "poster",
          type: "manga",
        },
      ],
      character: [
        {
          id: "2",
          slug: "item-2",
          name: "Name 2",
          imageUrl: "portrait",
          type: "character",
        },
      ],
      person: [
        {
          id: "3",
          slug: "item-3",
          name: "Name 3",
          imageUrl: "portrait",
          type: "person",
        },
      ],
    });
  });
  it("normalizes sparse profiles and absent favorite metadata", async () => {
    f.query.mockResolvedValueOnce({
      findProfileBySlug: {
        about: "",
        favorites: {
          nodes: [
            { item: { __typename: "Anime" } },
            { item: { __typename: "Manga" } },
            { item: { __typename: "Character" } },
            { item: { __typename: "Person" } },
            { item: {} },
          ],
        },
        waifu: {},
      },
    });
    const { result } = renderHook(() => useKitsuProfile("sparse"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({
      slug: "",
      name: "",
      about: null,
      avatarUrl: null,
      bannerUrl: null,
      birthday: null,
      createdAt: "",
      gender: null,
      location: null,
      stats: {
        animeTimeSecs: null,
        animeCompleted: null,
        animeEpisodes: null,
        mangaCompleted: null,
        mangaChapters: null,
      },
      waifu: { name: "Unknown", imageUrl: null, label: "Waifu" },
    });
    for (const [type, favorites] of Object.entries(
      result.current.data?.favorites ?? {},
    ))
      expect(favorites).toEqual([
        { id: "", slug: "", name: "Unknown", imageUrl: null, type },
      ]);
  });
  it("supports profiles with no favorites or partner", async () => {
    f.query.mockResolvedValueOnce({ findProfileBySlug: {} });
    const { result } = renderHook(() => useKitsuProfile("empty"), { wrapper });
    await waitFor(() => expect(result.current.data?.waifu).toBeNull());
    expect(result.current.data?.favorites).toEqual({
      anime: [],
      manga: [],
      character: [],
      person: [],
    });
  });
});
