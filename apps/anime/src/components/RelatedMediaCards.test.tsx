import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import RelatedMediaCards from "./RelatedMediaCards";

vi.mock("next/link", () => ({
  default: ({
    onClick,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    />
  ),
}));
const relation = (
  id: string,
  title: string,
  kind: unknown,
  date: unknown,
  type = "Anime",
) => ({
  kind,
  destination: {
    __typename: type,
    id,
    startDate: date,
    titles: { canonical: title },
    posterImage: { original: { url: `https://images.example.test/${id}.jpg` } },
  },
});
function response(nodes: unknown[], mediaType = "anime") {
  return Response.json({
    data: {
      [mediaType === "anime" ? "findAnimeById" : "findMangaById"]: {
        relationships: { nodes },
      },
    },
  });
}
describe("related media browser results", () => {
  it("orders dated titles chronologically, keeps undated order stable and links to the correct media type", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response([
        relation("late", "Later story", "SEQUEL", "2025-01-01"),
        relation("none1", "No date one", "PREQUEL", null),
        relation(
          "early",
          "Original manga",
          "ADAPTATION",
          "2020-03-01",
          "Manga",
        ),
        relation("none2", "No date two", "SEQUEL", "bad-date"),
        relation("invalid", "Unsupported", "SIDE_STORY", "2020-01-01"),
        {
          kind: "PREQUEL",
          destination: { id: "", titles: { canonical: "Missing ID" } },
        },
        {
          kind: 42,
          destination: { id: "bad", titles: { canonical: "Bad kind" } },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    render(<RelatedMediaCards kitsuId="7" mediaType="anime" />);
    await screen.findByRole("heading", { name: "Related Media" });
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Original manga"),
      expect.stringContaining("Later story"),
      expect.stringContaining("No date one"),
      expect.stringContaining("No date two"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/manga/original-manga/early");
    expect(screen.getByText("Adaptation (Manga) · 2020")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Original manga" })).toHaveAttribute(
      "src",
      "https://images.example.test/early.jpg",
    );
    expect(screen.queryByText("Unsupported")).not.toBeInTheDocument();
    expect(String(fetch.mock.calls[0][1].body)).toContain("findAnimeById");
  });
  it("supports manga relationships, title fallbacks and absent poster images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          [
            {
              kind: "ADAPTATION",
              destination: {
                __typename: "Anime",
                id: "2",
                titles: { romanized: "Romanized adaptation" },
                startDate: 2020,
              },
            },
            {
              kind: "PREQUEL",
              destination: { id: "3", titles: { original: "Native title" } },
            },
            { kind: "SEQUEL", destination: { id: "4", slug: "slug-fallback" } },
            { kind: "SEQUEL", destination: { id: "5" } },
          ],
          "manga",
        ),
      ),
    );
    render(<RelatedMediaCards kitsuId="8" mediaType="manga" />);
    expect(await screen.findByText("Romanized adaptation")).toBeInTheDocument();
    expect(screen.getByText(/Adaptation \(Anime\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Native title/ })).toHaveAttribute(
      "href",
      "/anime/native-title/3",
    );
    expect(
      screen.getByRole("link", { name: /slug-fallback/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "5 Sequel" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it.each([
    Response.json(
      { errors: [{ message: "provider refused" }] },
      { status: 400 },
    ),
    Response.json({}, { status: 503 }),
    Response.json({ data: null }),
    new Response("<html>Cloudflare challenge</html>", {
      status: 403,
      headers: { "cf-mitigated": "challenge" },
    }),
  ])(
    "keeps failed or challenged provider data out of the cards",
    async (providerResponse) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse));
      const { container } = render(
        <RelatedMediaCards kitsuId="7" mediaType="anime" />,
      );
      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(container.querySelector(".related-media-empty")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    },
  );
  it("keeps an empty provider result empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: { findAnimeById: {} } })),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <RelatedMediaCards kitsuId="7" mediaType="anime" />,
      ));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector(".related-media-empty")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
