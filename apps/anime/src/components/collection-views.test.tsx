import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  Anime,
  AnimeCollectionItem,
  Manga,
  MangaCollectionItem,
} from "@/generated/prisma/client";
import type { AnimeWithEntry, MangaWithEntry } from "@/lib/list";
import { CollectionViewWrapper } from "./CollectionViewWrapper";
import { MediaListTable } from "./MediaListTable";

type AnimeItem = AnimeCollectionItem & { anime: Anime };
type MangaItem = MangaCollectionItem & { manga: Manga };
const anime = (id: string, title: string | null, format = "BLU_RAY") =>
  ({
    id,
    format,
    rarity: "STANDARD",
    condition: "GOOD",
    purchasedAt: new Date("2025-04-01T12:00:00Z"),
    pricePaid: 13.5,
    anime: {
      id: `a-${id}`,
      kitsuId: `k-${id}`,
      titleEn: title,
      titleRomaji: title === null ? "Romaji fallback" : null,
      titleJp: null,
      coverImageUrl: null,
    },
  }) as unknown as AnimeItem;
const manga = (id: string, title: string | null, language = "ENGLISH") =>
  ({
    id,
    language,
    condition: "MINT",
    volumes: [1, 2, 3],
    chapters: [1, 2],
    manga: {
      id: `m-${id}`,
      kitsuId: `k-${id}`,
      titleEn: title,
      titleRomaji: null,
      titleJp: null,
      coverImageUrl: "https://example.invalid/cover.png",
    },
  }) as unknown as MangaItem;
