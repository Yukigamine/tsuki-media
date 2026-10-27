function isValidId(id: number | null | undefined): boolean {
  return id == null || (typeof id === "number" && id > 0);
}

function isValidScore(score: number | null | undefined): boolean {
  return (
    score == null || (typeof score === "number" && score >= 0 && score <= 20)
  );
}

function isValidProgress(p: number | null | undefined): boolean {
  return p == null || (typeof p === "number" && p >= 0 && Number.isInteger(p));
}

export function validateAnimeListEntry(entry: {
  progress?: number;
  rating?: number | null;
  rewatchCount?: number;
}): string[] {
  const issues: string[] = [];
  if (!isValidProgress(entry.progress)) issues.push("invalid progress");
  if (!isValidScore(entry.rating)) issues.push("invalid rating");
  if (entry.rewatchCount != null && !isValidProgress(entry.rewatchCount))
    issues.push("invalid rewatch count");
  return issues;
}

export function validateMangaListEntry(entry: {
  progress?: number;
  progressVolumes?: number;
  rating?: number | null;
  rereadCount?: number;
}): string[] {
  const issues: string[] = [];
  if (!isValidProgress(entry.progress)) issues.push("invalid progress");
  if (!isValidProgress(entry.progressVolumes))
    issues.push("invalid progress volumes");
  if (!isValidScore(entry.rating)) issues.push("invalid rating");
  if (entry.rereadCount != null && !isValidProgress(entry.rereadCount))
    issues.push("invalid reread count");
  return issues;
}

export function validateMediaRecord(media: {
  anilistId?: number | null;
  malId?: number | null;
  titleEn?: string | null;
}): string[] {
  const issues: string[] = [];
  if (!isValidId(media.anilistId)) issues.push("invalid anilistId");
  if (!isValidId(media.malId)) issues.push("invalid malId");
  if (!media.titleEn) issues.push("missing title");
  return issues;
}

export function selectTitleFromAniList(
  english: string | null | undefined,
  romaji: string | null | undefined,
  native: string | null | undefined,
): { title: string | null; fallbackUsed: string | null } {
  if (english) return { title: english, fallbackUsed: null };
  if (romaji) return { title: romaji, fallbackUsed: "romaji" };
  if (native) return { title: native, fallbackUsed: "native" };
  return { title: null, fallbackUsed: "missing_all" };
}
