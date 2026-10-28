import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnimeWithEntry, MangaWithEntry } from "@/lib/list";
import AnimeListClient from "./AnimeListClient";
import MangaListClient from "./MangaListClient";

const f = vi.hoisted(() => ({
  upsertAnime: vi.fn(),
  upsertManga: vi.fn(),
  removeAnime: vi.fn(),
  removeManga: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: f.refresh }),
}));
vi.mock("@/lib/actions/list", () => ({
  upsertAnimeListEntry: f.upsertAnime,
  upsertMangaListEntry: f.upsertManga,
  removeAnimeListEntry: f.removeAnime,
  removeMangaListEntry: f.removeManga,
}));
vi.mock("@/lib/actions/collection", () => ({
  resolveAnimeId: vi.fn(),
  resolveMangaId: vi.fn(),
}));

function item(
  id: string,
  title: string | null,
  status: string,
  manga: boolean,
) {
  return {
    id,
    kitsuId: `k-${id}`,
    titleEn: title,
    titleRomaji: title ? null : "Romaji",
    titleJp: "日本語" as string | null,
    coverImageUrl: null,
    episodeCount: 12,
    chapterCount: 20,
    volumeCount: 3,
    listEntry: {
      id: `e-${id}`,
      animeId: id,
      mangaId: id,
      watchStatus: status,
      readStatus: status,
      progress: 2,
      progressVolumes: manga ? 1 : 0,
      rating: null,
      notes: null,
      rewatchCount: 0,
      rewatching: false,
      rereadCount: 0,
      rereading: false,
      private: false,
      kitsuEntryId: null,
      anilistEntryId: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: null,
    },
  };
}
beforeEach(() => {
  for (const mock of Object.values(f)) mock.mockReset();
  for (const mock of [
    f.upsertAnime,
    f.upsertManga,
    f.removeAnime,
    f.removeManga,
  ])
    mock.mockResolvedValue({ ok: true });
});
for (const manga of [false, true]) {
  describe(manga ? "manga list client" : "anime list client", () => {
    const active = manga ? "READING" : "WATCHING";
    const makeItems = () => [
      item("one", "Alpha", active, manga),
      item("two", "Beta", "COMPLETED", manga),
      item("three", null, active, manga),
    ];
    function view(items = makeItems(), authenticated = true) {
      return (
        <SnackbarProvider>
          {manga ? (
            <MangaListClient
              items={items as unknown as MangaWithEntry[]}
              counts={{ ALL: items.length, [active]: 2, COMPLETED: 1 }}
              existingKitsuIds={["k-one"]}
              isAuthenticated={authenticated}
            />
          ) : (
            <AnimeListClient
              items={items as unknown as AnimeWithEntry[]}
              counts={{ ALL: items.length, [active]: 2, COMPLETED: 1 }}
              existingKitsuIds={["k-one"]}
              isAuthenticated={authenticated}
            />
          )}
        </SnackbarProvider>
      );
    }
    it("combines status filters and debounced multilingual search while retaining total counts", async () => {
      vi.useFakeTimers();
      render(view());
      fireEvent.click(
        screen.getByRole("tab", { name: manga ? "Reading 2" : "Watching 2" }),
      );
      expect(
        screen.queryByRole("link", { name: "View Beta" }),
      ).not.toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText("Search..."), {
        target: { value: "  ROMAJI " },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(screen.getByRole("link", { name: "View Romaji" })).toHaveAttribute(
        "href",
        `/${manga ? "manga" : "anime"}/romaji/k-three`,
      );
      expect(
        screen.queryByRole("link", { name: "View Alpha" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "All 3" })).toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText("Search..."), {
        target: { value: "not present" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(screen.getByText("No entries found")).toBeInTheDocument();
      expect(
        screen.getByText("Try a different search term"),
      ).toBeInTheDocument();
    });
    it("renders a readonly table with provider detail links and correct tracking units", () => {
      render(view(makeItems(), false));
      fireEvent.click(screen.getByRole("button", { name: "table view" }));
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute(
        "href",
        `/${manga ? "manga" : "anime"}/alpha/k-one`,
      );
      expect(screen.getAllByText(manga ? "2 ch / 20" : "2 / 12")).toHaveLength(
        3,
      );
      expect(
        screen.queryByRole("button", { name: /Edit Alpha/ }),
      ).not.toBeInTheDocument();
    });
    it("opens and cancels real entry editing from grid and table without calling mutations", () => {
      render(view());
      fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "table view" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit Beta" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(f.upsertAnime).not.toHaveBeenCalled();
      expect(f.upsertManga).not.toHaveBeenCalled();
      expect(f.refresh).not.toHaveBeenCalled();
    });
    it("keeps a failed save open with the error and leaves tracking untouched", async () => {
      (manga ? f.upsertManga : f.upsertAnime).mockResolvedValue({
        ok: false,
        error: "Storage unavailable",
      });
      render(view());
      fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
      fireEvent.change(
        screen.getByLabelText(
          manga ? "Chapter Progress (max 20)" : "Progress (max 12)",
        ),
        { target: { value: "7" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(screen.getByRole("dialog")).toHaveTextContent(
          "Storage unavailable",
        ),
      );
      expect(
        screen.getAllByText(manga ? "2 / 20 ch" : "2 / 12 ep"),
      ).toHaveLength(3);
      expect(f.refresh).not.toHaveBeenCalled();
    });
    it("retains the entry and edit dialog when a confirmed removal fails", async () => {
      (manga ? f.removeManga : f.removeAnime).mockResolvedValue({
        ok: false,
        error: "Removal unavailable",
      });
      render(view());
      fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove from list" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove from list" }));
      await waitFor(() =>
        expect(screen.getByRole("dialog")).toHaveTextContent(
          "Removal unavailable",
        ),
      );
      expect(
        screen.getByRole("link", { name: "View Alpha", hidden: true }),
      ).toBeInTheDocument();
      expect(f.refresh).not.toHaveBeenCalled();
    });
    it("searches Japanese titles within the completed filter and clears back to that filter", async () => {
      vi.useFakeTimers();
      render(view());
      fireEvent.click(screen.getByRole("tab", { name: "Completed 1" }));
      fireEvent.change(screen.getByPlaceholderText("Search..."), {
        target: { value: "日本語" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(
        screen.getByRole("link", { name: "View Beta" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "View Alpha" }),
      ).not.toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText("Search..."), {
        target: { value: "" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(
        screen.getByRole("link", { name: "View Beta" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Completed 1" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    it("hides grid mutations for anonymous users and provides Japanese or unknown title fallbacks", () => {
      const japanese = {
        ...item("jp", null, active, manga),
        titleRomaji: null,
      };
      const untitled = {
        ...item("unknown", null, active, manga),
        titleRomaji: null,
        titleJp: null,
      };
      render(view([japanese, untitled], false));
      expect(screen.getByRole("link", { name: "View 日本語" })).toHaveAttribute(
        "href",
        `/${manga ? "manga" : "anime"}/untitled/k-jp`,
      );
      expect(
        screen.getByRole("link", { name: "View Unknown" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Edit/ }),
      ).not.toBeInTheDocument();
    });
    it("shows the empty library state without a misleading search hint", () => {
      render(view([]));
      expect(screen.getByText("No entries found")).toBeInTheDocument();
      expect(
        screen.queryByText("Try a different search term"),
      ).not.toBeInTheDocument();
    });
  });
}