function Grid({
  items,
  isAuthenticated,
}: {
  items: { id: string }[];
  isAuthenticated: boolean;
}) {
  return (
    <div data-testid="grid" data-editable={isAuthenticated}>
      {items.map(({ id }) => (
        <span key={id}>{id}</span>
      ))}
    </div>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("filters format tabs and debounced title search together without changing underlying collection counts", async () => {
  vi.useFakeTimers();
  const items = [
    anime("disc-one", "Alpha"),
    anime("disc-two", "Beta", "DVD"),
    anime("disc-three", null),
  ];
  render(
    <CollectionViewWrapper items={items} type="anime" gridComponent={Grid} />,
  );
  expect(screen.getByRole("tab", { name: "All 3" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /VHS/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Blu-ray 2" }));
  expect(screen.getByTestId("grid")).toHaveTextContent("disc-one");
  expect(screen.getByTestId("grid")).not.toHaveTextContent("disc-two");
  fireEvent.change(screen.getByPlaceholderText("Search..."), {
    target: { value: "  ROMAJI  " },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  expect(screen.getByTestId("grid")).toHaveTextContent("disc-three");
  expect(screen.getByTestId("grid")).not.toHaveTextContent("disc-one");
  expect(screen.getByRole("tab", { name: "All 3" })).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Search..."), {
    target: { value: "absent" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  expect(screen.getByText("No collection items found")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByTestId("grid")).toHaveTextContent("disc-one");
});

it("renders anime table detail links and edit controls only for authenticated viewers", () => {
  const item = anime("42", "Alpha Title");
  const { rerender } = render(
    <CollectionViewWrapper items={[item]} type="anime" gridComponent={Grid} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "table view" }));
  expect(screen.getByRole("link", { name: "Alpha Title" })).toHaveAttribute(
    "href",
    "/anime/alpha-title/k-42",
  );
  expect(screen.getByRole("img", { name: "Alpha Title" })).toHaveAttribute(
    "src",
    "/placeholder.png",
  );
  expect(screen.getByText("$13.50")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Edit Alpha Title" }),
  ).not.toBeInTheDocument();
  rerender(
    <CollectionViewWrapper
      items={[item]}
      type="anime"
      gridComponent={Grid}
      isAuthenticated
    />,
  );
  expect(
    screen.getByRole("link", { name: "Edit Alpha Title" }),
  ).toHaveAttribute("href", "/collection/anime/42/edit");
  expect(screen.getByLabelText("Add anime to collection")).toBeInTheDocument();
});

it("renders manga language filtering, unknown title fallback and volume/chapter counts", () => {
  const items = [
    manga("english", "Book"),
    { ...manga("japanese", null, "JAPANESE"), volumes: [], chapters: [] },
  ];
  render(
    <CollectionViewWrapper
      items={items}
      type="manga"
      gridComponent={Grid}
      isAuthenticated
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "English 1" }));
  expect(screen.getByTestId("grid")).not.toHaveTextContent("japanese");
  fireEvent.click(screen.getByRole("tab", { name: "All 2" }));
  fireEvent.click(screen.getByRole("button", { name: "table view" }));
  expect(
    screen.getByRole("columnheader", { name: "Language" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("columnheader", { name: "Price" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Unknown" })).toHaveAttribute(
    "href",
    "/manga/untitled/k-japanese",
  );
  const row = screen
    .getByRole("link", { name: "Book" })
    .closest("tr") as HTMLElement;
  expect(within(row).getByText("3")).toBeInTheDocument();
  expect(within(row).getByText("2")).toBeInTheDocument();
  expect(within(row).getByText("🇬🇧 English")).toBeInTheDocument();
});

it("renders an empty collection without empty tabs or edit affordances", () => {
  render(
    <CollectionViewWrapper items={[]} type="anime" gridComponent={Grid} />,
  );
  expect(screen.getByText("No collection items found")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it.each(["anime", "manga"] as const)(
  "keeps %s list status/progress and edit callbacks tied to the selected row",
  (type) => {
    const base = {
      id: "42",
      kitsuId: "k42",
      titleEn: "Media",
      titleRomaji: null,
      titleJp: null,
      coverImageUrl: null,
      episodeCount: 12,
      chapterCount: 20,
      listEntry: {
        watchStatus: "ON_HOLD",
        readStatus: "PLAN_TO_READ",
        progress: 3,
        rating: 4,
        rewatchCount: 2,
        rereadCount: 1,
      },
    };
    const edit = vi.fn();
    const props: ComponentProps<typeof MediaListTable> =
      type === "anime"
        ? {
            type,
            items: [base as unknown as AnimeWithEntry],
            onEdit: edit,
            canEdit: true,
          }
        : {
            type,
            items: [base as unknown as MangaWithEntry],
            onEdit: edit,
            canEdit: true,
          };
    const { rerender } = render(<MediaListTable {...props} />);
    expect(screen.getByRole("link", { name: "Media" })).toHaveAttribute(
      "href",
      `/${type}/media/k42`,
    );
    expect(
      screen.getByText(type === "anime" ? "3 / 12" : "3 ch / 20"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(type === "anime" ? "ON HOLD" : "PLAN TO READ"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Media" }));
    expect(edit).toHaveBeenCalledWith(base);
    rerender(<MediaListTable {...props} canEdit={false} />);
    expect(
      screen.queryByRole("button", { name: "Edit Media" }),
    ).not.toBeInTheDocument();
  },
);

it.each(["anime", "manga"] as const)(
  "renders incomplete %s list entries without inventing status, rating or progress totals",
  (type) => {
    const items = [
      {
        id: "romaji",
        kitsuId: "1",
        titleEn: null,
        titleRomaji: "Romaji",
        titleJp: null,
        coverImageUrl: "https://example.invalid/cover.png",
        listEntry: null,
        episodeCount: null,
        chapterCount: null,
      },
      {
        id: "japanese",
        kitsuId: "2",
        titleEn: null,
        titleRomaji: null,
        titleJp: "日本語",
        coverImageUrl: null,
        listEntry: null,
        episodeCount: null,
        chapterCount: null,
      },
      {
        id: "unknown",
        kitsuId: "3",
        titleEn: null,
        titleRomaji: null,
        titleJp: null,
        coverImageUrl: null,
        listEntry: null,
        episodeCount: null,
        chapterCount: null,
      },
    ];
    render(
      type === "anime" ? (
        <MediaListTable
          type="anime"
          items={items as unknown as AnimeWithEntry[]}
          onEdit={vi.fn()}
          canEdit={false}
        />
      ) : (
        <MediaListTable
          type="manga"
          items={items as unknown as MangaWithEntry[]}
          onEdit={vi.fn()}
          canEdit={false}
        />
      ),
    );
    for (const title of ["Romaji", "日本語", "Unknown"]) {
      const row = screen
        .getByRole("link", { name: title })
        .closest("tr") as HTMLElement;
      expect(
        within(row).getByText(type === "anime" ? "0 / ?" : "0 ch / ?"),
      ).toBeInTheDocument();
      expect(within(row).getAllByText("—")).toHaveLength(2);
      expect(within(row).getByText("0")).toBeInTheDocument();
    }
    expect(screen.getByRole("img", { name: "Romaji" })).toHaveAttribute(
      "src",
      "https://example.invalid/cover.png",
    );
    expect(
      screen.queryByRole("button", { name: /Edit/ }),
    ).not.toBeInTheDocument();
  },
);

it("keeps Japanese-only collection titles searchable and renders unknown purchase information honestly", async () => {
  vi.useFakeTimers();
  const item = {
    ...anime("localized", null),
    purchasedAt: null,
    pricePaid: null,
    anime: {
      ...anime("localized", null).anime,
      titleRomaji: null,
      titleJp: "日本語",
      coverImageUrl: "https://example.invalid/cover.png",
    },
  };
  render(
    <CollectionViewWrapper items={[item]} type="anime" gridComponent={Grid} />,
  );
  fireEvent.change(screen.getByPlaceholderText("Search..."), {
    target: { value: "日本語" },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  fireEvent.click(screen.getByRole("button", { name: "table view" }));
  const row = screen
    .getByRole("link", { name: "日本語" })
    .closest("tr") as HTMLElement;
  expect(within(row).getAllByText("—")).toHaveLength(2);
  expect(within(row).getByRole("img", { name: "日本語" })).toHaveAttribute(
    "src",
    "https://example.invalid/cover.png",
  );
});

it("renders manga missing artwork in table view and preserves grid permissions after toggling", () => {
  const item = {
    ...manga("empty", "Sparse book"),
    volumes: [],
    chapters: [],
    manga: { ...manga("empty", "Sparse book").manga, coverImageUrl: null },
  };
  render(
    <CollectionViewWrapper
      items={[item]}
      type="manga"
      gridComponent={Grid}
      isAuthenticated
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "table view" }));
  const row = screen
    .getByRole("link", { name: "Sparse book" })
    .closest("tr") as HTMLElement;
  expect(within(row).getByRole("img", { name: "Sparse book" })).toHaveAttribute(
    "src",
    "/placeholder.png",
  );
  expect(within(row).getAllByText("0")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "grid view" }));
  expect(screen.getByTestId("grid")).toHaveAttribute("data-editable", "true");
  expect(screen.getByTestId("grid")).toHaveTextContent("empty");
});
