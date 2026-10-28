import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  Anime,
  AnimeCollectionItem,
  Manga,
  MangaCollectionItem,
} from "@/generated/prisma/client";
import type { AnimeWithEntry, MangaWithEntry } from "@/lib/list";
import AnimeCard from "./AnimeCard";
import { AnimeCollectionGrid } from "./AnimeCollectionGrid";
import ExternalLinkIcon from "./ExternalLinkIcon";
import MangaCard from "./MangaCard";
import { MangaCollectionGrid } from "./MangaCollectionGrid";

const media = {
  id: "local",
  kitsuId: "123",
  titleEn: "English title",
  titleRomaji: "Romaji title",
  titleJp: "日本語",
  coverImageUrl: "https://example.invalid/cover.png",
  episodeCount: 12,
  chapterCount: 30,
  volumeCount: 5,
};
const entry = {
  watchStatus: "WATCHING",
  readStatus: "READING",
  progress: 3,
  progressVolumes: 2,
  rewatching: true,
  rereading: true,
  rewatchCount: 2,
  rereadCount: 3,
  rating: 7,
  notes: "Remember this episode",
};

it.each(["anime", "manga"] as const)(
  "keeps %s card navigation, progress, rating and editing attached to its entry",
  (type) => {
    const item = { ...media, listEntry: entry };
    const edit = vi.fn();
    const { rerender } = render(
      type === "anime" ? (
        <AnimeCard
          item={item as unknown as AnimeWithEntry}
          detailHref="/detail/123"
          canEdit
          onEdit={edit}
        />
      ) : (
        <MangaCard
          item={item as unknown as MangaWithEntry}
          detailHref="/detail/123"
          canEdit
          onEdit={edit}
        />
      ),
    );
    expect(
      screen.getByRole("link", { name: "View English title" }),
    ).toHaveAttribute("href", "/detail/123");
    expect(screen.getByRole("img", { name: "English title" })).toHaveAttribute(
      "src",
      media.coverImageUrl,
    );
    expect(screen.getByText("日本語")).toBeInTheDocument();
    expect(
      screen.getByText(type === "anime" ? "3 / 12 ep" : "3 / 30 ch"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(type === "anime" ? "Watching" : "Reading"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ReplayIcon")).toBeInTheDocument();
    expect(
      screen.getByText(type === "anime" ? "×2" : "×3"),
    ).toBeInTheDocument();
    expect(screen.getByText("7.0")).toBeInTheDocument();
    expect(screen.getByText(entry.notes)).toBeInTheDocument();
    if (type === "manga")
      expect(screen.getByText("· 2 / 5 vol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit English title" }));
    expect(edit).toHaveBeenCalledExactlyOnceWith(item);
    rerender(
      type === "anime" ? (
        <AnimeCard
          item={item as unknown as AnimeWithEntry}
          detailHref="/detail/123"
          canEdit={false}
          onEdit={edit}
        />
      ) : (
        <MangaCard
          item={item as unknown as MangaWithEntry}
          detailHref="/detail/123"
          canEdit={false}
          onEdit={edit}
        />
      ),
    );
    expect(
      screen.queryByRole("button", { name: /Edit/ }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  ["Romaji title", null, "Romaji title", null],
  ["日本語", null, null, "日本語"],
  ["Unknown", null, null, null],
] as const)(
  "uses %s title fallback and handles missing list entries and artwork",
  (title, titleEn, titleRomaji, titleJp) => {
    const item = {
      ...media,
      titleEn,
      titleRomaji,
      titleJp,
      coverImageUrl: null,
      episodeCount: null,
      chapterCount: null,
      listEntry: null,
    };
    const { rerender } = render(
      <AnimeCard
        item={item as unknown as AnimeWithEntry}
        detailHref="/a"
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: `View ${title}` }),
    ).toBeInTheDocument();
    expect(screen.getByText("No image")).toBeInTheDocument();
    expect(screen.getByText("0 ep")).toBeInTheDocument();
    expect(screen.queryByTestId("ReplayIcon")).not.toBeInTheDocument();
    rerender(
      <MangaCard
        item={item as unknown as MangaWithEntry}
        detailHref="/m"
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: `View ${title}` }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 ch")).toBeInTheDocument();
    expect(screen.queryByText(/vol/)).not.toBeInTheDocument();
  },
);

it.each([
  ["PLAN_TO_WATCH", "PLAN_TO_READ", "Plan to Watch", "Want to Read"],
  ["COMPLETED", "COMPLETED", "Completed", "Completed"],
  ["ON_HOLD", "ON_HOLD", "On Hold", "On Hold"],
  ["DROPPED", "DROPPED", "Dropped", "Dropped"],
  ["WATCHING", "READING", "Watching", "Reading"],
])(
  "shows saved %s/%s statuses without an active repeat indicator",
  (watchStatus, readStatus, animeLabel, mangaLabel) => {
    const item = {
      ...media,
      volumeCount: null,
      listEntry: {
        ...entry,
        watchStatus,
        readStatus,
        rewatching: false,
        rereading: false,
        rewatchCount: 0,
        rereadCount: 0,
        rating: null,
        notes: "",
      },
    };
    const { rerender } = render(
      <AnimeCard
        item={item as unknown as AnimeWithEntry}
        detailHref="/a"
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(animeLabel)).toBeInTheDocument();
    expect(screen.queryByTestId("ReplayIcon")).not.toBeInTheDocument();
    expect(screen.queryByText("7.0")).not.toBeInTheDocument();
    rerender(
      <MangaCard
        item={item as unknown as MangaWithEntry}
        detailHref="/m"
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(mangaLabel)).toBeInTheDocument();
    expect(screen.getByText("· 2 vol")).toBeInTheDocument();
    expect(screen.queryByTestId("ReplayIcon")).not.toBeInTheDocument();
  },
);

type AnimeCollection = AnimeCollectionItem & { anime: Anime };
type MangaCollection = MangaCollectionItem & { manga: Manga };
it("renders anime collection format/rarity and gates edit links without changing detail navigation", () => {
  const item = {
    id: "disc",
    rarity: "COLLECTORS",
    format: "BLU_RAY",
    anime: media,
  } as unknown as AnimeCollection;
  const { rerender } = render(<AnimeCollectionGrid items={[item]} />);
  expect(screen.getByText("Collector's")).toBeInTheDocument();
  expect(screen.getByText("Blu-ray")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "View English title" }),
  ).toHaveAttribute("href", "/anime/english-title/123");
  expect(
    screen.queryByRole("link", { name: "Edit English title" }),
  ).not.toBeInTheDocument();
  rerender(<AnimeCollectionGrid items={[item]} isAuthenticated />);
  expect(
    screen.getByRole("link", { name: "Edit English title" }),
  ).toHaveAttribute("href", "/collection/anime/disc/edit");
});

