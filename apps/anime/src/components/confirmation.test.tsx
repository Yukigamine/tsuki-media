import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionDeleteButton } from "./CollectionDeleteButton";
import ConfirmButton from "./ConfirmButton";
import DialogContainer from "./DialogContainer";

const actions = vi.hoisted(() => ({
  anime: vi.fn(),
  manga: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: actions.push }),
}));
vi.mock("@/lib/actions/collection", () => ({
  deleteAnimeCollectionItem: actions.anime,
  deleteMangaCollectionItem: actions.manga,
}));
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("destructive action confirmation", () => {
  it.each([false, true])(
    "requires two clicks before acting (compact=%s)",
    (compact) => {
      const confirm = vi.fn(),
        expanded = vi.fn();
      const ref = createRef<{ expanded: boolean }>();
      render(
        <ConfirmButton
          ref={ref}
          compact={compact}
          title="Delete item"
          icon={<span>×</span>}
          onConfirm={confirm}
          onExpandedChange={expanded}
        />,
      );
      const button = screen.getByRole("button", { name: "Delete item" });
      fireEvent.click(button);
      expect(confirm).not.toHaveBeenCalled();
      expect(ref.current?.expanded).toBe(true);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(expanded).toHaveBeenLastCalledWith(true);
      fireEvent.click(button);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(ref.current?.expanded).toBe(false);
      expect(button).toHaveAttribute("aria-expanded", "false");
    },
  );

  it("expires an abandoned confirmation and does not confirm on the next first click", () => {
    vi.useFakeTimers();
    const confirm = vi.fn();
    render(
      <ConfirmButton
        title="Remove"
        icon={<span>×</span>}
        onConfirm={confirm}
      />,
    );
    const button = screen.getByRole("button", { name: "Remove" });
    fireEvent.click(button);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ignores disabled confirmations and cleans up an expanded timer on unmount", () => {
    vi.useFakeTimers();
    const confirm = vi.fn();
    const { rerender, unmount } = render(
      <ConfirmButton
        compact
        disabled
        title="Remove"
        icon={<span>×</span>}
        onConfirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).not.toHaveBeenCalled();
    rerender(
      <ConfirmButton
        compact
        title="Remove"
        icon={<span>×</span>}
        onConfirm={confirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(["anime", "manga"] as const)(
    "cancels safely and dispatches only the requested %s deletion",
    async (type) => {
      actions[type].mockResolvedValue({ ok: true });
      render(
        <CollectionDeleteButton
          id="collection-42"
          type={type}
          title="A Title"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Delete A Title" }));
      expect(await screen.findByRole("dialog")).toHaveTextContent(
        "This cannot be undone",
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(actions[type]).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Delete A Title" }));
      fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
      await waitFor(() =>
        expect(actions.push).toHaveBeenCalledWith(`/collection/${type}`),
      );
      expect(actions[type]).toHaveBeenCalledExactlyOnceWith("collection-42");
      expect(
        actions[type === "anime" ? "manga" : "anime"],
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["returned", "thrown"])(
    "shows a %s delete failure and enables retry",
    async (failure) => {
      if (failure === "returned")
        actions.anime.mockResolvedValue({ ok: false, error: "Not authorized" });
      else actions.anime.mockRejectedValue(new Error("Connection failed"));
      render(<CollectionDeleteButton id="42" type="anime" title="Title" />);
      fireEvent.click(screen.getByRole("button", { name: "Delete Title" }));
      fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
      expect(
        await screen.findByText(
          failure === "returned"
            ? "Not authorized"
            : "An unexpected error occurred.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
      expect(actions.push).not.toHaveBeenCalled();
    },
  );

  it("blocks close and repeated deletion while the action is pending", async () => {
    let resolve!: (value: { ok: false; error: string }) => void;
    actions.anime.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<CollectionDeleteButton id="42" type="anime" title="Title" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Title" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      resolve({ ok: false, error: "Try later" });
    });
  });
});

it("prevents a dialog from closing while an action is running", () => {
  const close = vi.fn();
  const { rerender } = render(
    <DialogContainer open title="Save changes" onClose={close} disableClose>
      <p>Content</p>
    </DialogContainer>,
  );
  expect(
    screen.getByRole("button", { name: "Close Save changes" }),
  ).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  rerender(
    <DialogContainer open onClose={close}>
      <p>Content</p>
    </DialogContainer>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(close).toHaveBeenCalledTimes(1);
});
