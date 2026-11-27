import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnimeListEntryEditModal from "./AnimeListEntryEditModal";
import MangaListEntryEditModal from "./MangaListEntryEditModal";

const f = vi.hoisted(() => ({
  upsertAnime: vi.fn(),
  removeAnime: vi.fn(),
  upsertManga: vi.fn(),
  removeManga: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: f.refresh }),
}));
vi.mock("@/lib/actions/list", () => ({
  upsertAnimeListEntry: f.upsertAnime,
  removeAnimeListEntry: f.removeAnime,
  upsertMangaListEntry: f.upsertManga,
  removeMangaListEntry: f.removeManga,
}));
type AnimeProps = ComponentProps<typeof AnimeListEntryEditModal>;
type MangaProps = ComponentProps<typeof MangaListEntryEditModal>;
const dates = {
  createdAt: new Date("2026-01-01"),
  updatedAt: null,
  startedAt: null,
  completedAt: null,
  private: false,
  kitsuEntryId: null,
  anilistEntryId: null,
};
const animeEntry: NonNullable<AnimeProps["entry"]> = {
  id: "watch-entry",
  animeId: "anime-db",
  watchStatus: "WATCHING",
  progress: 3,
  rating: 17,
  notes: "Original note",
  rewatchCount: 2,
  rewatching: true,
  ...dates,
};
const mangaEntry: NonNullable<MangaProps["entry"]> = {
  id: "read-entry",
  mangaId: "manga-db",
  readStatus: "READING",
  progress: 8,
  progressVolumes: 2,
  rating: 15,
  notes: "Original note",
  rereadCount: 1,
  rereading: true,
  ...dates,
};
function anime(overrides: Partial<AnimeProps> = {}) {
  return (
    <SnackbarProvider>
      <AnimeListEntryEditModal
        open
        onClose={vi.fn()}
        animeId="anime-db"
        title="Anime Title"
        episodeCount={12}
        entry={animeEntry}
        {...overrides}
      />
    </SnackbarProvider>
  );
}
function manga(overrides: Partial<MangaProps> = {}) {
  return (
    <SnackbarProvider>
      <MangaListEntryEditModal
        open
        onClose={vi.fn()}
        mangaId="manga-db"
        title="Manga Title"
        chapterCount={30}
        volumeCount={5}
        entry={mangaEntry}
        {...overrides}
      />
    </SnackbarProvider>
  );
}
function option(current: string, next: string) {
  fireEvent.mouseDown(
    screen.getByText(current, { selector: '[role="combobox"]' }),
  );
  fireEvent.click(screen.getByRole("option", { name: next }));
}

beforeEach(() => {
  for (const mock of Object.values(f)) mock.mockReset();
  f.upsertAnime.mockResolvedValue({ ok: true });
  f.upsertManga.mockResolvedValue({ ok: true });
  f.removeAnime.mockResolvedValue({ ok: true });
  f.removeManga.mockResolvedValue({ ok: true });
});
afterEach(() => cleanup());

