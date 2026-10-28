import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionAddButton } from "./CollectionAddButton";
import { CollectionItemActions } from "./CollectionItemActions";
import { CollectionViewToggle } from "./CollectionViewToggle";
import ListSearchField from "./ListSearchField";
import MediaDetailActionButtons from "./MediaDetailActionButtons";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("debounces search input and cancels stale updates when the search is cleared", () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  render(<ListSearchField onSearchChange={changed} />);
  const input = screen.getByPlaceholderText("Search...");
  fireEvent.change(input, { target: { value: "A" } });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  fireEvent.change(input, { target: { value: "Anime" } });
  act(() => {
    vi.advanceTimersByTime(179);
  });
  expect(changed).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith("Anime");
  fireEvent.change(input, { target: { value: "Pending" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input).toHaveValue("");
  expect(changed).toHaveBeenLastCalledWith("");
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(changed).toHaveBeenCalledTimes(2);
});

it("cancels a pending debounced search when the field unmounts", () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const { unmount } = render(<ListSearchField onSearchChange={changed} />);
  fireEvent.change(screen.getByPlaceholderText("Search..."), {
    target: { value: "Pending" },
  });
  unmount();
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(changed).not.toHaveBeenCalled();
});

it("does not deselect an exclusive collection view and forwards a new view", () => {
  const changed = vi.fn();
  render(<CollectionViewToggle view="grid" onViewChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "grid view" }));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "table view" }));
  expect(changed).toHaveBeenCalledExactlyOnceWith("table");
});

it.each(["anime", "manga"] as const)(
  "keeps icon and text add controls on the correct %s route",
  (type) => {
    const { rerender } = render(<CollectionAddButton type={type} />);
    expect(screen.getByRole("link", { name: "Add" })).toHaveAttribute(
      "href",
      `/collection/${type}/add`,
    );
    rerender(<CollectionAddButton type={type} iconOnly />);
    expect(
      screen.getByRole("link", { name: `Add ${type} to collection` }),
    ).toHaveAttribute("href", `/collection/${type}/add`);
  },
);

it("preserves the item's explicit edit route for inline and card controls", () => {
  const { rerender } = render(
    <CollectionItemActions
      title="Title"
      editHref="/collection/anime/42/edit"
    />,
  );
  expect(screen.getByRole("link", { name: "Edit Title" })).toHaveAttribute(
    "href",
    "/collection/anime/42/edit",
  );
  rerender(
    <CollectionItemActions
      title="Title"
      editHref="/collection/manga/43/edit"
      card
    />,
  );
  expect(screen.getByRole("link", { name: "Edit Title" })).toHaveAttribute(
    "href",
    "/collection/manga/43/edit",
  );
});

it("dispatches each detail action and disables all mutations while pending", () => {
  const top = vi.fn(),
    quick = vi.fn(),
    bottom = vi.fn(),
    edit = vi.fn();
  const props = {
    topAction: {
      label: "Add to list",
      icon: <span aria-hidden="true">+</span>,
      onClick: top,
    },
    quickActions: [{ key: "progress", label: "Next episode", onClick: quick }],
    bottomAction: {
      label: "Remove",
      icon: <span aria-hidden="true">×</span>,
      onClick: bottom,
    },
    onEdit: edit,
  };
  const { rerender } = render(
    <MediaDetailActionButtons {...props} pending={false} />,
  );
  for (const name of ["Add to list", "Next episode", "Remove", "Edit"])
    fireEvent.click(screen.getByRole("button", { name }));
  for (const fn of [top, quick, bottom, edit])
    expect(fn).toHaveBeenCalledTimes(1);
  rerender(<MediaDetailActionButtons {...props} pending />);
  for (const button of screen.getAllByRole("button")) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  for (const fn of [top, quick, bottom, edit])
    expect(fn).toHaveBeenCalledTimes(1);
  rerender(<MediaDetailActionButtons quickActions={[]} pending={false} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
