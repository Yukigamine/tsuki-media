import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  library: vi.fn(),
  session: vi.fn(),
  requireSession: vi.fn(),
  anime: vi.fn(),
  manga: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("not-found");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: f.notFound }));
vi.mock("@/lib/prisma", () => ({
  default: {
    animeCollectionItem: { findUnique: f.anime },
    mangaCollectionItem: { findUnique: f.manga },
  },
}));
vi.mock("@/lib/library", () => ({ getLibrarySnapshot: f.library }));
vi.mock("@/lib/session", () => ({
  getSession: f.session,
  requireSession: f.requireSession,
}));
vi.mock("@/components/AnimeCollectionGrid", () => ({
  AnimeCollectionGrid: () => null,
}));
vi.mock("@/components/MangaCollectionGrid", () => ({
  MangaCollectionGrid: () => null,
}));
vi.mock("@/components/CollectionViewWrapper", () => ({
  CollectionViewWrapper: (props: object) => (
    <pre data-testid="collection">{JSON.stringify(props)}</pre>
  ),
}));
vi.mock("@/components/CollectionAddButton", () => ({
  CollectionAddButton: ({ type }: { type: string }) => (
    <button type="button">Add {type}</button>
  ),
}));
vi.mock("@/components/AnimeCollectionItemForm", () => ({
  AnimeCollectionItemForm: ({ initialData }: { initialData?: object }) => (
    <pre data-testid="form">{JSON.stringify(initialData || {})}</pre>
  ),
}));
vi.mock("@/components/MangaCollectionItemForm", () => ({
  MangaCollectionItemForm: ({ initialData }: { initialData?: object }) => (
    <pre data-testid="form">{JSON.stringify(initialData || {})}</pre>
  ),
}));

import EditAnime from "./collection/anime/[id]/edit/page";
import AddAnime from "./collection/anime/add/page";
import AnimeCollection from "./collection/anime/page";
import EditManga from "./collection/manga/[id]/edit/page";
import AddManga from "./collection/manga/add/page";
import MangaCollection from "./collection/manga/page";

beforeEach(() => {
  f.session.mockReset().mockResolvedValue(null);
  f.requireSession.mockReset().mockResolvedValue({ user: { id: "owner" } });
  f.library.mockReset();
  f.anime.mockReset();
  f.manga.mockReset();
  f.notFound.mockClear();
});