describe("anime list entry editing", () => {
  it("shows existing half-point ratings and saves edited tracking fields with trimmed notes", async () => {
    const onSaved = vi.fn(),
      onClose = vi.fn();
    render(anime({ onSaved, onClose }));
    expect(screen.getByText("Rating: 8.5/10")).toBeInTheDocument();
    expect(screen.getByLabelText("Progress (max 12)")).toHaveAttribute(
      "max",
      "12",
    );
    option("Watching", "Completed");
    fireEvent.change(screen.getByLabelText("Progress (max 12)"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Rating" }), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "  Updated note  " },
    });
    fireEvent.change(screen.getByLabelText("Rewatch Count"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Rewatching" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const patch = {
      watchStatus: "COMPLETED",
      progress: 12,
      rating: 18,
      notes: "Updated note",
      rewatchCount: 3,
      rewatching: false,
    };
    expect(f.upsertAnime).toHaveBeenCalledWith({
      animeId: "anime-db",
      ...patch,
    });
    expect(onSaved).toHaveBeenCalledWith(patch);
    expect(f.refresh).toHaveBeenCalledOnce();
  });

  it("creates an unrated entry with empty values normalized to zero/null", async () => {
    render(anime({ entry: null, episodeCount: null }));
    expect(screen.getByText("Plan to Watch")).toBeInTheDocument();
    expect(screen.getByText("Rating: Not rated")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove from list" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Progress"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Rewatch Count"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(f.upsertAnime).toHaveBeenCalledWith({
        animeId: "anime-db",
        watchStatus: "PLAN_TO_WATCH",
        progress: 0,
        rating: null,
        notes: null,
        rewatchCount: 0,
        rewatching: false,
      }),
    );
  });

  it("preserves an open draft, then resets to the latest entry when closed and reopened", () => {
    const { rerender } = render(anime());
    fireEvent.change(screen.getByLabelText("Progress (max 12)"), {
      target: { value: "7" },
    });
    rerender(anime({ entry: { ...animeEntry, progress: 2 } }));
    expect(screen.getByLabelText("Progress (max 12)")).toHaveValue(7);
    rerender(anime({ open: false, entry: null }));
    rerender(anime({ entry: null }));
    expect(screen.getByLabelText("Progress (max 12)")).toHaveValue(0);
    expect(screen.getByLabelText("Notes")).toHaveValue("");
    expect(screen.getByText("Plan to Watch")).toBeInTheDocument();
  });

  it("keeps the draft open on save rejection and allows a retry", async () => {
    f.upsertAnime.mockResolvedValueOnce({
      ok: false,
      error: "Progress exceeds known episodes",
    });
    const onClose = vi.fn(),
      onSaved = vi.fn();
    render(anime({ onClose, onSaved }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      (await screen.findAllByText("Progress exceeds known episodes")).length,
    ).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("disables edits and cancellation until an outstanding save completes", async () => {
    let finish!: (value: { ok: true }) => void;
    f.upsertAnime.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = vi.fn();
    render(anime({ onClose }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Notes")).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("manga list entry editing", () => {
  it("saves chapter/volume progress, rating and reread settings", async () => {
    const onSaved = vi.fn(),
      onClose = vi.fn();
    render(manga({ onSaved, onClose }));
    expect(screen.getByText("Rating: 7.5/10")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume Progress (max 5)")).toHaveAttribute(
      "max",
      "5",
    );
    option("Reading", "Completed");
    option("Yes", "No");
    fireEvent.change(screen.getByLabelText("Chapter Progress (max 30)"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Volume Progress (max 5)"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Rating" }), {
      target: { value: "8.5" },
    });
    fireEvent.change(screen.getByLabelText("Reread Count"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "  Finished  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const patch = {
      readStatus: "COMPLETED",
      progress: 30,
      progressVolumes: 5,
      rating: 17,
      notes: "Finished",
      rereadCount: 2,
      rereading: false,
    };
    expect(f.upsertManga).toHaveBeenCalledWith({
      mangaId: "manga-db",
      ...patch,
    });
    expect(onSaved).toHaveBeenCalledWith(patch);
    expect(f.refresh).toHaveBeenCalledOnce();
  });

  it("creates an unrated entry when no chapter/volume totals are known", async () => {
    render(manga({ entry: null, chapterCount: null, volumeCount: null }));
    option("No", "Yes");
    fireEvent.change(screen.getByLabelText("Chapter Progress"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Volume Progress"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Reread Count"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(f.upsertManga).toHaveBeenCalledWith({
        mangaId: "manga-db",
        readStatus: "PLAN_TO_READ",
        progress: 0,
        progressVolumes: 0,
        rating: null,
        notes: null,
        rereadCount: 0,
        rereading: true,
      }),
    );
  });

  it("does not overwrite unsaved changes until the modal is closed", () => {
    const { rerender } = render(manga());
    fireEvent.change(screen.getByLabelText("Chapter Progress (max 30)"), {
      target: { value: "20" },
    });
    rerender(manga({ entry: { ...mangaEntry, progress: 1 } }));
    expect(screen.getByLabelText("Chapter Progress (max 30)")).toHaveValue(20);
    rerender(manga({ open: false, entry: null }));
    rerender(manga({ entry: null }));
    expect(screen.getByLabelText("Chapter Progress (max 30)")).toHaveValue(0);
    expect(screen.getByLabelText("Volume Progress (max 5)")).toHaveValue(0);
    expect(screen.getByText("Want to Read")).toBeInTheDocument();
  });

  it("surfaces save rejection without closing or applying an optimistic patch", async () => {
    f.upsertManga.mockResolvedValue({
      ok: false,
      error: "Chapter limit exceeded",
    });
    const onClose = vi.fn(),
      onSaved = vi.fn();
    render(manga({ onClose, onSaved }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      (await screen.findAllByText("Chapter limit exceeded")).length,
    ).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
  });
});

it.each(["anime", "manga"] as const)(
  "requires confirmed %s removal, preserves the modal on failure, and reports successful removal",
  async (kind) => {
    const remove = kind === "anime" ? f.removeAnime : f.removeManga;
    remove.mockResolvedValueOnce({ ok: false, error: "Removal refused" });
    const onClose = vi.fn(),
      onRemoved = vi.fn();
    render(
      kind === "anime"
        ? anime({ onClose, onRemoved })
        : manga({ onClose, onRemoved }),
    );
    const button = screen.getByRole("button", { name: "Remove from list" });
    fireEvent.click(button);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(
      (await screen.findAllByText("Removal refused")).length,
    ).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(remove).toHaveBeenLastCalledWith(`${kind}-db`);
    expect(onClose).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledOnce();
  },
);

it.each(["anime", "manga"] as const)(
  "cancels %s editing without mutating the list",
  (kind) => {
    const onClose = vi.fn();
    render(kind === "anime" ? anime({ onClose }) : manga({ onClose }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(f.upsertAnime).not.toHaveBeenCalled();
    expect(f.upsertManga).not.toHaveBeenCalled();
    expect(f.removeAnime).not.toHaveBeenCalled();
    expect(f.removeManga).not.toHaveBeenCalled();
  },
);
