import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SyncDashboard from "./SyncDashboard";

const m = vi.hoisted(() => ({
  status: vi.fn(),
  invalid: vi.fn(),
  normalize: vi.fn(),
  remove: vi.fn(),
  trigger: vi.fn(),
  repair: vi.fn(),
  snack: vi.fn(),
}));
vi.mock("@/lib/actions", () => ({
  getSyncStatusAction: m.status,
  findInvalidEntriesAction: m.invalid,
  normalizeInvalidRatingsAction: m.normalize,
  deleteInvalidEntriesAction: m.remove,
  triggerSyncAction: m.trigger,
}));
vi.mock("@/lib/kitsu/client-mapping-repair", () => ({
  repairMissingKitsuMappings: m.repair,
}));
vi.mock("notistack", () => ({ enqueueSnackbar: m.snack }));
// Kitsu's network and mutation orchestration has its own integration suite.
vi.mock("@/components/KitsuSyncButton", () => ({
  default: ({
    onSynced,
    renderAfterButton,
  }: {
    onSynced: () => void;
    renderAfterButton: (d: "PULL" | "PUSH") => ReactNode;
  }) => (
    <>
      <button type="button" onClick={onSynced}>
        Refresh Kitsu
      </button>
      {renderAfterButton("PULL")}
      {renderAfterButton("PUSH")}
    </>
  ),
}));
const empty = { invalidAnime: [], invalidManga: [] };
const auth = {
  KITSU: { loggedIn: true, username: "reader" },
  ANILIST: { loggedIn: true, username: "reader2" },
};
function log(extra = {}) {
  return {
    id: "log",
    provider: "ANILIST",
    direction: "PULL",
    status: "COMPLETED",
    animeSynced: 4,
    mangaSynced: 2,
    animeChanged: 1,
    mangaChanged: 0,
    errors: [],
    deletions: [],
    startedAt: new Date("2026-01-01T00:00:00Z"),
    finishedAt: new Date("2026-01-01T00:00:02Z"),
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.status.mockResolvedValue({ auth, logs: [] });
  m.invalid.mockResolvedValue(empty);
  m.normalize.mockResolvedValue({
    ok: true,
    data: { animeFixed: 0, mangaFixed: 0 },
  });
  m.remove.mockResolvedValue({ ok: true });
  m.trigger.mockResolvedValue({ ok: true, data: { logId: "log" } });
  m.repair.mockResolvedValue({
    repairedAnime: 0,
    repairedManga: 0,
    repairedAniListAnime: 0,
    repairedAniListManga: 0,
    unresolved: [],
    unavailableAniListMappings: [],
  });
});
async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Pull from AniList" }),
    ).toBeEnabled(),
  );
}
describe("SyncDashboard", () => {
  it("keeps unconnected provider actions disabled, then enables them after a status refresh", async () => {
    m.status.mockResolvedValueOnce({
      auth: { ...auth, ANILIST: { loggedIn: false, username: null } },
      logs: [],
    });
    render(<SyncDashboard />);
    await screen.findByText("Not connected");
    expect(
      screen.getByRole("button", { name: "Pull from AniList" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Kitsu" }));
    await ready();
  });
  it("tolerates initial status and validation lookup failures without enabling unauthenticated sync", async () => {
    m.status.mockRejectedValue(new Error("offline"));
    m.invalid.mockRejectedValue(new Error("offline"));
    render(<SyncDashboard />);
    await waitFor(() => expect(m.status).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Push to AniList" }),
    ).toBeDisabled();
  });
  it("pulls AniList, repairs mappings, refreshes counts and reports completed log totals", async () => {
    m.status
      .mockResolvedValueOnce({ auth, logs: [] })
      .mockResolvedValue({ auth, logs: [log()] });
    m.repair.mockResolvedValue({
      repairedAnime: 1,
      repairedManga: 1,
      repairedAniListAnime: 1,
      repairedAniListManga: 0,
      unresolved: ["one"],
      unavailableAniListMappings: ["two"],
    });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pull from AniList" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith(
        expect.stringContaining("synced 4 anime and 2 manga"),
        { variant: "success" },
      ),
    );
    expect(m.trigger).toHaveBeenCalledWith("ANILIST", "PULL");
    expect(m.repair).toHaveBeenCalledOnce();
    expect(m.snack).toHaveBeenCalledWith(
      "Repaired 2 Kitsu and 1 AniList media IDs",
      { variant: "info" },
    );
    expect(m.snack).toHaveBeenCalledWith("1 item could not be fully mapped", {
      variant: "warning",
    });
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
  });
  it("preserves successful pull when optional mapping repair fails", async () => {
    m.repair.mockRejectedValue(new Error("Mapping offline"));
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pull from AniList" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith("AniList pull finished", {
        variant: "success",
      }),
    );
    expect(m.snack).toHaveBeenCalledWith("Mapping offline", {
      variant: "warning",
    });
  });
  it("pushes without running pull-only repair, and allows retry after action rejection", async () => {
    m.trigger.mockResolvedValueOnce({ ok: false, error: "Reconnect AniList" });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Push to AniList" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith("Reconnect AniList", {
        variant: "error",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Push to AniList" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith("AniList push finished", {
        variant: "success",
      }),
    );
    expect(m.repair).not.toHaveBeenCalled();
  });
  it("normalizes ratings and reports a clean validation without opening deletion UI", async () => {
    m.normalize.mockResolvedValue({
      ok: true,
      data: { animeFixed: 1, mangaFixed: 1 },
    });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith("No invalid entries found", {
        variant: "success",
      }),
    );
    expect(m.snack).toHaveBeenCalledWith(
      expect.stringContaining("Normalized 2 invalid ratings"),
      { variant: "info" },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("requires explicit selection and deletes only selected anime and manga after validation", async () => {
    m.invalid.mockResolvedValue({
      invalidAnime: [
        {
          id: "a",
          title: "Broken anime",
          progress: 13,
          progressLimit: 12,
          issues: ["progress exceeds episode count"],
        },
      ],
      invalidManga: [{ id: "m", title: null, issues: ["missing Kitsu ID"] }],
    });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByRole("dialog");
    const remove = screen.getByRole("button", { name: /Delete selected/ });
    expect(remove).toBeDisabled();
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]);
    fireEvent.click(checks[0]);
    expect(remove).toBeDisabled();
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    fireEvent.click(remove);
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith(["a"], ["m"]));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(m.snack).toHaveBeenCalledWith("Deleted 2 invalid entries", {
      variant: "success",
    });
  });
  it("keeps failed deletion selections available for retry and supports cancel", async () => {
    m.normalize.mockResolvedValue({ ok: false, error: "Rating denied" });
    m.invalid.mockResolvedValue({
      invalidAnime: [],
      invalidManga: [
        {
          id: "m",
          title: "Broken manga",
          progressLimit: 10,
          issues: ["progress exceeds chapter count"],
        },
      ],
    });
    m.remove.mockResolvedValue({ ok: false, error: "Delete denied" });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Delete selected/ }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith("Delete denied", {
        variant: "error",
      }),
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("renders provider history with expandable error and deletion details", async () => {
    m.status.mockResolvedValue({
      auth,
      logs: [
        log({
          provider: "KITSU",
          status: "FAILED",
          errors: ["Provider refused"],
          deletions: ["Old title"],
        }),
        log({
          id: "running",
          status: "RUNNING",
          direction: "PUSH",
          finishedAt: null,
        }),
        log({ id: "cancelled", status: "CANCELLED" }),
      ],
    });
    render(<SyncDashboard />);
    await ready();
    expect(screen.getAllByText("FAILED").length).toBeGreaterThan(0);
    const details = screen.getAllByRole("button", { name: /1 error/ });
    fireEvent.click(details[0]);
    await waitFor(() =>
      expect(screen.getAllByText("Provider refused")[0]).toBeVisible(),
    );
    fireEvent.click(details[0]);
    expect(screen.getAllByText("CANCELLED").length).toBeGreaterThan(0);
  });
  it("reports singular rating repair and lets manga validation be deselected before deleting", async () => {
    m.normalize.mockResolvedValue({
      ok: true,
      data: { animeFixed: 0, mangaFixed: 1 },
    });
    m.invalid.mockResolvedValue({
      invalidAnime: [],
      invalidManga: [
        {
          id: "m",
          title: "Overread",
          progress: 11,
          progressLimit: 10,
          issues: ["progress exceeds chapter count"],
        },
      ],
    });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await screen.findByRole("dialog");
    expect(m.snack).toHaveBeenCalledWith(
      "Normalized 1 invalid rating (clamped to 2-20 range)",
      { variant: "info" },
    );
    expect(screen.getByText(/Progress: 11, Chapters: 10/)).toBeVisible();
    const check = screen.getByRole("checkbox");
    fireEvent.click(check);
    fireEvent.click(check);
    expect(
      screen.getByRole("button", { name: "Delete selected" }),
    ).toBeDisabled();
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("displays deletion-only history and allows opening and closing recent-run details", async () => {
    m.status.mockResolvedValue({
      auth,
      logs: [
        log({
          errors: null,
          deletions: ["Removed manga"],
          animeChanged: 0,
          mangaChanged: 1,
        }),
      ],
    });
    render(<SyncDashboard />);
    await ready();
    const buttons = screen.getAllByRole("button", { name: "1 deleted" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(
        screen
          .getAllByText("Deleted Removed manga")
          .some((el) => el.closest(".MuiCollapse-entered")),
      ).toBe(true),
    );
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(
        screen
          .getAllByText("Deleted Removed manga")
          .some((el) => el.closest(".MuiCollapse-entered")),
      ).toBe(false),
    );
    expect(
      screen.queryByRole("button", { name: /error/ }),
    ).not.toBeInTheDocument();
  });

  it("reports plural mapping warnings and a single repaired ID without failing a completed pull", async () => {
    m.repair.mockResolvedValue({
      repairedAnime: 0,
      repairedManga: 1,
      repairedAniListAnime: 0,
      repairedAniListManga: 0,
      unresolved: ["a", "b"],
      unavailableAniListMappings: ["c", "d"],
    });
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pull from AniList" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith("AniList pull finished", {
        variant: "success",
      }),
    );
    expect(m.snack).toHaveBeenCalledWith(
      "Repaired 1 Kitsu and 0 AniList media ID",
      { variant: "info" },
    );
    expect(m.snack).toHaveBeenCalledWith("2 items could not be fully mapped", {
      variant: "warning",
    });
    expect(m.snack).toHaveBeenCalledWith(
      "2 items do not have an AniList mapping",
      { variant: "info" },
    );
  });

  it("keeps successful sync usable when optional mapping repair rejects with a non-Error value", async () => {
    m.repair.mockRejectedValue("network unavailable");
    render(<SyncDashboard />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Pull from AniList" }));
    await waitFor(() =>
      expect(m.snack).toHaveBeenCalledWith(
        "Unable to repair Kitsu media mappings",
        { variant: "warning" },
      ),
    );
    await ready();
  });
});
