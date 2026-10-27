import type { Anime, Manga } from "@/generated/prisma/client";

function preferredTitle(input: {
  titleEn?: string | null;
  titleRomaji?: string | null;
  titleJp?: string | null;
}): string {
  return (
    input.titleEn?.trim() ||
    input.titleRomaji?.trim() ||
    input.titleJp?.trim() ||
    "untitled"
  );
}

export function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return normalized || "untitled";
}

export function getAnimeDetailPath(
  anime: Pick<Anime, "kitsuId" | "id" | "titleEn" | "titleRomaji" | "titleJp">,
): string {
  const kitsuId = anime.kitsuId ?? anime.id;
  const slug = slugifyTitle(preferredTitle(anime));
  return `/anime/${slug}/${kitsuId}`;
}

export function getMangaDetailPath(
  manga: Pick<Manga, "kitsuId" | "id" | "titleEn" | "titleRomaji" | "titleJp">,
): string {
  const kitsuId = manga.kitsuId ?? manga.id;
  const slug = slugifyTitle(preferredTitle(manga));
  return `/manga/${slug}/${kitsuId}`;
}
