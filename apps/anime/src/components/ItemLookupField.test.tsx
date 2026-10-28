import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KitsuSearchResult } from "@/lib/actions/collection/types";
import { ItemLookupField } from "./ItemLookupField";

const search = vi.hoisted(() => ({ anime: vi.fn(), manga: vi.fn() }));
vi.mock("@/lib/kitsu/client-queries", () => ({
  searchAnimeByTitleClient: search.anime,
  searchMangaByTitleClient: search.manga,
}));
const result: KitsuSearchResult = {
  kitsuId: "42",
  rawId: "42",
  titleTranslated: "Translated title",
  titleEn: "English title",
  titleRomaji: "Romaji title",
  titleJp: "日本語",
  posterUrl: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  search.anime.mockReset();
  search.manga.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function elapse() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}
function input(value: string) {
  const field = screen.getByRole("combobox");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value } });
  return field;
}

it("debounces rapid anime queries and selects/clears a result through the real autocomplete", async () => {
  search.anime.mockResolvedValue([result]);
  const select = vi.fn();
  render(<ItemLookupField type="anime" onSelect={select} />);
  input("first");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  input("latest");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(349);
  });
  expect(search.anime).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(search.anime).toHaveBeenCalledExactlyOnceWith("latest");
  expect(search.manga).not.toHaveBeenCalled();
  const option = screen.getByRole("option");
  expect(option).toHaveTextContent("Translated title");
  expect(option).toHaveTextContent("Romaji title");
  fireEvent.click(option);
  expect(select).toHaveBeenLastCalledWith(result);
  await elapse();
  expect(search.anime).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(select).toHaveBeenLastCalledWith(null);
});

it("routes manga searches and renders Japanese fallback titles and configured posters", async () => {
  const manga = {
    ...result,
    titleTranslated: null,
    titleEn: null,
    titleRomaji: null,
    posterUrl: "https://example.invalid/poster.jpg",
  };
  search.manga.mockResolvedValue([manga]);
  render(<ItemLookupField type="manga" onSelect={vi.fn()} />);
  input("日本");
  await elapse();
  expect(search.manga).toHaveBeenCalledExactlyOnceWith("日本");
  expect(search.anime).not.toHaveBeenCalled();
  expect(screen.getByRole("option")).toHaveTextContent("日本語");
  expect(screen.getByRole("img", { name: "日本語" })).toHaveAttribute(
    "src",
    manga.posterUrl,
  );
});

it("does not search an initial selection or a disabled field", async () => {
  const { rerender } = render(
    <ItemLookupField type="anime" initialValue={result} onSelect={vi.fn()} />,
  );
  expect(screen.getByRole("combobox")).toHaveValue("Translated title");
  await elapse();
  expect(search.anime).not.toHaveBeenCalled();
  rerender(<ItemLookupField type="anime" disabled onSelect={vi.fn()} />);
  expect(screen.getByRole("combobox")).toBeDisabled();
  await elapse();
  expect(search.anime).not.toHaveBeenCalled();
});

it("clears stale search options after provider failure", async () => {
  search.anime
    .mockResolvedValueOnce([result])
    .mockRejectedValueOnce(new Error("Offline"));
  render(<ItemLookupField type="anime" onSelect={vi.fn()} />);
  input("good");
  await elapse();
  expect(screen.getByRole("option")).toHaveTextContent("Translated title");
  input("failed");
  await elapse();
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
