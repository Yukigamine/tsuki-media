"use client";

import useSWR from "swr";
import { kitsuBrowserClient } from "@/lib/kitsu/browser-client";
import type {
  KitsuFavoriteItem,
  KitsuUserProfile,
} from "@/lib/kitsu/user-types";

async function fetchKitsuProfile(
  slug: string,
): Promise<KitsuUserProfile | null> {
  const result = await kitsuBrowserClient("query")({
    findProfileBySlug: [
      { slug },
      {
        about: true,
        avatarImage: { original: { url: true } },
        bannerImage: { original: { url: true } },
        birthday: true,
        createdAt: true,
        id: true,
        location: true,
        gender: true,
        name: true,
        slug: true,
        favorites: [
          { first: 100 },
          {
            nodes: {
              id: true,
              item: {
                __typename: true,
                "...on Anime": {
                  id: true,
                  slug: true,
                  posterImage: { original: { url: true } },
                  titles: { canonical: true },
                },
                "...on Manga": {
                  id: true,
                  slug: true,
                  posterImage: { original: { url: true } },
                  titles: { canonical: true },
                },
                "...on Character": {
                  id: true,
                  slug: true,
                  image: { original: { url: true } },
                  names: { canonical: true },
                },
                "...on Person": {
                  id: true,
                  slug: true,
                  image: { original: { url: true } },
                  names: { canonical: true },
                },
              },
            },
          },
        ],
        stats: {
          animeAmountConsumed: { completed: true, time: true, units: true },
          mangaAmountConsumed: { completed: true, units: true },
        },
        waifu: {
          id: true,
          slug: true,
          image: { original: { url: true } },
          names: { canonical: true },
        },
        waifuOrHusbando: true,
      },
    ],
  });

  const base = result.findProfileBySlug;
  if (!base) return null;

  const favorites: KitsuUserProfile["favorites"] = {
    anime: [],
    manga: [],
    character: [],
    person: [],
  };

  for (const node of base.favorites?.nodes ?? []) {
    if (!node?.item) continue;

    const item = node.item;
    const typeName = item.__typename?.toLowerCase();
    if (!["anime", "manga", "character", "person"].includes(typeName ?? ""))
      continue;

    const type = typeName as KitsuFavoriteItem["type"];

    let name = "Unknown";
    let imageUrl: string | null = null;

    if (item.__typename === "Anime" || item.__typename === "Manga") {
      name = item.titles?.canonical ?? "Unknown";
      imageUrl = item.posterImage?.original?.url ?? null;
    } else if (
      item.__typename === "Character" ||
      item.__typename === "Person"
    ) {
      name = item.names?.canonical ?? "Unknown";
      imageUrl = item.image?.original?.url ?? null;
    }

    const id = String(node.id ?? "");
    const slug = String(item.slug ?? "");

    favorites[type].push({
      id,
      slug,
      name,
      imageUrl,
      type,
    });
  }

  const waifuBase = base.waifu;
  const waifu = waifuBase
    ? {
        slug: waifuBase.slug,
        name: waifuBase.names?.canonical ?? "Unknown",
        imageUrl: waifuBase.image?.original?.url ?? null,
        label: (base.waifuOrHusbando as string | null) ?? "Waifu",
      }
    : null;

  return {
    slug: base.slug ?? "",
    name: base.name ?? "",
    about: (base.about as string | null) || null,
    avatarUrl: base.avatarImage?.original?.url ?? null,
    bannerUrl: base.bannerImage?.original?.url ?? null,
    birthday: (base.birthday as string | null) ?? null,
    createdAt: String(base.createdAt ?? ""),
    gender: (base.gender as string | null) ?? null,
    location: (base.location as string | null) ?? null,
    waifu,
    stats: {
      animeTimeSecs: base.stats?.animeAmountConsumed?.time ?? null,
      animeCompleted: base.stats?.animeAmountConsumed?.completed ?? null,
      animeEpisodes: base.stats?.animeAmountConsumed?.units ?? null,
      mangaCompleted: base.stats?.mangaAmountConsumed?.completed ?? null,
      mangaChapters: base.stats?.mangaAmountConsumed?.units ?? null,
    },
    favorites,
  };
}

export function useKitsuProfile(slug: string) {
  return useSWR(
    slug ? ["kitsu-profile", slug] : null,
    ([, s]) => fetchKitsuProfile(s),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );
}
