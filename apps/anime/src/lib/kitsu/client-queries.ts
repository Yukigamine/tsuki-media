"use client";

import { MappingExternalSiteEnum } from "@/lib/zeus/kitsu";
import { kitsuBrowserClient } from "./browser-client";

export type KitsuClientSearchResult = {
  kitsuId: string;
  rawId: string;
  titleTranslated: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJp: string | null;
  posterUrl: string | null;
};

export type KitsuAnimeResolvePayload = {
  kitsuId: string;
  anilistId: number | null;
  malId: number | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJp: string | null;
  episodeCount: number | null;
  averageRating: number | null;
  coverImageUrl: string | null;
  bannerImageUrl: string | null;
};

export type KitsuMangaResolvePayload = {
  kitsuId: string;
  anilistId: number | null;
  malId: number | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJp: string | null;
  chapterCount: number | null;
  volumeCount: number | null;
  averageRating: number | null;
  coverImageUrl: string | null;
};

export type KitsuAnimeSeriesDetail = {
  kitsuId: string;
  titleEn: string | null;
  titleRomaji: string | null;
  episodeCount: number | null;
  posterUrl: string | null;
  updatedAt: string;
};

export type KitsuMangaSeriesDetail = {
  kitsuId: string;
  titleEn: string | null;
  titleRomaji: string | null;
  totalChapters: number | null;
  totalVolumes: number | null;
  totalsFromKitsu: boolean;
  posterUrl: string | null;
  updatedAt: string;
};

type KitsuMediaType = "anime" | "manga";

export async function resolveKitsuIdByExternalIdsClient(
  mediaType: KitsuMediaType,
  input: { anilistId: number | null; malId: number | null },
): Promise<string | null> {
  const mappings = [
    input.anilistId == null
      ? null
      : {
          externalId: input.anilistId,
          externalSite:
            mediaType === "anime"
              ? MappingExternalSiteEnum.ANILIST_ANIME
              : MappingExternalSiteEnum.ANILIST_MANGA,
        },
    input.malId == null
      ? null
      : {
          externalId: input.malId,
          externalSite:
            mediaType === "anime"
              ? MappingExternalSiteEnum.MYANIMELIST_ANIME
              : MappingExternalSiteEnum.MYANIMELIST_MANGA,
        },
  ].filter(
    (
      mapping,
    ): mapping is {
      externalId: number;
      externalSite: MappingExternalSiteEnum;
    } => mapping !== null,
  );

  for (const mapping of mappings) {
    const result = await kitsuBrowserClient("query")({
      lookupMapping: [
        mapping,
        {
          __typename: true,
          "...on Anime": { id: true },
          "...on Manga": { id: true },
        },
      ],
    });
    const item = result.lookupMapping as
      | { __typename?: string; id?: string | number | null }
      | null
      | undefined;
    const expectedType = mediaType === "anime" ? "Anime" : "Manga";
    if (item?.__typename === expectedType && item.id != null) {
      return String(item.id);
    }
  }

  return null;
}

export async function resolveAniListIdByKitsuIdClient(
  mediaType: KitsuMediaType,
  kitsuId: string,
): Promise<number | null> {
  const payload =
    mediaType === "anime"
      ? await getAnimeResolvePayloadBySlug(kitsuId)
      : await getMangaResolvePayloadBySlug(kitsuId);
  return payload?.anilistId ?? null;
}

function mappingId(
  mappings:
    | Array<{
        externalId?: unknown;
        externalSite?: MappingExternalSiteEnum | null;
      } | null>
    | null
    | undefined,
  site: MappingExternalSiteEnum,
): number | null {
  return (
    mappings
      ?.filter((m) => m?.externalSite === site)
      .map((m) => Number(m?.externalId))
      .find(Boolean) ?? null
  );
}

export async function searchAnimeByTitleClient(
  query: string,
): Promise<KitsuClientSearchResult[]> {
  const result = await kitsuBrowserClient("query")({
    searchAnimeByTitle: [
      { title: query, first: 10 },
      {
        nodes: {
          id: true,
          slug: true,
          titles: {
            canonical: true,
            translated: true,
            romanized: true,
            original: true,
          },
          posterImage: { original: { url: true } },
        },
      },
    ],
  });

  return (result.searchAnimeByTitle?.nodes ?? [])
    .filter((n) => !!n?.id)
    .map((n) => ({
      kitsuId: String(n?.id),
      rawId: String(n?.id),
      titleTranslated: n?.titles?.translated ?? null,
      titleEn: n?.titles?.canonical ?? null,
      titleRomaji: n?.titles?.romanized ?? null,
      titleJp: n?.titles?.original ?? null,
      posterUrl: n?.posterImage?.original?.url ?? null,
    }));
}

