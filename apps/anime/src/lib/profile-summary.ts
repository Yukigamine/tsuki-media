import "server-only";

import { getLibrarySnapshot } from "@/lib/library";
import { Thunder, UserStatisticsSort } from "@/lib/zeus/anilist";

const ANILIST_GRAPHQL =
  process.env.ANILIST_API_URL ?? "https://graphql.anilist.co";

export type ProfileSummary = {
  favoriteGenres: string[];
  animeOwned: number;
  mangaVolumesOwned: number;
  mangaChaptersOwned: number;
};

const anilistPublicClient = Thunder(async (query, variables) => {
  const response = await fetch(ANILIST_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const body = (await response.json()) as {
    data?: unknown;
    errors?: { message: string }[];
  };

  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(
      body.errors?.[0]?.message ?? `AniList HTTP ${response.status}`,
    );
  }

  return body.data;
});

async function getFavoriteGenres(username: string | null): Promise<string[]> {
  if (!username) return [];

  try {
    const result = await anilistPublicClient("query")({
      User: [
        { name: username },
        {
          statistics: {
            anime: {
              genres: [
                { limit: 10, sort: [UserStatisticsSort.COUNT_DESC] },
                { count: true, genre: true },
              ],
            },
            manga: {
              genres: [
                { limit: 10, sort: [UserStatisticsSort.COUNT_DESC] },
                { count: true, genre: true },
              ],
            },
          },
        },
      ],
    });

    const totals = new Map<string, number>();
    const genres = [
      ...(result.User?.statistics?.anime?.genres ?? []),
      ...(result.User?.statistics?.manga?.genres ?? []),
    ];

    for (const item of genres) {
      if (!item?.genre) continue;
      totals.set(item.genre, (totals.get(item.genre) ?? 0) + (item.count ?? 0));
    }

    return [...totals.entries()]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .slice(0, 3)
      .map(([genre]) => genre);
  } catch (error) {
    console.error("[profile] Failed to load AniList genres:", error);
    return [];
  }
}

export async function getProfileSummary(
  anilistUsername: string | null,
): Promise<ProfileSummary> {
  const [favoriteGenres, library] = await Promise.all([
    getFavoriteGenres(anilistUsername),
    getLibrarySnapshot(),
  ]);
  const animeOwned = library.anime.reduce(
    (total, item) => total + item.collectionItems.length,
    0,
  );
  const mangaItems = library.manga.flatMap((item) => item.collectionItems);

  return {
    favoriteGenres,
    animeOwned,
    mangaVolumesOwned: mangaItems.reduce(
      (total, item) => total + item.volumes.length,
      0,
    ),
    mangaChaptersOwned: mangaItems.reduce(
      (total, item) => total + item.chapters.length,
      0,
    ),
  };
}