describe("collection page data and authorization joins", () => {
  it.each(["anime", "manga"] as const)(
    "sorts %s items without mutating cached library records",
    async (type) => {
      const recent = { id: "new", createdAt: new Date("2025-03-02") };
      const older = { id: "old", createdAt: new Date("2024-01-01") };
      const items = [recent, older];
      const library = {
        anime: [],
        manga: [],
        [type]: [
          {
            id: 7,
            titleEn: "A title",
            collectionItems: items,
            listEntry: { private: true },
          },
        ],
      };
      f.library.mockResolvedValue(library);
      render(await (type === "anime" ? AnimeCollection() : MangaCollection()));
      const props = JSON.parse(
        screen.getByTestId("collection").textContent || "{}",
      );
      expect(props.items.map((x: { id: string }) => x.id)).toEqual([
        "old",
        "new",
      ]);
      expect(props.items[0][type]).toEqual({ id: 7, titleEn: "A title" });
      expect(items.map((x) => x.id)).toEqual(["new", "old"]);
      expect(props.isAuthenticated).toBe(false);
      expect(
        screen.queryByRole("button", { name: `Add ${type}` }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["anime", "manga"] as const)(
    "enables %s mutations only when a session exists",
    async (type) => {
      f.session.mockResolvedValue({ user: { id: "owner" } });
      f.library.mockResolvedValue({ anime: [], manga: [] });
      render(await (type === "anime" ? AnimeCollection() : MangaCollection()));
      expect(
        screen.getByRole("button", { name: `Add ${type}` }),
      ).toBeInTheDocument();
      expect(
        JSON.parse(screen.getByTestId("collection").textContent || "{}")
          .isAuthenticated,
      ).toBe(true);
    },
  );
  it.each([AddAnime, AddManga])(
    "guards add pages before rendering an editable form",
    async (page) => {
      f.requireSession.mockRejectedValue(new Error("sign-in-required"));
      await expect(page()).rejects.toThrow("sign-in-required");
    },
  );
  it.each([AddAnime, AddManga])(
    "renders an empty form for authenticated creation",
    async (page) => {
      render(await page());
      expect(f.requireSession).toHaveBeenCalledOnce();
      expect(screen.getByTestId("form")).toHaveTextContent("{}");
    },
  );
  it.each(["anime", "manga"] as const)(
    "does not load a %s edit record before authorization",
    async (type) => {
      f.requireSession.mockRejectedValue(new Error("sign-in-required"));
      await expect(
        (type === "anime" ? EditAnime : EditManga)({
          params: Promise.resolve({ id: "item" }),
        }),
      ).rejects.toThrow("sign-in-required");
      expect(f.anime).not.toHaveBeenCalled();
      expect(f.manga).not.toHaveBeenCalled();
    },
  );
  it.each(["anime", "manga"] as const)(
    "returns not-found for a missing %s edit record",
    async (type) => {
      const query = type === "anime" ? f.anime : f.manga;
      query.mockResolvedValue(null);
      await expect(
        (type === "anime" ? EditAnime : EditManga)({
          params: Promise.resolve({ id: "missing" }),
        }),
      ).rejects.toThrow("not-found");
      expect(query).toHaveBeenCalledWith({
        where: { id: "missing" },
        include: { [type]: true },
      });
    },
  );
  it.each([
    ["anime", "English", "Romaji", "Japanese", "English"],
    ["anime", null, "Romaji", "Japanese", "Romaji"],
    ["anime", null, null, "Japanese", "Japanese"],
    ["anime", null, null, null, "Unknown"],
    ["manga", "English", "Romaji", "Japanese", "English"],
    ["manga", null, "Romaji", "Japanese", "Romaji"],
    ["manga", null, null, "Japanese", "Japanese"],
    ["manga", null, null, null, "Unknown"],
  ] as const)(
    "preserves the %s record and fallback title %s/%s/%s",
    async (type, titleEn, titleRomaji, titleJp, expected) => {
      const purchasedAt = new Date("2024-01-01T00:00:00.000Z");
      const media = { kitsuId: "12", titleEn, titleRomaji, titleJp };
      const item =
        type === "anime"
          ? {
              id: "item",
              animeId: "anime-id",
              anime: media,
              rarity: "LIMITED",
              format: "BLU_RAY",
              condition: "GOOD",
              notes: "keep",
              purchasedAt,
              pricePaid: 12.5,
              barcode: "barcode-123",
            }
          : {
              id: "item",
              mangaId: "manga-id",
              manga: media,
              condition: "GOOD",
              language: "JAPANESE",
              notes: "keep",
              containsSerialized: true,
              containsOmnibus: false,
              volumes: [1, 2, 3],
              chapters: [4, 5],
            };
      (type === "anime" ? f.anime : f.manga).mockResolvedValue(item);
      render(
        await (type === "anime" ? EditAnime : EditManga)({
          params: Promise.resolve({ id: "item" }),
        }),
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(
        JSON.parse(screen.getByTestId("form").textContent || "{}"),
      ).toEqual(
        type === "anime"
          ? {
              id: "item",
              animeId: "anime-id",
              kitsuId: "12",
              titleEn,
              rarity: "LIMITED",
              format: "BLU_RAY",
              condition: "GOOD",
              notes: "keep",
              purchasedAt: purchasedAt.toISOString(),
              pricePaid: 12.5,
              barcode: "barcode-123",
            }
          : {
              id: "item",
              mangaId: "manga-id",
              kitsuId: "12",
              titleEn,
              condition: "GOOD",
              language: "JAPANESE",
              notes: "keep",
              containsSerialized: true,
              containsOmnibus: false,
              volumes: [1, 2, 3],
              chapters: [4, 5],
            },
      );
    },
  );
});