export async function searchMangaByTitleClient(
  query: string,
): Promise<KitsuClientSearchResult[]> {
  const result = await kitsuBrowserClient("query")({
    searchMangaByTitle: [
      { title: query, first: 10 },
      {
        nodes: {
          id: true,
          slug: true,
          titles: {
            canonical: true,
            translated: true,
            romanized: true,
            original: true,
          },
          posterImage: { original: { url: true } },
        },
      },
    ],
  });

  return (result.searchMangaByTitle?.nodes ?? [])
    .filter((n) => !!n?.id)
    .map((n) => ({
      kitsuId: String(n?.id),
      rawId: String(n?.id),
      titleTranslated: n?.titles?.translated ?? null,
      titleEn: n?.titles?.canonical ?? null,
      titleRomaji: n?.titles?.romanized ?? null,
      titleJp: n?.titles?.original ?? null,
      posterUrl: n?.posterImage?.original?.url ?? null,
    }));
}

export async function getAnimeResolvePayloadBySlug(
  kitsuId: string,
): Promise<KitsuAnimeResolvePayload | null> {
  const result = await kitsuBrowserClient("query")({
    findAnimeById: [
      { id: kitsuId },
      {
        id: true,
        titles: { canonical: true, romanized: true, original: true },
        episodeCount: true,
        averageRating: true,
        posterImage: { original: { url: true } },
        bannerImage: { original: { url: true } },
        mappings: [
          { first: 10 },
          { nodes: { externalId: true, externalSite: true } },
        ],
      },
    ],
  });

  const anime = result.findAnimeById;
  if (!anime) return null;

  const mappings = anime.mappings?.nodes ?? [];
  return {
    kitsuId,
    anilistId: mappingId(mappings, MappingExternalSiteEnum.ANILIST_ANIME),
    malId: mappingId(mappings, MappingExternalSiteEnum.MYANIMELIST_ANIME),
    titleEn: anime.titles?.canonical ?? null,
    titleRomaji: anime.titles?.romanized ?? null,
    titleJp: anime.titles?.original ?? null,
    episodeCount: anime.episodeCount ?? null,
    averageRating: anime.averageRating ?? null,
    coverImageUrl: anime.posterImage?.original?.url ?? null,
    bannerImageUrl: anime.bannerImage?.original?.url ?? null,
  };
}

export async function getMangaResolvePayloadBySlug(
  kitsuId: string,
): Promise<KitsuMangaResolvePayload | null> {
  const result = await kitsuBrowserClient("query")({
    findMangaById: [
      { id: kitsuId },
      {
        id: true,
        titles: { canonical: true, romanized: true, original: true },
        chapterCount: true,
        chapterCountGuess: true,
        volumeCount: true,
        averageRating: true,
        posterImage: { original: { url: true } },
        mappings: [
          { first: 10 },
          { nodes: { externalId: true, externalSite: true } },
        ],
      },
    ],
  });

  const manga = result.findMangaById;
  if (!manga) return null;

  const mappings = manga.mappings?.nodes ?? [];
  return {
    kitsuId,
    anilistId: mappingId(mappings, MappingExternalSiteEnum.ANILIST_MANGA),
    malId: mappingId(mappings, MappingExternalSiteEnum.MYANIMELIST_MANGA),
    titleEn: manga.titles?.canonical ?? null,
    titleRomaji: manga.titles?.romanized ?? null,
    titleJp: manga.titles?.original ?? null,
    chapterCount: manga.chapterCount ?? manga.chapterCountGuess ?? null,
    volumeCount: manga.volumeCount ?? null,
    averageRating: manga.averageRating ?? null,
    coverImageUrl: manga.posterImage?.original?.url ?? null,
  };
}

export async function getAnimeSeriesDetailBySlug(
  kitsuId: string,
): Promise<KitsuAnimeSeriesDetail | null> {
  const result = await kitsuBrowserClient("query")({
    findAnimeBySlug: [
      { slug: kitsuId },
      {
        id: true,
        titles: { canonical: true, romanized: true },
        episodeCount: true,
        updatedAt: true,
        posterImage: { original: { url: true } },
      },
    ],
  });

  const anime = result.findAnimeBySlug;
  if (!anime) return null;

  return {
    kitsuId,
    titleEn: anime.titles?.canonical ?? null,
    titleRomaji: anime.titles?.romanized ?? null,
    episodeCount: anime.episodeCount ?? null,
    posterUrl: anime.posterImage?.original?.url ?? null,
    updatedAt: String(anime.updatedAt),
  };
}

export async function getMangaSeriesDetailBySlug(
  kitsuId: string,
): Promise<KitsuMangaSeriesDetail | null> {
  const result = await kitsuBrowserClient("query")({
    findMangaById: [
      { id: kitsuId },
      {
        id: true,
        titles: { canonical: true, romanized: true },
        chapterCount: true,
        chapterCountGuess: true,
        volumeCount: true,
        updatedAt: true,
        posterImage: { original: { url: true } },
      },
    ],
  });

  const manga = result.findMangaById;
  if (!manga) return null;

  const totalChapters = manga.chapterCount ?? manga.chapterCountGuess ?? null;
  const totalVolumes = manga.volumeCount ?? null;

  return {
    kitsuId,
    titleEn: manga.titles?.canonical ?? null,
    titleRomaji: manga.titles?.romanized ?? null,
    totalChapters,
    totalVolumes,
    totalsFromKitsu: totalChapters !== null || totalVolumes !== null,
    posterUrl: manga.posterImage?.original?.url ?? null,
    updatedAt: String(manga.updatedAt),
  };
}
