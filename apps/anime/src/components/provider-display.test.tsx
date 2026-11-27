import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaDetailSnapshot } from "@/lib/media-detail-types";
import MediaDetailLayout from "./MediaDetailLayout";
import ProviderMediaHero from "./ProviderMediaHero";
import ProviderSeriesDetails from "./ProviderSeriesDetails";

const snapshot = (
  extra: Partial<MediaDetailSnapshot> = {},
): MediaDetailSnapshot => ({
  id: "local",
  kitsuId: null,
  anilistId: null,
  titleEn: "Cached title",
  titleRomaji: null,
  titleJp: "Native title",
  synopsis: "Cached synopsis",
  coverImageUrl: "https://images.example.test/cached.jpg",
  bannerImageUrl: "https://images.example.test/banner.jpg",
  episodeCount: 12,
  chapterCount: null,
  volumeCount: null,
  showStatus: "CURRENT",
  averageRating: 85,
  startDate: "2024-01-02",
  endDate: null,
  ...extra,
});
function providers(kitsu: unknown, anilist: unknown) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("kitsu.app")) return Response.json({ data: kitsu });
    if (url === "https://graphql.anilist.co")
      return Response.json({ data: { Media: anilist } });
    throw new Error(`Unexpected provider ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const hero = (
  props: Partial<React.ComponentProps<typeof ProviderMediaHero>> = {},
) => (
  <ProviderMediaHero
    kitsuId={null}
    mediaType="anime"
    fallbackTitle="Fallback title"
    initialDetail={null}
    anilistId={null}
    {...props}
  />
);
const details = (
  props: Partial<React.ComponentProps<typeof ProviderSeriesDetails>> = {},
) => (
  <ProviderSeriesDetails
    kitsuId={null}
    mediaType="anime"
    initialDetail={null}
    anilistId={null}
    {...props}
  />
);
describe("provider media hero", () => {
  it("renders a cached snapshot immediately, including count and supplied action chips", () => {
    const count = vi.fn();
    render(
      hero({
        initialDetail: snapshot(),
        onCountLoaded: count,
        extraChips: <span>In your library</span>,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Cached title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Native title")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cached title" })).toHaveAttribute(
      "src",
      "https://images.example.test/cached.jpg",
    );
    expect(screen.getByText("12 EPISODES")).toBeInTheDocument();
    expect(screen.getByText("In your library")).toBeInTheDocument();
    expect(count).toHaveBeenCalledWith(12);
  });
  it("loads Kitsu anime titles, release season and age rating through the browser GraphQL boundary", async () => {
    const fetch = providers(
      {
        findAnimeById: {
          titles: { canonical: "Provider title", original: "Original title" },
          startDate: "2023-04-01",
          season: "spring",
          subtype: "TV",
          episodeCount: 24,
          ageRating: "PG",
          bannerImage: {
            original: {
              url: "https://images.example.test/provider-banner.jpg",
            },
          },
          posterImage: {
            original: { url: "https://images.example.test/provider-cover.jpg" },
          },
        },
      },
      null,
    );
    const count = vi.fn();
    render(hero({ kitsuId: "7", onCountLoaded: count }));
    expect(
      await screen.findByRole("heading", { name: "Provider title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SPRING 2023")).toBeInTheDocument();
    expect(screen.getByText("24 EPISODES")).toBeInTheDocument();
    expect(screen.getByText("PG")).toBeInTheDocument();
    expect(screen.getByText("TV")).toBeInTheDocument();
    expect(count).toHaveBeenLastCalledWith(24);
    expect(String(fetch.mock.calls[0][1]?.body)).toContain("findAnimeById");
  });
  it("renders manga chapter counts and month/year without anime-only subtype chips", async () => {
    providers(
      {
        findMangaById: {
          titles: { romanized: "Romanized manga" },
          startDate: "2020-02-01",
          chapterCount: 80,
          subtype: "ignored",
        },
      },
      null,
    );
    render(hero({ kitsuId: "8", mediaType: "manga" }));
    expect(
      await screen.findByRole("heading", { name: "Romanized manga" }),
    ).toBeInTheDocument();
    expect(screen.getByText("80 CHAPTERS")).toBeInTheDocument();
    expect(screen.getByText("FEBRUARY 2020")).toBeInTheDocument();
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();
  });
  it("falls back to AniList for an absent Kitsu match and retains cached fields when provider values are missing", async () => {
    providers(
      { findAnimeById: null },
      {
        title: { english: "AniList title", native: "AniList native" },
        coverImage: { large: "https://images.example.test/anilist.jpg" },
        startDate: { year: 2025, month: 3, day: 4 },
        episodes: 26,
      },
    );
    const count = vi.fn();
    render(
      hero({
        kitsuId: "missing",
        anilistId: 99,
        initialDetail: snapshot(),
        onCountLoaded: count,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "AniList title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AniList native")).toBeInTheDocument();
    expect(screen.getByText("26 EPISODES")).toBeInTheDocument();
    expect(count).toHaveBeenLastCalledWith(26);
  });
  it("uses AniList manga fields after Kitsu fails", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("kitsu.app")) throw new Error("blocked");
      return Response.json({
        data: {
          Media: {
            title: { romaji: "Fallback manga" },
            chapters: 42,
            coverImage: { extraLarge: "https://images.example.test/manga.jpg" },
            bannerImage: "https://images.example.test/manga-banner.jpg",
            startDate: { year: 2021, month: 8 },
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetch);
    render(hero({ kitsuId: "9", anilistId: 45, mediaType: "manga" }));
    expect(
      await screen.findByRole("heading", { name: "Fallback manga" }),
    ).toBeInTheDocument();
    expect(screen.getByText("42 CHAPTERS")).toBeInTheDocument();
  });
  it("preserves the snapshot on malformed or failed fallback data and resets it when the selected title changes", async () => {
    providers({}, null);
    const { rerender } = render(
      hero({ initialDetail: snapshot(), anilistId: 1 }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      screen.getByRole("heading", { name: "Cached title" }),
    ).toBeInTheDocument();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    rerender(
      hero({
        initialDetail: snapshot({
          titleEn: null,
          titleRomaji: "Replacement",
          titleJp: null,
          episodeCount: null,
          chapterCount: 3,
        }),
        anilistId: 2,
        mediaType: "manga",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Replacement" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 CHAPTERS")).toBeInTheDocument();
  });
  it.each([null, "not-a-date"])(
    "keeps an available anime season if its date is %s",
    async (startDate) => {
      providers(
        {
          findAnimeById: {
            titles: { canonical: "Season only" },
            season: "fall",
            startDate,
          },
        },
        null,
      );
      render(hero({ kitsuId: "7" }));
      expect(await screen.findByText("FALL")).toBeInTheDocument();
    },
  );
  it("does not overwrite a newly selected title with a late response", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    const { rerender } = render(hero({ anilistId: 1 }));
    rerender(
      hero({ initialDetail: snapshot({ titleEn: "New selected title" }) }),
    );
    await act(async () =>
      resolve(
        Response.json({
          data: { Media: { title: { english: "Stale title" } } },
        }),
      ),
    );
    expect(
      screen.getByRole("heading", { name: "New selected title" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Stale title")).not.toBeInTheDocument();
  });
});
describe("provider details", () => {
  it("shows an explicit unavailable state when no provider or snapshot is available", () => {
    render(details());
    expect(screen.getByText(/Details are unavailable/)).toBeInTheDocument();
  });
  it("shows cached synopsis, dates and a normalized rating without waiting for network", () => {
    render(details({ initialDetail: snapshot() }));
    expect(screen.getByText("Cached synopsis")).toBeInTheDocument();
    expect(screen.getByText(/2024-01-02 to Present/)).toBeInTheDocument();
    expect(screen.getByText("(8.5/10)")).toBeInTheDocument();
  });
  it("merges Kitsu details and AniList links while deduplicating streaming destinations", async () => {
    providers(
      {
        findAnimeById: {
          description: { en: "English synopsis", en_jp: "Other synopsis" },
          startDate: "2024-02-03",
          endDate: "2024-08-03",
          episodeCount: 24,
          averageRating: 70,
          productions: {
            nodes: [
              { company: { name: "Production Studio" } },
              { company: null },
            ],
          },
          streamingLinks: {
            nodes: [
              {
                url: "https://netflix.com/title/one",
                streamer: { siteName: "Netflix" },
              },
              { url: "", streamer: null },
            ],
          },
        },
      },
      {
        genres: ["Adventure", null, ""],
        studios: { nodes: [{ name: "Animation Studio" }, { name: null }] },
        averageScore: 91,
        externalLinks: [
          { site: "Netflix", url: "https://netflix.com/title/two" },
          { site: "Official", url: "https://official.example.test" },
          { site: "Duplicate", url: "https://official.example.test" },
          { site: null, url: null },
        ],
        trailer: { site: "youtube", id: "trailer-id" },
      },
    );
    render(details({ kitsuId: "7", anilistId: 8 }));
    expect(await screen.findByText("English synopsis")).toBeInTheDocument();
    expect(screen.getByText("Adventure")).toBeInTheDocument();
    expect(screen.getByText(/Production Studio/)).toBeInTheDocument();
    expect(screen.getByText(/Animation Studio/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Netflix" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Official" })).toHaveAttribute(
      "href",
      "https://official.example.test",
    );
    expect(
      screen.queryByRole("link", { name: "Duplicate" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("(9.1/10)")).toBeInTheDocument();
    expect(screen.getByTitle("Trailer")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/trailer-id",
    );
  });
  it("supports manga's localized description and Kitsu rating without AniList", async () => {
    providers(
      {
        findMangaById: {
          description: { fr: "French synopsis" },
          startDate: "invalid",
          endDate: "2024-01-02",
          chapterCount: 100,
          volumeCount: 10,
          averageRating: 80,
          streamingLinks: {
            nodes: [{ url: "https://stream.example.test", streamer: null }],
          },
        },
      },
      null,
    );
    render(details({ kitsuId: "9", mediaType: "manga" }));
    expect(await screen.findByText("French synopsis")).toBeInTheDocument();
    expect(screen.getByText(/Unknown to 2024-01-02/)).toBeInTheDocument();
    expect(screen.getByText("(8/10)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Streaming" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
  it("falls back to AniList and its Dailymotion trailer after an unmatched Kitsu result", async () => {
    providers(
      { findMangaById: null },
      {
        description: "Fallback synopsis",
        startDate: { year: 2022, month: 1, day: 3 },
        chapters: 40,
        volumes: 5,
        genres: ["Drama"],
        externalLinks: [{ url: "https://fallback.example.test" }],
        trailer: { site: "dailymotion", id: "video-id" },
      },
    );
    render(details({ kitsuId: "none", mediaType: "manga", anilistId: 21 }));
    expect(await screen.findByText("Fallback synopsis")).toBeInTheDocument();
    expect(screen.getByTitle("Trailer")).toHaveAttribute(
      "src",
      "https://www.dailymotion.com/embed/video/video-id",
    );
    expect(screen.getByRole("link", { name: "Website" })).toBeInTheDocument();
  });
  it("retains cached values when AniList fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(details({ initialDetail: snapshot(), anilistId: 2 }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByText("Cached synopsis")).toBeInTheDocument();
  });
});

describe("media detail layout composition", () => {
  it("renders an anime cover, alternate title and supplied sidebar sections", () => {
    render(
      <MediaDetailLayout
        title="Selected anime"
        mediaType="anime"
        subtitle="Alternate title"
        heroBanner="https://images.example.test/banner.jpg"
        coverImage="https://images.example.test/cover.jpg"
        heroOverlay={<span>Overlay decoration</span>}
        heroChips={<span>12 episodes</span>}
        quickActions={<button type="button">Edit entry</button>}
        listStatus={<span>Watching</span>}
        collectionOwnership={<span>Two discs owned</span>}
        sidebarExtra={<span>Related series</span>}
        seriesDetails={<span>Series synopsis</span>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Selected anime" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Selected anime" })).toHaveAttribute(
      "src",
      "https://images.example.test/cover.jpg",
    );
    expect(screen.getByText("Alternate title")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Anime List Entry" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Collection Details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit entry" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Two discs owned")).toBeInTheDocument();
    expect(screen.getByText("Related series")).toBeInTheDocument();
    expect(screen.getByText("Series synopsis")).toBeInTheDocument();
  });
  it("supports sparse manga without inventing a cover, subtitle or owned collection", () => {
    render(
      <MediaDetailLayout
        title="Selected manga"
        mediaType="manga"
        heroBanner={null}
        coverImage={null}
        heroChips={null}
        listStatus={<span>Not tracked</span>}
        seriesDetails={<span>No provider details</span>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Selected manga" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Manga List Entry" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Collection Details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Not tracked")).toBeInTheDocument();
  });
  it("lets a provider hero replace the default hero without dropping list and detail content", () => {
    render(
      <MediaDetailLayout
        title="Unused fallback"
        mediaType="anime"
        heroBanner={null}
        coverImage={null}
        heroContent={<h1>Provider hero</h1>}
        heroOverlay={<span>Unused overlay</span>}
        heroChips={<span>Unused chips</span>}
        listStatus={<span>Completed</span>}
        seriesDetails={<span>Provider synopsis</span>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Provider hero" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unused fallback")).not.toBeInTheDocument();
    expect(screen.queryByText("Unused overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("Unused chips")).not.toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Provider synopsis")).toBeInTheDocument();
  });
});

describe("sparse and changing provider detail responses", () => {
  it.each([null, [], { en: " ", en_jp: "Translated fallback" }])(
    "handles a sparse Kitsu description %j without fabricating metadata",
    async (description) => {
      const fetch = providers(
        { findAnimeById: { description, averageRating: null } },
        null,
      );
      render(details({ kitsuId: "sparse" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      if (description && !Array.isArray(description))
        expect(
          await screen.findByText("Translated fallback"),
        ).toBeInTheDocument();
      else
        await waitFor(() =>
          expect(screen.queryByText(/Rating:/)).not.toBeInTheDocument(),
        );
      expect(screen.queryByText(/Productions:/)).not.toBeInTheDocument();
      expect(screen.queryByTitle("Trailer")).not.toBeInTheDocument();
    },
  );
  it("preserves snapshot fields when AniList has no optional metadata and then displays supplied end date and studios", async () => {
    const fetch = providers(
      {},
      {
        description: [],
        genres: {},
        studios: null,
        externalLinks: null,
        trailer: {},
      },
    );
    const { rerender } = render(
      details({
        anilistId: 1,
        initialDetail: snapshot({ averageRating: null }),
      }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.getByText("Cached synopsis")).toBeInTheDocument();
    providers(
      {},
      {
        description: { en: "English fallback" },
        endDate: { year: 2025, month: 5, day: 6 },
        studios: { nodes: [{ name: "Studio" }, { name: " " }] },
        externalLinks: [
          { site: " ", url: "https://site.example.test" },
          { site: "Missing", url: " " },
        ],
      },
    );
    rerender(details({ anilistId: 2 }));
    expect(await screen.findByText("English fallback")).toBeInTheDocument();
    expect(screen.getByText(/Unknown to 2025-05-06/)).toBeInTheDocument();
    expect(screen.getByText(/Studio$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute(
      "href",
      "https://site.example.test",
    );
    expect(
      screen.queryByRole("link", { name: "Missing" }),
    ).not.toBeInTheDocument();
  });
  it("does not replace the new snapshot when an obsolete Kitsu request completes", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    const { rerender } = render(details({ kitsuId: "old" }));
    rerender(
      details({
        initialDetail: snapshot({ synopsis: "New selected synopsis" }),
      }),
    );
    await act(async () =>
      resolve(
        Response.json({
          data: { findAnimeById: { description: "Obsolete synopsis" } },
        }),
      ),
    );
    expect(screen.getByText("New selected synopsis")).toBeInTheDocument();
    expect(screen.queryByText("Obsolete synopsis")).not.toBeInTheDocument();
  });
  it("keeps selected details when Kitsu fails but AniList fallback succeeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("kitsu.app"))
          throw new Error("Kitsu blocked");
        return Response.json({
          data: {
            Media: {
              description: "AniList recovery",
              episodes: 26,
              averageScore: 78,
            },
          },
        });
      }),
    );
    render(details({ kitsuId: "blocked", anilistId: 7 }));
    expect(await screen.findByText("AniList recovery")).toBeInTheDocument();
    expect(screen.getByText("(7.8/10)")).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });
  it("ignores an obsolete AniList enrichment response after a different title is selected", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("kitsu.app"))
        return Response.json({
          data: { findAnimeById: { description: "Old Kitsu description" } },
        });
      return new Promise<Response>((r) => {
        resolve = r;
      });
    });
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(details({ kitsuId: "old", anilistId: 4 }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    rerender(
      details({ initialDetail: snapshot({ synopsis: "New selection" }) }),
    );
    await act(async () =>
      resolve(Response.json({ data: { Media: { genres: ["Stale genre"] } } })),
    );
    expect(screen.getByText("New selection")).toBeInTheDocument();
    expect(screen.queryByText("Old Kitsu description")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale genre")).not.toBeInTheDocument();
  });
  it("retains a cached synopsis when neither provider finds a match", async () => {
    const fetch = providers({ findAnimeById: null }, null);
    render(
      details({ kitsuId: "missing", anilistId: 6, initialDetail: snapshot() }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Cached synopsis")).toBeInTheDocument();
    expect(screen.getByText("(8.5/10)")).toBeInTheDocument();
  });
});
