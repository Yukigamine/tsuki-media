import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimeCollectionItemForm } from "./AnimeCollectionItemForm";
import { MangaCollectionItemForm } from "./MangaCollectionItemForm";

const f = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  addAnime: vi.fn(),
  editAnime: vi.fn(),
  resolveAnime: vi.fn(),
  deleteAnime: vi.fn(),
  addManga: vi.fn(),
  editManga: vi.fn(),
  resolveManga: vi.fn(),
  deleteManga: vi.fn(),
  searchAnime: vi.fn(),
  searchManga: vi.fn(),
  animePayload: vi.fn(),
  mangaPayload: vi.fn(),
  animeDetail: vi.fn(),
  mangaDetail: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: f.push, back: f.back }),
}));
vi.mock("@/lib/actions/collection", () => ({
  addAnimeCollectionItem: f.addAnime,
  editAnimeCollectionItem: f.editAnime,
  resolveAnimeId: f.resolveAnime,
  deleteAnimeCollectionItem: f.deleteAnime,
  addMangaCollectionItem: f.addManga,
  editMangaCollectionItem: f.editManga,
  resolveMangaId: f.resolveManga,
  deleteMangaCollectionItem: f.deleteManga,
}));
vi.mock("@/lib/kitsu/client-queries", () => ({
  searchAnimeByTitleClient: f.searchAnime,
  searchMangaByTitleClient: f.searchManga,
  getAnimeResolvePayloadBySlug: f.animePayload,
  getMangaResolvePayloadBySlug: f.mangaPayload,
  getAnimeSeriesDetailBySlug: f.animeDetail,
  getMangaSeriesDetailBySlug: f.mangaDetail,
}));
const chosen = {
  kitsuId: "chosen-series",
  rawId: "42",
  titleTranslated: "Chosen Series",
  titleEn: "Chosen Series",
  titleRomaji: null,
  titleJp: null,
  posterUrl: null,
};
const animeInitial: NonNullable<
  ComponentProps<typeof AnimeCollectionItemForm>["initialData"]
> = {
  id: "owned-anime",
  animeId: "anime-db",
  kitsuId: "old-series",
  titleEn: "Original Anime",
  rarity: "COLLECTORS",
  format: "DVD",
  condition: "FAIR",
  notes: "Original notes",
  purchasedAt: new Date("2026-01-02T00:00:00.000Z"),
  pricePaid: 12.5,
  barcode: "12345",
};
const mangaInitial: NonNullable<
  ComponentProps<typeof MangaCollectionItemForm>["initialData"]
> = {
  id: "owned-manga",
  mangaId: "manga-db",
  kitsuId: "old-series",
  titleEn: "Original Manga",
  condition: "FAIR",
  language: "JAPANESE",
  notes: "Original notes",
  containsSerialized: true,
  containsOmnibus: true,
  volumes: [1, 5],
  chapters: [1, 7],
};
const animeDetail = {
  kitsuId: "old-series",
  titleEn: "Original Anime",
  titleRomaji: null,
  episodeCount: 1,
  posterUrl: null,
  updatedAt: "2026-01-01",
};
const mangaDetail = {
  kitsuId: "old-series",
  titleEn: "Original Manga",
  titleRomaji: null,
  totalVolumes: 2,
  totalChapters: 3,
  totalsFromKitsu: true,
  posterUrl: null,
  updatedAt: "2026-01-01",
};

