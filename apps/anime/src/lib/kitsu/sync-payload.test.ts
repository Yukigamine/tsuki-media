import { describe, expect, it } from "vitest";
import { KitsuLibrarySyncPayloadSchema } from "./sync-payload";

describe("Kitsu library sync input schema", () => {
  it("accepts sparse records and preserves meaningful zero/false provider values", () => {
    expect(
      KitsuLibrarySyncPayloadSchema.parse({
        slug: "profile",
        anime: [
          {
            id: "entry",
            progress: 0,
            rating: 0,
            private: false,
            reconsuming: false,
            media: { id: "media" },
          },
        ],
        manga: [],
      }),
    ).toEqual({
      slug: "profile",
      anime: [
        {
          id: "entry",
          progress: 0,
          rating: 0,
          private: false,
          reconsuming: false,
          media: { id: "media" },
        },
      ],
      manga: [],
    });
  });
  it("supports translated descriptions, nullable optional data and complete image/mapping shapes", () => {
    const media = {
      id: "m",
      slug: null,
      status: null,
      startDate: null,
      endDate: null,
      averageRating: null,
      description: { en: "English", ja: "日本語" },
      titles: {
        canonical: null,
        translated: "T",
        romanized: "R",
        original: "J",
      },
      posterImage: { original: { url: null } },
      bannerImage: { original: null },
      mappings: { nodes: [{ externalId: "1", externalSite: "ANILIST_MANGA" }] },
      episodeCount: 0,
      chapterCount: null,
      volumeCount: 2,
    };
    expect(
      KitsuLibrarySyncPayloadSchema.parse({
        slug: "p",
        anime: [],
        manga: [
          {
            id: "e",
            notes: null,
            private: null,
            progress: null,
            rating: null,
            reconsumeCount: null,
            reconsuming: null,
            status: null,
            updatedAt: null,
            media,
          },
        ],
      }).manga[0].media,
    ).toEqual(media);
    expect(
      KitsuLibrarySyncPayloadSchema.parse({
        slug: "p",
        anime: [
          {
            id: "e",
            media: {
              id: "m",
              description: "Plain text",
              posterImage: null,
              bannerImage: null,
              titles: null,
              mappings: null,
            },
          },
        ],
        manga: [],
      }).anime[0].media.description,
    ).toBe("Plain text");
  });
  it.each([
    { slug: "", anime: [], manga: [] },
    { slug: "p", anime: [{}], manga: [] },
    { slug: "p", anime: [{ id: "e", media: {} }], manga: [] },
    {
      slug: "p",
      anime: [{ id: "e", progress: 0.5, media: { id: "m" } }],
      manga: [],
    },
    {
      slug: "p",
      anime: [{ id: "e", media: { id: "m", chapterCount: 1.5 } }],
      manga: [],
    },
    {
      slug: "p",
      anime: [{ id: "e", media: { id: "m", description: { en: {} } } }],
      manga: [],
    },
  ])("rejects malformed provider/import input %#", (payload) => {
    expect(KitsuLibrarySyncPayloadSchema.safeParse(payload).success).toBe(
      false,
    );
  });
  it("does not retain unexpected fields in validated imports", () => {
    const parsed = KitsuLibrarySyncPayloadSchema.parse({
      slug: "p",
      secret: "drop",
      anime: [
        { id: "e", unexpected: "drop", media: { id: "m", newField: "drop" } },
      ],
      manga: [],
    });
    expect(parsed).toEqual({
      slug: "p",
      anime: [{ id: "e", media: { id: "m" } }],
      manga: [],
    });
  });
});
