import "server-only";
import type { Anime, Manga } from "@/generated/prisma/client";
import { getLibrarySnapshot } from "@/lib/library";
import type { MediaDetailSnapshot } from "@/lib/media-detail-types";
import { getProviderSnapshot } from "@/lib/provider-metadata";

function toAnimeSnapshot(anime: Anime): MediaDetailSnapshot {
  return {
    id: anime.id,
    kitsuId: anime.kitsuId,
    anilistId: anime.anilistId,
    titleEn: anime.titleEn,
    titleJp: anime.titleJp,
    titleRomaji: anime.titleRomaji,
    synopsis: anime.synopsis,
    coverImageUrl: anime.coverImageUrl,
    bannerImageUrl: anime.bannerImageUrl,
    episodeCount: anime.episodeCount,
    chapterCount: null,
    volumeCount: null,
    showStatus: anime.showStatus,
    averageRating: anime.averageRating,
    startDate: anime.startDate?.toISOString() ?? null,
    endDate: anime.endDate?.toISOString() ?? null,
  };
}

function toMangaSnapshot(manga: Manga): MediaDetailSnapshot {
  return {
    id: manga.id,
    kitsuId: manga.kitsuId,
    anilistId: manga.anilistId,
    titleEn: manga.titleEn,
    titleJp: manga.titleJp,
    titleRomaji: manga.titleRomaji,
    synopsis: manga.synopsis,
    coverImageUrl: manga.coverImageUrl,
    bannerImageUrl: null,
    episodeCount: null,
    chapterCount: manga.chapterCount,
    volumeCount: manga.volumeCount,
    showStatus: manga.showStatus,
    averageRating: manga.averageRating,
    startDate: manga.startDate?.toISOString() ?? null,
    endDate: manga.endDate?.toISOString() ?? null,
  };
}

export async function getAnimeDetailSnapshot(
  identifier: string,
): Promise<MediaDetailSnapshot | null> {
  if (!/^(?:[1-9]\d{0,9}|c[a-z0-9]{24})$/.test(identifier)) return null;
  const anime = (await getLibrarySnapshot()).anime.find(
    (item) => item.id === identifier || item.kitsuId === identifier,
  );
  if (!anime) return getProviderSnapshot("anime", identifier);

  const snapshot = toAnimeSnapshot(anime);

  return snapshot;
}

export async function getMangaDetailSnapshot(
  identifier: string,
): Promise<MediaDetailSnapshot | null> {
  if (!/^(?:[1-9]\d{0,9}|c[a-z0-9]{24})$/.test(identifier)) return null;
  const manga = (await getLibrarySnapshot()).manga.find(
    (item) => item.id === identifier || item.kitsuId === identifier,
  );
  if (!manga) return getProviderSnapshot("manga", identifier);

  const snapshot = toMangaSnapshot(manga);

  return snapshot;
}
