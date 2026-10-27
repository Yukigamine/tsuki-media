import "server-only";
import { getSettings } from "@/lib/settings";

export type MediaType = "anime" | "manga";
export type LibraryType = "list" | "collection";

export async function getLibraryPageTitle(
  mediaType: MediaType,
  libraryType: LibraryType,
): Promise<string> {
  const { displayName } = await getSettings();
  const mediaLabel = mediaType === "anime" ? "Anime" : "Manga";
  const libraryLabel = libraryType === "list" ? "List" : "Collection";
  const title = `${mediaLabel} ${libraryLabel}`;

  return displayName ? `${displayName}'s ${title}` : title;
}
