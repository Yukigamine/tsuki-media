import "server-only";
import { getLibrarySnapshot, type LibrarySnapshot } from "@/lib/library";
export type AnimeWithEntry = Omit<
  LibrarySnapshot["anime"][number],
  "collectionItems"
>;
export type MangaWithEntry = Omit<
  LibrarySnapshot["manga"][number],
  "collectionItems"
>;
export type AnimeListSnapshot = {
  items: AnimeWithEntry[];
  counts: Record<string, number>;
};
export type MangaListSnapshot = {
  items: MangaWithEntry[];
  counts: Record<string, number>;
};
export async function getAnimeListSnapshot(): Promise<AnimeListSnapshot> {
  const items = (await getLibrarySnapshot()).anime
    .filter((item) => item.listEntry)
    .map(({ collectionItems: _collectionItems, ...item }) => item);
  const counts: Record<string, number> = { ALL: items.length };
  for (const item of items) {
    if (!item.listEntry) continue;
    const status = item.listEntry.watchStatus;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return { items, counts };
}
export async function getMangaListSnapshot(): Promise<MangaListSnapshot> {
  const items = (await getLibrarySnapshot()).manga
    .filter((item) => item.listEntry)
    .map(({ collectionItems: _collectionItems, ...item }) => item);
  const counts: Record<string, number> = { ALL: items.length };
  for (const item of items) {
    if (!item.listEntry) continue;
    const status = item.listEntry.readStatus;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return { items, counts };
}
