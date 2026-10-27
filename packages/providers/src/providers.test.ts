import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHardcoverResults } from "./hardcover";
import { normalizeTmdbResults } from "./tmdb";

test("normalizes Hardcover book search results", () => {
  assert.deepEqual(
    normalizeHardcoverResults({
      data: {
        search: {
          results: [
            {
              id: 42,
              title: "A Book",
              author_names: ["A. Writer"],
              image: { url: "https://example.com/book.jpg" },
              pages: 300,
              release_year: 2024,
            },
          ],
        },
      },
    }),
    [
      {
        id: "42",
        title: "A Book",
        subtitle: "A. Writer",
        imageUrl: "https://example.com/book.jpg",
        metadata: "2024 · 300 pages",
      },
    ],
  );
});

test("normalizes TMDB movie search results", () => {
  assert.deepEqual(
    normalizeTmdbResults({
      results: [
        {
          id: 7,
          title: "A Movie",
          original_title: "Original Movie",
          release_date: "2025-02-03",
          poster_path: "/poster.jpg",
        },
      ],
    }),
    [
      {
        id: "7",
        title: "A Movie",
        subtitle: "Original Movie",
        imageUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
        metadata: "2025",
      },
    ],
  );
});

test("ignores malformed provider results", () => {
  assert.deepEqual(
    normalizeHardcoverResults({
      data: { search: { results: [{ id: 1 }] } },
    }),
    [],
  );
  assert.deepEqual(normalizeTmdbResults({ results: [{ title: "No id" }] }), []);
});
