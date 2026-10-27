import type { MediaSearchResult } from "./types";

const HARDCOVER_API_URL = "https://api.hardcover.app/v1/graphql";

type HardcoverSearchItem = {
  id?: string | number;
  title?: string;
  subtitle?: string;
  slug?: string;
  author_names?: string[];
  image?: { url?: string } | string;
  image_url?: string;
  pages?: number;
  release_year?: number;
};

type HardcoverResponse = {
  data?: {
    search?: {
      results?: unknown;
    };
  };
  errors?: unknown[];
};

function isHardcoverSearchItem(value: unknown): value is HardcoverSearchItem {
  return typeof value === "object" && value !== null;
}

export function normalizeHardcoverResults(
  payload: HardcoverResponse,
): MediaSearchResult[] {
  const results = payload.data?.search?.results;
  if (!Array.isArray(results)) {
    return [];
  }

  return results.filter(isHardcoverSearchItem).flatMap((item) => {
    if (
      (typeof item.id !== "string" && typeof item.id !== "number") ||
      !item.title
    ) {
      return [];
    }
    const imageUrl =
      typeof item.image === "string"
        ? item.image
        : item.image?.url || item.image_url;
    const details = [
      item.release_year ? String(item.release_year) : undefined,
      item.pages ? `${item.pages} pages` : undefined,
    ].filter(Boolean);

    return [
      {
        id: String(item.id),
        title: item.title,
        subtitle: item.author_names?.join(", ") || item.subtitle,
        imageUrl,
        metadata: details.join(" · ") || undefined,
      },
    ];
  });
}

export async function searchHardcoverBooks(
  query: string,
  token: string,
): Promise<MediaSearchResult[]> {
  const response = await fetch(HARDCOVER_API_URL, {
    method: "POST",
    headers: {
      authorization: token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `query SearchBooks($query: String!) {
        search(query: $query, query_type: "Book", per_page: 20, page: 1) {
          results
        }
      }`,
      variables: { query },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Hardcover request failed (${response.status})`);
  }

  const payload = (await response.json()) as HardcoverResponse;
  if (payload.errors?.length) {
    throw new Error("Hardcover returned an error");
  }
  return normalizeHardcoverResults(payload);
}
