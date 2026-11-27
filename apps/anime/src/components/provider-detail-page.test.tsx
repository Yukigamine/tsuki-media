import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AnimeCollectionItem,
  AnimeListEntry,
  MangaCollectionItem,
  MangaListEntry,
} from "@/generated/prisma/client";
import ProviderMediaDetailPage from "./ProviderMediaDetailPage";

// Child widgets have dedicated behavior tests; these fakes expose the page's data joins.
vi.mock("@/components/MediaDetailLayout", () => ({
  default: (props: Record<string, ReactNode>) => (
    <main>
      <h1>{props.title}</h1>
      {props.heroContent}
      {props.quickActions}
      {props.listStatus}
      {props.collectionOwnership}
      {props.sidebarExtra}
      {props.seriesDetails}
    </main>
  ),
}));
vi.mock("@/components/ProviderMediaHero", () => ({
  default: ({
    extraChips,
    onCountLoaded,
  }: {
    extraChips: ReactNode;
    onCountLoaded: (count: number) => void;
  }) => (
    <section>
      {extraChips}
      <button type="button" onClick={() => onCountLoaded(24)}>
        Update provider count
      </button>
    </section>
  ),
}));
vi.mock("@/components/AnimeDetailActions", () => ({
  default: ({ episodeCount }: { episodeCount: number | null }) => (
    <button type="button">Anime actions: {episodeCount ?? "unknown"}</button>
  ),
}));
vi.mock("@/components/MangaDetailActions", () => ({
  default: ({
    chapterCount,
    volumeCount,
  }: {
    chapterCount: number | null;
    volumeCount: number | null;
  }) => (
    <button type="button">
      Manga actions: {chapterCount ?? "unknown"} chapters,{" "}
      {volumeCount ?? "unknown"} volumes
    </button>
  ),
}));
vi.mock("@/components/ProviderSeriesDetails", () => ({
  default: () => <section>Series details</section>,
}));
vi.mock("@/components/RelatedMediaCards", () => ({
  default: ({ kitsuId }: { kitsuId: string }) => (
    <section>Related to {kitsuId}</section>
  ),
}));
const page = (
  props: Partial<ComponentProps<typeof ProviderMediaDetailPage>> = {},
) => (
  <ProviderMediaDetailPage
    kitsuId={null}
    fallbackTitle="fallback-title"
    mediaType="anime"
    mediaId={null}
    anilistId={null}
    initialDetail={null}
    hasSession={false}
    listEntry={null}
    collectionCount={0}
    {...props}
  />
);
const anime = (extra: Partial<AnimeListEntry> = {}): AnimeListEntry => ({
  id: "a",
  animeId: "a",
  private: false,
  kitsuEntryId: null,
  anilistEntryId: null,
  startedAt: null,
  createdAt: new Date(0),
  updatedAt: null,
  watchStatus: "WATCHING",
  rewatching: true,
  progress: 2,
  rating: 8,
  rewatchCount: 1,
  notes: "Remember episode 3",
  completedAt: new Date("2025-01-01"),
  ...extra,
});
const manga = (extra: Partial<MangaListEntry> = {}): MangaListEntry => ({
  id: "m",
  mangaId: "m",
  private: false,
  notes: null,
  rereadCount: 0,
  kitsuEntryId: null,
  anilistEntryId: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date(0),
  updatedAt: null,
  readStatus: "READING",
  rereading: true,
  progress: 5,
  progressVolumes: 2,
  rating: null,
  ...extra,
});
describe("provider detail page joins", () => {
  it("renders guest defaults without edit actions or unrelated provider requests", () => {
    render(page());
    expect(
      screen.getByRole("heading", { name: "fallback title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No list entry yet.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /actions:/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Related to/)).not.toBeInTheDocument();
    expect(screen.getByText("Series details")).toBeInTheDocument();
  });
  it("updates anime actions and progress when the provider resolves an episode count", () => {
    render(
      page({
        hasSession: true,
        listEntry: anime(),
        kitsuId: "42",
        collectionCount: 2,
        collectionFormats: ["BLU_RAY", "LIMITED_EDITION", "IMPORT"],
      }),
    );
    expect(
      screen.getByText("Blu-ray, Limited Edition, IMPORT"),
    ).toBeInTheDocument();
    expect(screen.getByText("Progress: 2")).toBeInTheDocument();
    expect(screen.getByText("Rating: 4/10")).toBeInTheDocument();
    expect(screen.getByText("Rewatches: 1")).toBeInTheDocument();
    expect(screen.getByText("Notes: Remember episode 3")).toBeInTheDocument();
    expect(screen.getByText("Related to 42")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Update provider count" }),
    );
    expect(
      screen.getByRole("button", { name: "Anime actions: 24" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Progress: 2 / 24")).toBeInTheDocument();
  });
  it.each(["PLAN_TO_WATCH", "COMPLETED", "ON_HOLD", "DROPPED"] as const)(
    "shows anime %s and missing optional details",
    (watchStatus) => {
      render(
        page({
          listEntry: anime({
            watchStatus,
            rewatching: false,
            rating: null,
            notes: null,
            completedAt: null,
          }),
          collectionCount: 1,
        }),
      );
      expect(
        screen.getByText(
          `Status: ${{ PLAN_TO_WATCH: "Want to Watch", COMPLETED: "Completed", ON_HOLD: "On Hold", DROPPED: "Dropped" }[watchStatus]}`,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("In collection (1)")).toBeInTheDocument();
      expect(screen.getByText("Rating: Not rated")).toBeInTheDocument();
      expect(screen.getByText("Completed: Not set")).toBeInTheDocument();
      expect(screen.queryByText(/Notes:/)).not.toBeInTheDocument();
    },
  );
  it("renders purchased anime editions including zero price without losing ownership fields", () => {
    const item = {
      id: "copy",
      animeId: "a",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      format: "BLU_RAY",
      rarity: "LIMITED",
      condition: "NEAR_MINT",
      purchasedAt: new Date("2025-01-01"),
      pricePaid: 0,
      barcode: "123",
      notes: "Signed",
    } satisfies AnimeCollectionItem;
    render(
      page({
        collectionCount: 2,
        collectionItems: [
          item,
          {
            ...item,
            id: "copy2",
            purchasedAt: null,
            pricePaid: null,
            barcode: null,
            notes: null,
          },
        ],
      }),
    );
    expect(screen.getAllByText("Format: Blu Ray")).toHaveLength(2);
    expect(screen.getByText("Price: $0.00")).toBeInTheDocument();
    expect(screen.getByText("Barcode: 123")).toBeInTheDocument();
    expect(screen.getByText("Notes: Signed")).toBeInTheDocument();
  });
  it("renders manga progress and bundled volumes and chapters", () => {
    const item = {
      id: "copy",
      mangaId: "m",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      condition: "MINT",
      language: "JAPANESE",
      volumes: [1, 2],
      chapters: [3, 4],
      containsSerialized: true,
      containsOmnibus: true,
      notes: "Box set",
    } satisfies MangaCollectionItem;
    render(
      page({
        mediaType: "manga",
        hasSession: true,
        listEntry: manga(),
        collectionCount: 1,
        collectionItems: [item],
      }),
    );
    for (const text of [
      "Volume progress: 2",
      "Volumes: 1, 2",
      "Chapters: 3, 4",
      "Includes: Serialized, Omnibus",
      "Language: Japanese",
      "Notes: Box set",
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Manga actions: unknown chapters, unknown volumes",
      }),
    ).toBeInTheDocument();
  });
  it.each(["PLAN_TO_READ", "COMPLETED", "ON_HOLD", "DROPPED"] as const)(
    "renders manga %s without unavailable collection detail",
    (readStatus) => {
      const item = {
        id: "copy",
        mangaId: "m",
        createdAt: new Date(0),
        updatedAt: new Date(0),
        condition: "GOOD",
        language: "ENGLISH",
        volumes: [],
        chapters: [],
        containsSerialized: false,
        containsOmnibus: false,
        notes: null,
      } satisfies MangaCollectionItem;
      render(
        page({
          mediaType: "manga",
          listEntry: manga({ readStatus, rereading: false, rating: 6 }),
          collectionCount: 1,
          collectionItems: [item],
        }),
      );
      expect(
        screen.getByText(
          `Status: ${{ PLAN_TO_READ: "Want to Read", COMPLETED: "Completed", ON_HOLD: "On Hold", DROPPED: "Dropped" }[readStatus]}`,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Volumes: None")).toBeInTheDocument();
      expect(screen.getByText("Chapters: None")).toBeInTheDocument();
      expect(screen.queryByText(/Includes:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Rewatches:/)).not.toBeInTheDocument();
    },
  );
});
