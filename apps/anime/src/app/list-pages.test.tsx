import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  anime: vi.fn(),
  manga: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/lib/list", () => ({
  getAnimeListSnapshot: f.anime,
  getMangaListSnapshot: f.manga,
}));
vi.mock("@/lib/session", () => ({ getSession: f.session }));
vi.mock("@/components/AnimeListClient", () => ({
  default: (props: object) => (
    <pre data-testid="list">{JSON.stringify(props)}</pre>
  ),
}));
vi.mock("@/components/MangaListClient", () => ({
  default: (props: object) => (
    <pre data-testid="list">{JSON.stringify(props)}</pre>
  ),
}));
vi.mock("@/components/ListAddButton", () => ({
  default: ({
    type,
    existingKitsuIds,
  }: {
    type: string;
    existingKitsuIds: number[];
  }) => (
    <button type="button" data-ids={JSON.stringify(existingKitsuIds)}>
      Add {type}
    </button>
  ),
}));

import AnimePage from "./list/anime/page";
import MangaPage from "./list/manga/page";

beforeEach(() => {
  f.anime.mockReset();
  f.manga.mockReset();
  f.session.mockReset().mockResolvedValue(null);
});
describe("public list page joins", () => {
  it.each(["anime", "manga"] as const)(
    "passes %s snapshot counts unchanged and keeps mutations gated",
    async (type) => {
      const items = [
        { id: 1, kitsuId: 8, titleEn: "Tracked" },
        { id: 2, kitsuId: null, titleEn: "Local only" },
      ];
      (type === "anime" ? f.anime : f.manga).mockResolvedValue({
        items,
        counts: { total: 2 },
      });
      render(await (type === "anime" ? AnimePage() : MangaPage()));
      expect(
        JSON.parse(screen.getByTestId("list").textContent || "{}"),
      ).toMatchObject({ items, counts: { total: 2 } });
      expect(
        screen.queryByRole("button", { name: `Add ${type}` }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["anime", "manga"] as const)(
    "keeps already-linked Kitsu IDs out of authenticated %s add choices",
    async (type) => {
      (type === "anime" ? f.anime : f.manga).mockResolvedValue({
        items: [
          { id: 1, kitsuId: 8 },
          { id: 2, kitsuId: null },
        ],
        counts: {},
      });
      f.session.mockResolvedValue({ user: { id: "owner" } });
      render(await (type === "anime" ? AnimePage() : MangaPage()));
      expect(
        screen.getByRole("button", { name: `Add ${type}` }),
      ).toHaveAttribute("data-ids", "[8]");
    },
  );
  it.each([
    [new Error("provider unavailable"), "provider unavailable"],
    ["network unavailable", "network unavailable"],
    [{ message: "SDK failure" }, "SDK failure"],
    [{ code: "unexpected" }, "Unknown error"],
    [null, "Unknown error"],
  ])(
    "renders a stable error boundary for provider error %s",
    async (failure, message) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      f.anime.mockRejectedValue(failure);
      render(await AnimePage());
      expect(screen.getByText("Error loading list")).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(log).toHaveBeenCalled();
      expect(screen.queryByTestId("list")).not.toBeInTheDocument();
    },
  );
  it.each([
    [new Error("manga unavailable"), "manga unavailable"],
    ["network unavailable", "network unavailable"],
    [{ message: "SDK failure" }, "SDK failure"],
    [{ code: "unexpected" }, "Unknown error"],
    [null, "Unknown error"],
  ])(
    "handles manga snapshot failure %s without exposing mutation controls",
    async (failure, message) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      f.manga.mockRejectedValue(failure);
      render(await MangaPage());
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByTestId("list")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Add manga" }),
      ).not.toBeInTheDocument();
    },
  );
});
