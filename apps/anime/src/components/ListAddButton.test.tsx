import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KitsuSearchResult } from "@/lib/actions/collection/types";
import ListAddButton from "./ListAddButton";

const state = vi.hoisted(() => ({
  animePayload: vi.fn(),
  mangaPayload: vi.fn(),
  resolveAnime: vi.fn(),
  resolveManga: vi.fn(),
  refresh: vi.fn(),
  selected: null as KitsuSearchResult | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}));
vi.mock("@/lib/kitsu/client-queries", () => ({
  getAnimeResolvePayloadBySlug: state.animePayload,
  getMangaResolvePayloadBySlug: state.mangaPayload,
}));
vi.mock("@/lib/actions/collection", () => ({
  resolveAnimeId: state.resolveAnime,
  resolveMangaId: state.resolveManga,
}));
vi.mock("@/components/ItemLookupField", () => ({
  ItemLookupField: ({
    onSelect,
    disabled,
  }: {
    onSelect: (item: KitsuSearchResult | null) => void;
    disabled: boolean;
  }) => (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(state.selected)}
      >
        Choose title
      </button>
      <button type="button" disabled={disabled} onClick={() => onSelect(null)}>
        Clear selection
      </button>
    </>
  ),
}));
vi.mock("@/components/AnimeListEntryEditModal", () => ({
  default: (props: {
    animeId: string;
    title: string;
    episodeCount: number | null;
    onSaved: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Anime editor" data-media-id={props.animeId}>
      <span>{props.title}</span>
      <span>Episodes: {props.episodeCount ?? "unknown"}</span>
      <button type="button" onClick={props.onSaved}>
        Save editor
      </button>
      <button type="button" onClick={props.onClose}>
        Close editor
      </button>
    </div>
  ),
}));
vi.mock("@/components/MangaListEntryEditModal", () => ({
  default: (props: {
    mangaId: string;
    title: string;
    chapterCount: number | null;
    volumeCount: number | null;
    onSaved: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Manga editor" data-media-id={props.mangaId}>
      <span>{props.title}</span>
      <span>
        Chapters: {props.chapterCount ?? "unknown"}; volumes:{" "}
        {props.volumeCount ?? "unknown"}
      </span>
      <button type="button" onClick={props.onSaved}>
        Save editor
      </button>
      <button type="button" onClick={props.onClose}>
        Close editor
      </button>
    </div>
  ),
}));
const selected: KitsuSearchResult = {
  kitsuId: "42",
  rawId: "raw42",
  titleTranslated: "Translated title",
  titleEn: "English title",
  titleRomaji: "Romaji",
  titleJp: "日本語",
  posterUrl: null,
};
beforeEach(() => {
  state.selected = { ...selected };
  for (const value of Object.values(state))
    if (vi.isMockFunction(value)) value.mockReset();
});
afterEach(cleanup);
function open(
  type: "anime" | "manga" = "anime",
  existingKitsuIds: string[] = [],
  iconOnly = false,
) {
  render(
    <ListAddButton
      type={type}
      existingKitsuIds={existingKitsuIds}
      iconOnly={iconOnly}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: `Add ${type} to list` }));
}
function choose() {
  fireEvent.click(screen.getByRole("button", { name: "Choose title" }));
}