beforeEach(() => {
  for (const mock of Object.values(f)) mock.mockReset();
  f.searchAnime.mockResolvedValue([chosen]);
  f.searchManga.mockResolvedValue([chosen]);
  f.animePayload.mockResolvedValue({ kitsuId: chosen.kitsuId });
  f.mangaPayload.mockResolvedValue({ kitsuId: chosen.kitsuId });
  f.resolveAnime.mockResolvedValue({ ok: true, data: "anime-db" });
  f.resolveManga.mockResolvedValue({ ok: true, data: "manga-db" });
  f.addAnime.mockResolvedValue({ ok: true, data: { id: "new-anime" } });
  f.addManga.mockResolvedValue({ ok: true, data: { id: "new-manga" } });
  f.editAnime.mockResolvedValue({ ok: true });
  f.editManga.mockResolvedValue({ ok: true });
  f.animeDetail.mockResolvedValue(null);
  f.mangaDetail.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function requiredElement<T extends Element>(element: T | null): T {
  if (!element) throw new Error("Expected rendered form structure");
  return element;
}
async function chooseTitle(type: "anime" | "manga") {
  const input = screen.getByRole("combobox", { name: `Search ${type}` });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Chosen" } });
  fireEvent.click(await screen.findByRole("option", { name: /Chosen Series/ }));
}
function chooseOption(current: string, next: string) {
  fireEvent.mouseDown(
    screen.getByText(current, { selector: '[role="combobox"]' }),
  );
  fireEvent.click(screen.getByRole("option", { name: next }));
}

describe("anime collection form", () => {
  it("requires a selected series before creation and cancels without saving", () => {
    render(<AnimeCollectionItemForm />);
    expect(
      screen.getByRole("button", { name: "Add to collection" }),
    ).toBeDisabled();
    fireEvent.submit(
      requiredElement(
        screen
          .getByRole("button", { name: "Add to collection" })
          .closest("form"),
      ),
    );
    expect(f.addAnime).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(f.back).toHaveBeenCalledOnce();
  });

  it("resolves a selected series and preserves edited purchase/edition fields", async () => {
    render(<AnimeCollectionItemForm />);
    await chooseTitle("anime");
    chooseOption("Standard", "Deluxe");
    chooseOption("Blu-ray", "Digital");
    chooseOption("Good", "Mint");
    fireEvent.change(screen.getByLabelText("Purchased date"), {
      target: { value: "2026-02-03" },
    });
    fireEvent.change(screen.getByLabelText("Price paid"), {
      target: { value: "19.95" },
    });
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "8675309" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Shelf A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await waitFor(() =>
      expect(f.push).toHaveBeenCalledWith("/collection/anime"),
    );
    expect(f.animePayload).toHaveBeenCalledWith(chosen.kitsuId);
    expect(f.resolveAnime).toHaveBeenCalledWith({ kitsuId: chosen.kitsuId });
    expect(f.addAnime).toHaveBeenCalledWith({
      animeId: "anime-db",
      rarity: "DELUXE",
      format: "DIGITAL",
      condition: "MINT",
      notes: "Shelf A",
      purchasedAt: "2026-02-03",
      pricePaid: 19.95,
      barcode: "8675309",
    });
  });

  it("edits the existing database identity and clears optional fields without resolving again", async () => {
    f.animeDetail.mockResolvedValue(animeDetail);
    render(<AnimeCollectionItemForm initialData={animeInitial} />);
    expect(
      screen.getByRole("combobox", { name: "Search anime" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Purchased date")).toHaveValue("2026-01-02");
    expect(screen.getByLabelText("Price paid")).toHaveValue(12.5);
    expect(await screen.findByText("1 episode (Kitsu)")).toBeInTheDocument();
    for (const label of ["Notes", "Purchased date", "Price paid", "Barcode"])
      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(f.editAnime).toHaveBeenCalledWith("owned-anime", {
        animeId: "anime-db",
        rarity: "COLLECTORS",
        format: "DVD",
        condition: "FAIR",
        notes: undefined,
        purchasedAt: undefined,
        pricePaid: undefined,
        barcode: undefined,
      }),
    );
    expect(f.resolveAnime).not.toHaveBeenCalled();
  });

  it("allows editing an item whose external metadata is missing", async () => {
    render(
      <AnimeCollectionItemForm
        initialData={{
          ...animeInitial,
          kitsuId: null,
          titleEn: null,
          purchasedAt: null,
          pricePaid: 0,
          notes: null,
          barcode: null,
        }}
        seriesDetail={{ ...animeDetail, episodeCount: 12 }}
      />,
    );
    expect(screen.getByText("12 episodes (Kitsu)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete this item" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Price paid")).toHaveValue(0);
    expect(f.animeDetail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(f.editAnime).toHaveBeenCalledWith(
        "owned-anime",
        expect.objectContaining({ pricePaid: 0 }),
      ),
    );
  });

  it.each(["missing", "resolve", "save", "throw"] as const)(
    "retains the selection and enables retry after a %s failure",
    async (failure) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      if (failure === "missing") f.animePayload.mockResolvedValue(null);
      if (failure === "resolve")
        f.resolveAnime.mockResolvedValue({
          ok: false,
          error: "Resolution refused",
        });
      if (failure === "save")
        f.addAnime.mockResolvedValue({ ok: false, error: "Save refused" });
      if (failure === "throw")
        f.addAnime.mockRejectedValue(new Error("offline"));
      render(<AnimeCollectionItemForm />);
      await chooseTitle("anime");
      fireEvent.click(
        screen.getByRole("button", { name: "Add to collection" }),
      );
      const error =
        failure === "missing"
          ? "Anime not found on Kitsu."
          : failure === "resolve"
            ? "Resolution refused"
            : failure === "save"
              ? "Save refused"
              : "An unexpected error occurred";
      expect(await screen.findByRole("alert")).toHaveTextContent(error);
      expect(
        screen.getByRole("button", { name: "Add to collection" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("combobox", { name: "Search anime" }),
      ).toHaveValue("Chosen Series");
      expect(f.push).not.toHaveBeenCalled();
    },
  );

  it("ignores an outdated external-detail response after the edited identity changes", async () => {
    let finish!: (value: typeof animeDetail) => void;
    f.animeDetail
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce({ ...animeDetail, episodeCount: 2 });
    const { rerender } = render(
      <AnimeCollectionItemForm initialData={animeInitial} />,
    );
    rerender(
      <AnimeCollectionItemForm
        initialData={{ ...animeInitial, kitsuId: "replacement" }}
      />,
    );
    expect(await screen.findByText("2 episodes (Kitsu)")).toBeInTheDocument();
    await act(async () => finish({ ...animeDetail, episodeCount: 99 }));
    expect(screen.queryByText("99 episodes (Kitsu)")).not.toBeInTheDocument();
  });
});

describe("manga collection form", () => {
  it("requires a selected series and keeps cancel independent of server writes", () => {
    render(<MangaCollectionItemForm />);
    expect(
      screen.getByRole("button", { name: "Add to collection" }),
    ).toBeDisabled();
    fireEvent.submit(
      requiredElement(
        screen
          .getByRole("button", { name: "Add to collection" })
          .closest("form"),
      ),
    );
    expect(f.addManga).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(f.back).toHaveBeenCalledOnce();
  });

  it("creates an edition with custom totals, sorted selections and serialized chapters", async () => {
    render(<MangaCollectionItemForm />);
    await chooseTitle("manga");
    chooseOption("Good", "Near Mint");
    chooseOption("English", "Japanese");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Contains serialized issues" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Omnibus edition" }));
    fireEvent.change(screen.getByLabelText("Total volumes (optional)"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Total chapters (optional)"), {
      target: { value: "2" },
    });
    const volumes = within(
      requiredElement(screen.getByText("Volumes owned").parentElement),
    );
    fireEvent.click(volumes.getByRole("button", { name: "All" }));
    fireEvent.click(volumes.getByRole("button", { name: "All" }));
    fireEvent.click(volumes.getByRole("button", { name: "2" }));
    fireEvent.click(volumes.getByRole("button", { name: "1" }));
    fireEvent.click(volumes.getByRole("button", { name: "3" }));
    fireEvent.click(volumes.getByRole("button", { name: "3" }));
    fireEvent.click(
      within(
        requiredElement(screen.getByText("Chapters owned").parentElement),
      ).getByRole("button", { name: "All" }),
    );
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Omnibus shelf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
    await waitFor(() =>
      expect(f.push).toHaveBeenCalledWith("/collection/manga"),
    );
    expect(f.addManga).toHaveBeenCalledWith({
      mangaId: "manga-db",
      condition: "NEAR_MINT",
      language: "JAPANESE",
      notes: "Omnibus shelf",
      containsSerialized: true,
      containsOmnibus: true,
      volumes: [1, 2],
      chapters: [1, 2],
    });
  });

  it("locks Kitsu totals and sends legacy out-of-range values with bounds for server pruning", async () => {
    f.mangaDetail.mockResolvedValue(mangaDetail);
    render(
      <MangaCollectionItemForm
        initialData={mangaInitial}
        seriesDetail={mangaDetail}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Search manga" }),
    ).toBeDisabled();
    expect(
      screen.queryByLabelText("Total volumes (optional)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Total chapters (optional)"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByTitle("Out of current range — will be removed on save")
        .map((chip) => chip.textContent),
    ).toEqual(["5*", "7*"]);
    expect(screen.getByText("7*")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(f.editManga).toHaveBeenCalledWith(
        "owned-manga",
        {
          mangaId: "manga-db",
          condition: "FAIR",
          language: "JAPANESE",
          notes: "Original notes",
          containsSerialized: true,
          containsOmnibus: true,
          volumes: [1, 5],
          chapters: [1, 7],
        },
        2,
        3,
      ),
    );
    expect(f.resolveManga).not.toHaveBeenCalled();
  });

  it("supports edits with no external identity or known totals", async () => {
    render(
      <MangaCollectionItemForm
        initialData={{
          ...mangaInitial,
          kitsuId: null,
          titleEn: null,
          notes: null,
          volumes: [],
          chapters: [],
          containsSerialized: false,
        }}
      />,
    );
    expect(f.mangaDetail).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Delete this item" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(f.editManga).toHaveBeenCalledWith(
        "owned-manga",
        expect.objectContaining({
          notes: undefined,
          volumes: [],
          chapters: [],
        }),
        null,
        null,
      ),
    );
  });

  it("keeps an unknown chapter total editable when Kitsu only supplies volumes", async () => {
    const partialDetail = { ...mangaDetail, totalChapters: null };
    f.mangaDetail.mockResolvedValue(partialDetail);
    render(
      <MangaCollectionItemForm
        initialData={mangaInitial}
        seriesDetail={partialDetail}
      />,
    );
    expect(
      screen.queryByLabelText("Total volumes (optional)"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total chapters (optional)")).toHaveValue(
      null,
    );
    fireEvent.change(screen.getByLabelText("Total chapters (optional)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(f.editManga).toHaveBeenCalledWith(
        "owned-manga",
        expect.objectContaining({ chapters: [1, 7] }),
        2,
        10,
      ),
    );
  });

  it("populates locked grids when selecting a title with known Kitsu totals", async () => {
    f.mangaDetail.mockResolvedValue(mangaDetail);
    render(<MangaCollectionItemForm />);
    await chooseTitle("manga");
    expect(await screen.findByText("(2 from Kitsu)")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Total volumes (optional)"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Contains serialized issues" }),
    );
    expect(screen.getByText("(3 from Kitsu)")).toBeInTheDocument();
  });

  it.each(["missing", "resolve", "save", "throw"] as const)(
    "keeps a retryable form after a %s failure",
    async (failure) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      if (failure === "missing") f.mangaPayload.mockResolvedValue(null);
      if (failure === "resolve")
        f.resolveManga.mockResolvedValue({
          ok: false,
          error: "Resolution refused",
        });
      if (failure === "save")
        f.addManga.mockResolvedValue({ ok: false, error: "Save refused" });
      if (failure === "throw")
        f.addManga.mockRejectedValue(new Error("offline"));
      render(<MangaCollectionItemForm />);
      await chooseTitle("manga");
      fireEvent.click(
        screen.getByRole("button", { name: "Add to collection" }),
      );
      const error =
        failure === "missing"
          ? "Manga not found on Kitsu."
          : failure === "resolve"
            ? "Resolution refused"
            : failure === "save"
              ? "Save refused"
              : "An unexpected error occurred";
      expect(await screen.findByRole("alert")).toHaveTextContent(error);
      expect(
        screen.getByRole("button", { name: "Add to collection" }),
      ).toBeEnabled();
      expect(f.push).not.toHaveBeenCalled();
    },
  );

  it("does not replace newer Kitsu totals with an outdated response", async () => {
    let finish!: (value: typeof mangaDetail) => void;
    f.mangaDetail
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...mangaDetail,
        totalVolumes: 4,
        totalChapters: 6,
      });
    const { rerender } = render(
      <MangaCollectionItemForm initialData={mangaInitial} />,
    );
    rerender(
      <MangaCollectionItemForm
        initialData={{ ...mangaInitial, kitsuId: "replacement" }}
      />,
    );
    expect(await screen.findByText("(4 from Kitsu)")).toBeInTheDocument();
    await act(async () => finish(mangaDetail));
    expect(screen.queryByText("(2 from Kitsu)")).not.toBeInTheDocument();
  });
});