it("renders persisted unfamiliar anime labels and placeholder artwork without hiding the item", () => {
  const item = {
    id: "disc",
    rarity: "CUSTOM",
    format: "NEW_FORMAT",
    anime: { ...media, titleEn: null, coverImageUrl: null },
  } as unknown as AnimeCollection;
  render(<AnimeCollectionGrid items={[item]} isAuthenticated />);
  expect(screen.getByText("CUSTOM")).toBeInTheDocument();
  expect(screen.getByText("NEW_FORMAT")).toBeInTheDocument();
  expect(screen.getByRole("presentation")).toHaveAttribute(
    "src",
    "/placeholder.png",
  );
  expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
    "href",
    "/collection/anime/disc/edit",
  );
});

it.each(["ENGLISH", "JAPANESE", "OTHER", "CUSTOM"])(
  "renders %s manga collection ranges and authenticated edit destination",
  (language) => {
    const item = {
      id: "book",
      language,
      volumes: [1, 2, 4],
      chapters: [2, 3, 4],
      manga: media,
    } as unknown as MangaCollection;
    const { rerender } = render(
      <MangaCollectionGrid items={[item]} isAuthenticated />,
    );
    expect(screen.getByText("Vol 1-2, 4")).toBeInTheDocument();
    expect(screen.getByText("Ch 2-4")).toBeInTheDocument();
    expect(
      screen.getByText(
        (
          {
            ENGLISH: "English",
            JAPANESE: "Japanese",
            OTHER: "Other",
          } as Record<string, string>
        )[language] ?? language,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Edit English title" }),
    ).toHaveAttribute("href", "/collection/manga/book/edit");
    rerender(
      <MangaCollectionGrid
        items={[
          {
            ...item,
            volumes: [],
            chapters: [],
            manga: { ...item.manga, titleEn: null, coverImageUrl: null },
          },
        ]}
      />,
    );
    expect(screen.queryByText(/^Vol /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ch /)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Edit/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      "/placeholder.png",
    );
  },
);

it("renders empty grids without phantom cards or actions", () => {
  const { rerender } = render(
    <AnimeCollectionGrid items={[]} isAuthenticated />,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  rerender(<MangaCollectionGrid items={[]} isAuthenticated />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("renders a service icon decoratively without adding an accessible image", () => {
  const { container } = render(
    <ExternalLinkIcon
      site="youtube"
      url="https://youtube.com/watch?v=example"
    />,
  );
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("renders service artwork decoratively with its asset path", () => {
  const { container } = render(
    <ExternalLinkIcon site="crunchyroll" url="https://crunchyroll.com" />,
  );
  const image = container.querySelector("img");
  expect(image).toHaveAttribute("src", "/crunchyroll.svg");
  expect(image).toHaveAttribute("aria-hidden", "true");
  expect(image).toHaveAttribute("alt", "");
});
