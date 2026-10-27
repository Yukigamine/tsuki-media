import "server-only";
import type { MediaDetailSnapshot } from "@/lib/media-detail-types";
import { getCached, setCached, TITLE_TTL } from "@/lib/redis";

type ProviderResult = { missing: true } | { detail: MediaDetailSnapshot };
type KitsuAttributes = {
  titles?: { en?: string; en_jp?: string; ja_jp?: string };
  canonicalTitle?: string;
  synopsis?: string;
  posterImage?: { large?: string; original?: string };
  coverImage?: { large?: string; original?: string };
  episodeCount?: number;
  chapterCount?: number;
  volumeCount?: number;
  status?: string;
  averageRating?: string;
  startDate?: string;
  endDate?: string;
};

export async function getProviderSnapshot(
  kind: "anime" | "manga",
  identifier: string,
): Promise<MediaDetailSnapshot | null> {
  if (!/^[1-9]\d{0,9}$/.test(identifier)) return null;
  const key = `provider:metadata:v1:${kind}:${identifier}`;
  const cached = await getCached<ProviderResult>(key);
  if (cached) return "missing" in cached ? null : cached.detail;
  const response = await fetch(
    `https://kitsu.app/api/edge/${kind}/${identifier}`,
    {
      headers: { Accept: "application/vnd.api+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) {
    await setCached(key, { missing: true }, 300);
    return null;
  }
  if (!response.ok)
    throw new Error(`Kitsu metadata unavailable (${response.status})`);
  const body = (await response.json()) as {
    data?: { id: string; attributes: KitsuAttributes };
  };
  if (!body.data?.attributes)
    throw new Error("Invalid Kitsu metadata response");
  const a = body.data.attributes;
  const rating = a.averageRating == null ? null : Number(a.averageRating);
  const detail: MediaDetailSnapshot = {
    id: `kitsu:${kind}:${identifier}`,
    kitsuId: identifier,
    anilistId: null,
    titleEn: a.titles?.en ?? a.canonicalTitle ?? null,
    titleRomaji: a.titles?.en_jp ?? null,
    titleJp: a.titles?.ja_jp ?? null,
    synopsis: a.synopsis ?? null,
    coverImageUrl: a.posterImage?.large ?? a.posterImage?.original ?? null,
    bannerImageUrl: a.coverImage?.large ?? a.coverImage?.original ?? null,
    episodeCount: a.episodeCount ?? null,
    chapterCount: a.chapterCount ?? null,
    volumeCount: a.volumeCount ?? null,
    showStatus:
      (
        {
          current: "AIRING",
          finished: "FINISHED",
          upcoming: "UPCOMING",
          unreleased: "UPCOMING",
        } as Record<string, string>
      )[a.status ?? ""] ?? "UNKNOWN",
    averageRating: rating !== null && Number.isFinite(rating) ? rating : null,
    startDate: a.startDate ?? null,
    endDate: a.endDate ?? null,
  };
  await setCached(key, { detail }, TITLE_TTL);
  return detail;
}