describe("add a title to a tracked list", () => {
  it("prevents resolving an existing title and clears the duplicate error when selection is cleared", async () => {
    open("anime", ["42"], true);
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already on your list",
    );
    expect(state.animePayload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it.each(["anime", "manga"] as const)(
    "resolves %s metadata before opening its editor and refreshes after save",
    async (type) => {
      const payload = {
        kitsuId: "42",
        titleEn: "Provider title",
        episodeCount: 12,
        chapterCount: 20,
        volumeCount: 3,
      };
      const getPayload =
        type === "anime" ? state.animePayload : state.mangaPayload;
      const resolve =
        type === "anime" ? state.resolveAnime : state.resolveManga;
      getPayload.mockResolvedValue(payload);
      resolve.mockResolvedValue({ ok: true, data: "database-42" });
      open(type);
      choose();
      const editor = await screen.findByRole("dialog", {
        name: type === "anime" ? "Anime editor" : "Manga editor",
      });
      expect(editor).toHaveAttribute("data-media-id", "database-42");
      expect(editor).toHaveTextContent("Translated title");
      expect(editor).toHaveTextContent(
        type === "anime" ? "Episodes: 12" : "Chapters: 20; volumes: 3",
      );
      expect(getPayload).toHaveBeenCalledExactlyOnceWith("42");
      expect(resolve).toHaveBeenCalledExactlyOnceWith(payload);
      fireEvent.click(screen.getByRole("button", { name: "Save editor" }));
      expect(state.refresh).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
      expect(
        screen.queryByRole("dialog", { name: /editor/ }),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["anime", "manga"] as const)(
    "reports absent %s metadata without making a mutation",
    async (type) => {
      (type === "anime"
        ? state.animePayload
        : state.mangaPayload
      ).mockResolvedValue(null);
      open(type);
      choose();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        `${type === "anime" ? "Anime" : "Manga"} not found on Kitsu.`,
      );
      expect(state.resolveAnime).not.toHaveBeenCalled();
      expect(state.resolveManga).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    },
  );

  it.each(["anime", "manga"] as const)(
    "surfaces an authorization rejection from the %s resolver",
    async (type) => {
      (type === "anime"
        ? state.animePayload
        : state.mangaPayload
      ).mockResolvedValue({ kitsuId: "42" });
      (type === "anime"
        ? state.resolveAnime
        : state.resolveManga
      ).mockResolvedValue({ ok: false, error: "Unauthorized" });
      open(type);
      choose();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unauthorized",
      );
      expect(
        screen.queryByRole("dialog", { name: /editor/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("recovers from provider failure without closing or opening an empty editor", async () => {
    state.animePayload.mockRejectedValue(new Error("Offline"));
    open();
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load the selected title.",
    );
    expect(screen.getByRole("button", { name: "Choose title" })).toBeEnabled();
  });

  it("prevents cancellation and duplicate selection while metadata resolution is pending", async () => {
    let resolve!: (value: null) => void;
    state.animePayload.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    open();
    choose();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose title" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      resolve(null);
    });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it.each(["anime", "manga"] as const)(
    "uses provider title and unknown counts when %s search metadata is sparse",
    async (type) => {
      state.selected = {
        ...selected,
        titleTranslated: null,
        titleEn: null,
        titleRomaji: null,
        titleJp: null,
      };
      (type === "anime"
        ? state.animePayload
        : state.mangaPayload
      ).mockResolvedValue({ kitsuId: "42", titleRomaji: "Provider fallback" });
      (type === "anime"
        ? state.resolveAnime
        : state.resolveManga
      ).mockResolvedValue({ ok: true, data: "42" });
      open(type);
      choose();
      const editor = await screen.findByRole("dialog", {
        name: type === "anime" ? "Anime editor" : "Manga editor",
      });
      expect(editor).toHaveTextContent("Provider fallback");
      expect(editor).toHaveTextContent("unknown");
    },
  );
});

it.each(["anime", "manga"] as const)(
  "retains localized %s search titles when detailed metadata omits them",
  async (type) => {
    state.selected = {
      ...selected,
      titleTranslated: null,
      titleEn: null,
      titleRomaji: "Search romaji",
      titleJp: null,
    };
    const getPayload =
      type === "anime" ? state.animePayload : state.mangaPayload;
    const resolve = type === "anime" ? state.resolveAnime : state.resolveManga;
    getPayload.mockResolvedValue({ kitsuId: "42" });
    resolve.mockResolvedValue({ ok: true, data: "database-42" });
    open(type);
    choose();
    expect(
      await screen.findByRole("dialog", {
        name: type === "anime" ? "Anime editor" : "Manga editor",
      }),
    ).toHaveTextContent("Search romaji");
  },
);

it.each([
  [
    "provider English",
    { titleEn: "provider English" },
    { titleEn: "Search English" },
  ],
  [
    "provider Japanese",
    { titleJp: "provider Japanese" },
    { titleEn: "Search English" },
  ],
  ["Search English", {}, { titleEn: "Search English" }],
  ["Search Japanese", {}, { titleJp: "Search Japanese" }],
  ["Unknown", {}, {}],
] as const)(
  "uses the best available title (%s) when resolving sparse provider records",
  async (expected, payloadTitles, searchTitles) => {
    for (const type of ["anime", "manga"] as const) {
      state.selected = {
        ...selected,
        titleTranslated: null,
        titleEn: null,
        titleRomaji: null,
        titleJp: null,
        ...searchTitles,
      };
      (type === "anime"
        ? state.animePayload
        : state.mangaPayload
      ).mockResolvedValue({ kitsuId: "42", ...payloadTitles });
      (type === "anime"
        ? state.resolveAnime
        : state.resolveManga
      ).mockResolvedValue({ ok: true, data: "42" });
      open(type);
      choose();
      expect(
        await screen.findByRole("dialog", {
          name: type === "anime" ? "Anime editor" : "Manga editor",
        }),
      ).toHaveTextContent(expected);
      cleanup();
    }
  },
);
