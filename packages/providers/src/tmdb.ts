import type { MediaSearchResult } from "./types";

const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_URL = "https://image.tmdb.org/t/p/w500";

type TmdbMovie = {
  id?: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
};

type TmdbResponse = {
  results?: TmdbMovie[];
};

export function normalizeTmdbResults(
  payload: TmdbResponse,
): MediaSearchResult[] {
  if (!Array.isArray(payload.results)) {
    return [];
  }

  return payload.results.flatMap((movie) => {
    if (typeof movie.id !== "number" || !movie.title) {
      return [];
    }
    const year = movie.release_date?.slice(0, 4);
    return [
      {
        id: String(movie.id),
        title: movie.title,
        subtitle:
          movie.original_title && movie.original_title !== movie.title
            ? movie.original_title
            : undefined,
        imageUrl: movie.poster_path
          ? `${TMDB_IMAGE_URL}${movie.poster_path}`
          : undefined,
        metadata: year || undefined,
      },
    ];
  });
}

export async function searchTmdbMovies(
  query: string,
  token: string,
): Promise<MediaSearchResult[]> {
  const url = new URL(`${TMDB_API_URL}/search/movie`);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  url.searchParams.set("page", "1");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: ["Bearer", token].join(" "),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`TMDB request failed (${response.status})`);
  }
  return normalizeTmdbResults((await response.json()) as TmdbResponse);
}
