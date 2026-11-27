import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: vi.fn(),
  library: vi.fn(),
  anime: vi.fn(),
  manga: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("not-found");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: f.notFound }));
vi.mock("@/lib/session", () => ({ getSession: f.session }));
vi.mock("@/lib/library", () => ({ getLibrarySnapshot: f.library }));
vi.mock("@/lib/media-detail", () => ({
  getAnimeDetailSnapshot: f.anime,
  getMangaDetailSnapshot: f.manga,
}));
vi.mock("@/components/ProviderMediaDetailPage", () => ({
  default: (props: object) => (
    <pre data-testid="detail">{JSON.stringify(props)}</pre>
  ),
}));

import AnimeDetail from "./anime/[slug]/[kitsuId]/page";
import MangaDetail from "./manga/[slug]/[kitsuId]/page";

beforeEach(() => {
  for (const mock of Object.values(f)) mock.mockReset();
  f.notFound.mockImplementation((): never => {
    throw new Error("not-found");
  });
  f.session.mockResolvedValue(null);
  f.library.mockResolvedValue({ anime: [], manga: [] });
});

describe.each(["anime", "manga"] as const)("%s detail route joins", (type) => {
  const page = type === "anime" ? AnimeDetail : MangaDetail;
  const detailMock = type === "anime" ? f.anime : f.manga;
  const props = {
    params: Promise.resolve({ slug: "url-title", kitsuId: "123" }),
  };
  it("returns not-found before loading collection data for an unknown identifier", async () => {
    detailMock.mockResolvedValue(null);
    await expect(page(props)).rejects.toThrow("not-found");
    expect(detailMock).toHaveBeenCalledWith("123");
    expect(f.library).not.toHaveBeenCalled();
  });
  it("joins matching local ownership without borrowing another media record", async () => {
    const detail = {
      id: "local",
      kitsuId: "456",
      titleEn: "English",
      titleRomaji: "Romaji",
      anilistId: 9,
    };
    const entries = [
      { id: "c1", format: "BLURAY" },
      { id: "c2", format: "DVD" },
    ];
    const listEntry = { status: "CURRENT", progress: 3 };
    detailMock.mockResolvedValue(detail);
    f.session.mockResolvedValue({ user: { id: "owner" } });
    f.library.mockResolvedValue({
      anime: [],
      manga: [],
      [type]: [
        {
          id: "unrelated",
          listEntry: { status: "COMPLETED" },
          collectionItems: [],
        },
        { id: "local", listEntry, collectionItems: entries },
      ],
    });
    render(await page(props));
    const received = JSON.parse(
      screen.getByTestId("detail").textContent ?? "{}",
    );
    expect(received).toMatchObject({
      kitsuId: "456",
      fallbackTitle: "English",
      mediaType: type,
      mediaId: "local",
      anilistId: 9,
      initialDetail: detail,
      hasSession: true,
      listEntry,
      collectionCount: 2,
      collectionItems: entries,
    });
    if (type === "anime")
      expect(received.collectionFormats).toEqual(["BLURAY", "DVD"]);
  });
  it.each([
    [null, "Romaji", "Romaji"],
    [null, null, "url-title"],
  ])(
    "uses public title fallbacks without inventing ownership (%s/%s)",
    async (titleEn, titleRomaji, expected) => {
      detailMock.mockResolvedValue({
        id: "provider-only",
        kitsuId: "123",
        titleEn,
        titleRomaji,
        anilistId: null,
      });
      render(await page(props));
      expect(
        JSON.parse(screen.getByTestId("detail").textContent ?? "{}"),
      ).toMatchObject({
        fallbackTitle: expected,
        mediaId: null,
        anilistId: null,
        hasSession: false,
        listEntry: null,
        collectionCount: 0,
        collectionItems: [],
      });
    },
  );
  it("propagates a failed provider lookup rather than rendering fabricated detail", async () => {
    detailMock.mockRejectedValue(new Error("provider unavailable"));
    await expect(page(props)).rejects.toThrow("provider unavailable");
    expect(f.library).not.toHaveBeenCalled();
  });
});
