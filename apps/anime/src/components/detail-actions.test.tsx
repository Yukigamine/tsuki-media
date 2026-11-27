import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnimeListEntry, MangaListEntry } from "@/generated/prisma/client";
import AnimeDetailActions from "./AnimeDetailActions";
import MangaDetailActions from "./MangaDetailActions";

const action = vi.hoisted(() => ({
  animeStatus: vi.fn(),
  mangaStatus: vi.fn(),
  animeResolve: vi.fn(),
  mangaResolve: vi.fn(),
  animeRewatch: vi.fn(),
  mangaReread: vi.fn(),
  animeProgress: vi.fn(),
  mangaProgress: vi.fn(),
  animePayload: vi.fn(),
  mangaPayload: vi.fn(),
  snack: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: action.refresh }),
}));
vi.mock("notistack", () => ({ enqueueSnackbar: action.snack }));
vi.mock("@/lib/actions/list", () => ({
  applyAnimeQuickStatus: action.animeStatus,
  applyMangaQuickStatus: action.mangaStatus,
  resolveAndApplyAnimeQuickStatus: action.animeResolve,
  resolveAndApplyMangaQuickStatus: action.mangaResolve,
  startAnimeRewatch: action.animeRewatch,
  startMangaReread: action.mangaReread,
  upsertAnimeListEntry: action.animeProgress,
  upsertMangaListEntry: action.mangaProgress,
}));
vi.mock("@/lib/kitsu/client-queries", () => ({
  getAnimeResolvePayloadBySlug: action.animePayload,
  getMangaResolvePayloadBySlug: action.mangaPayload,
}));
vi.mock("./AnimeListEntryEditModal", () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Edit anime">
        <button type="button" onClick={onClose}>
          Close editor
        </button>
      </div>
    ) : null,
}));
vi.mock("./MangaListEntryEditModal", () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Edit manga">
        <button type="button" onClick={onClose}>
          Close editor
        </button>
      </div>
    ) : null,
}));
beforeEach(() => {
  for (const fn of Object.values(action))
    fn.mockReset().mockResolvedValue({ ok: true });
  action.animePayload.mockResolvedValue(null);
  action.mangaPayload.mockResolvedValue(null);
});
afterEach(cleanup);
type Kind = "anime" | "manga";
function show(
  type: Kind,
  status?: string,
  progress = 0,
  count: number | null = 12,
  id: string | null = "database-42",
) {
  return type === "anime"
    ? render(
        <AnimeDetailActions
          animeId={id}
          kitsuId="kitsu42"
          title="Title"
          episodeCount={count}
          entry={
            status
              ? ({ watchStatus: status, progress } as AnimeListEntry)
              : null
          }
        />,
      )
    : render(
        <MangaDetailActions
          mangaId={id}
          kitsuId="kitsu42"
          title="Title"
          chapterCount={count}
          volumeCount={3}
          entry={
            status ? ({ readStatus: status, progress } as MangaListEntry) : null
          }
        />,
      );
}
for (const type of ["anime", "manga"] as const)
  describe(`${type} detail actions`, () => {
    const active = type === "anime" ? "WATCHING" : "READING";
    const activeLabel = type === "anime" ? "Watching" : "Reading";
    const plan = type === "anime" ? "PLAN_TO_WATCH" : "PLAN_TO_READ";
    const planLabel = type === "anime" ? "Want to Watch" : "Want to Read";
    const statusAction =
      type === "anime" ? action.animeStatus : action.mangaStatus;
    const progressAction =
      type === "anime" ? action.animeProgress : action.mangaProgress;
    const resolveAction =
      type === "anime" ? action.animeResolve : action.mangaResolve;
    const payloadAction =
      type === "anime" ? action.animePayload : action.mangaPayload;
    const restartAction =
      type === "anime" ? action.animeRewatch : action.mangaReread;
    const progressLabel = type === "anime" ? "Episode" : "Chapter";
    const restartLabel = type === "anime" ? "Rewatch" : "Reread";
    const idKey = type === "anime" ? "animeId" : "mangaId";
    const statusKey = type === "anime" ? "watchStatus" : "readStatus";

    it.each([
      [undefined, [planLabel, activeLabel, "Completed"]],
      [plan, [activeLabel, "Completed"]],
      [active, ["Completed"]],
      ["ON_HOLD", [activeLabel, "Completed"]],
      ["DROPPED", [activeLabel, "Completed"]],
      ["COMPLETED", []],
    ] as const)("offers appropriate transitions for %s", (status, labels) => {
      show(type, status);
      for (const label of [planLabel, activeLabel, "Completed"])
        expect(Boolean(screen.queryByRole("button", { name: label }))).toBe(
          labels.includes(label as never),
        );
    });
    it("writes a direct status update and refreshes only on success", async () => {
      show(type);
      fireEvent.click(screen.getByRole("button", { name: activeLabel }));
      await waitFor(() => expect(action.refresh).toHaveBeenCalledTimes(1));
      expect(statusAction).toHaveBeenCalledWith({
        [idKey]: "database-42",
        [statusKey]: active,
      });
    });
    it("resolves an untracked title with fallback metadata before applying status", async () => {
      show(type, undefined, 0, 12, null);
      fireEvent.click(screen.getByRole("button", { name: planLabel }));
      await waitFor(() => expect(resolveAction).toHaveBeenCalled());
      expect(payloadAction).toHaveBeenCalledWith("kitsu42");
      expect(resolveAction).toHaveBeenCalledWith(
        type === "anime"
          ? { kitsuId: "kitsu42", titleEn: "Title", episodeCount: 12 }
          : {
              kitsuId: "kitsu42",
              titleEn: "Title",
              chapterCount: 12,
              volumeCount: 3,
            },
        plan,
      );
      expect(statusAction).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "Edit" }),
      ).not.toBeInTheDocument();
    });
    it("passes resolved provider identity through without reconstructing it", async () => {
      const payload = { kitsuId: "kitsu42", titleEn: "Resolved", malId: 9 };
      payloadAction.mockResolvedValue(payload);
      show(type, undefined, 0, null, null);
      fireEvent.click(screen.getByRole("button", { name: "Completed" }));
      await waitFor(() =>
        expect(resolveAction).toHaveBeenCalledWith(payload, "COMPLETED"),
      );
    });
    it("surfaces rejected status updates instead of refreshing stale data", async () => {
      statusAction.mockResolvedValue({ ok: false, error: "Unauthorized" });
      show(type);
      fireEvent.click(screen.getByRole("button", { name: activeLabel }));
      await waitFor(() =>
        expect(action.snack).toHaveBeenCalledWith("Unauthorized", {
          variant: "error",
        }),
      );
      expect(action.refresh).not.toHaveBeenCalled();
    });
    it("increments progress while retaining the active status", async () => {
      show(type, active, 2, null);
      fireEvent.click(screen.getByRole("button", { name: progressLabel }));
      await waitFor(() =>
        expect(progressAction).toHaveBeenCalledWith({
          [idKey]: "database-42",
          [statusKey]: active,
          progress: 3,
        }),
      );
      await waitFor(() => expect(action.refresh).toHaveBeenCalledTimes(1));
    });
    it("completes the entry instead of incrementing beyond its known total", async () => {
      show(type, active, 11, 12);
      fireEvent.click(screen.getByRole("button", { name: progressLabel }));
      await waitFor(() =>
        expect(statusAction).toHaveBeenCalledWith({
          [idKey]: "database-42",
          [statusKey]: "COMPLETED",
        }),
      );
      expect(progressAction).not.toHaveBeenCalled();
    });
    it("keeps progress errors visible without refreshing", async () => {
      progressAction.mockResolvedValue({ ok: false, error: "Save failed" });
      show(type, active, 0);
      fireEvent.click(screen.getByRole("button", { name: progressLabel }));
      await waitFor(() =>
        expect(action.snack).toHaveBeenCalledWith("Save failed", {
          variant: "error",
        }),
      );
      expect(action.refresh).not.toHaveBeenCalled();
    });
    it.each([true, false])(
      "restarts completed media and handles success=%s",
      async (ok) => {
        restartAction.mockResolvedValue(
          ok ? { ok: true } : { ok: false, error: "Restart denied" },
        );
        show(type, "COMPLETED");
        fireEvent.click(screen.getByRole("button", { name: restartLabel }));
        await waitFor(() =>
          expect(restartAction).toHaveBeenCalledWith("database-42"),
        );
        await waitFor(() =>
          ok
            ? expect(action.refresh).toHaveBeenCalledTimes(1)
            : expect(action.snack).toHaveBeenCalledWith("Restart denied", {
                variant: "error",
              }),
        );
        if (!ok) expect(action.refresh).not.toHaveBeenCalled();
      },
    );
    it("opens and closes the editor for an existing title", () => {
      show(type, active);
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
