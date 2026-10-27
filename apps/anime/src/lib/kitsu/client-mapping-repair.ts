"use client";

import {
  getKitsuPushSnapshotAction,
  persistAniListMappingsAction,
  persistKitsuMappingsAction,
} from "@/lib/actions/kitsu-sync";
import {
  resolveAniListIdByKitsuIdClient,
  resolveKitsuIdByExternalIdsClient,
} from "./client-queries";

export type KitsuMappingRepairResult = {
  repairedAnime: number;
  repairedManga: number;
  repairedAniListAnime: number;
  repairedAniListManga: number;
  unresolved: string[];
  unavailableAniListMappings: string[];
};

export async function repairMissingKitsuMappings(): Promise<KitsuMappingRepairResult> {
  const snapshot = await getKitsuPushSnapshotAction();
  if (!snapshot.ok || !snapshot.data) {
    throw new Error(snapshot.error ?? "Unable to load local media mappings");
  }

  const unresolved: string[] = [];
  const unavailableAniListMappings: string[] = [];
  const anime = [] as Array<{ id: string; kitsuId: string }>;
  const manga = [] as Array<{ id: string; kitsuId: string }>;
  const animeAniList = [] as Array<{ id: string; anilistId: number }>;
  const mangaAniList = [] as Array<{ id: string; anilistId: number }>;

  for (const entry of snapshot.data.anime) {
    if (entry.anime.kitsuId) continue;
    const kitsuId = await resolveKitsuIdByExternalIdsClient("anime", {
      anilistId: entry.anime.anilistId,
      malId: entry.anime.malId,
    });
    if (kitsuId) anime.push({ id: entry.anime.id, kitsuId });
    else unresolved.push(`anime "${entry.anime.titleEn ?? entry.anime.id}"`);
  }

  for (const entry of snapshot.data.manga) {
    if (entry.manga.kitsuId) continue;
    const kitsuId = await resolveKitsuIdByExternalIdsClient("manga", {
      anilistId: entry.manga.anilistId,
      malId: entry.manga.malId,
    });
    if (kitsuId) manga.push({ id: entry.manga.id, kitsuId });
    else unresolved.push(`manga "${entry.manga.titleEn ?? entry.manga.id}"`);
  }

  const repairedKitsuIds = new Map<string, string>([
    ...anime.map((mapping): [string, string] => [mapping.id, mapping.kitsuId]),
    ...manga.map((mapping): [string, string] => [mapping.id, mapping.kitsuId]),
  ]);
  for (const entry of snapshot.data.anime) {
    if (entry.anime.anilistId) continue;
    const kitsuId = entry.anime.kitsuId ?? repairedKitsuIds.get(entry.anime.id);
    if (!kitsuId) continue;
    const anilistId = await resolveAniListIdByKitsuIdClient("anime", kitsuId);
    if (anilistId) animeAniList.push({ id: entry.anime.id, anilistId });
    else
      unavailableAniListMappings.push(
        `anime "${entry.anime.titleEn ?? entry.anime.id}" missing an AniList mapping`,
      );
  }

  for (const entry of snapshot.data.manga) {
    if (entry.manga.anilistId) continue;
    const kitsuId = entry.manga.kitsuId ?? repairedKitsuIds.get(entry.manga.id);
    if (!kitsuId) continue;
    const anilistId = await resolveAniListIdByKitsuIdClient("manga", kitsuId);
    if (anilistId) mangaAniList.push({ id: entry.manga.id, anilistId });
    else
      unavailableAniListMappings.push(
        `manga "${entry.manga.titleEn ?? entry.manga.id}" missing an AniList mapping`,
      );
  }

  const [kitsuPersisted, anilistPersisted] = await Promise.all([
    anime.length > 0 || manga.length > 0
      ? persistKitsuMappingsAction({ anime, manga })
      : Promise.resolve({
          ok: true as const,
          data: { anime: 0, manga: 0, errors: [] as string[] },
        }),
    animeAniList.length > 0 || mangaAniList.length > 0
      ? persistAniListMappingsAction({
          anime: animeAniList,
          manga: mangaAniList,
        })
      : Promise.resolve({
          ok: true as const,
          data: { anime: 0, manga: 0, errors: [] as string[] },
        }),
  ]);
  if (!kitsuPersisted.ok) throw new Error(kitsuPersisted.error);
  if (!anilistPersisted.ok) throw new Error(anilistPersisted.error);

  return {
    repairedAnime: kitsuPersisted.data.anime,
    repairedManga: kitsuPersisted.data.manga,
    repairedAniListAnime: anilistPersisted.data.anime,
    repairedAniListManga: anilistPersisted.data.manga,
    unavailableAniListMappings,
    unresolved: [
      ...unresolved,
      ...kitsuPersisted.data.errors,
      ...anilistPersisted.data.errors,
    ],
  };
}
