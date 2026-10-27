export function normalizeListRatingToTen(
  dbRating: number | null | undefined,
): number | null {
  if (dbRating == null || Number.isNaN(dbRating)) return null;

  return Math.round((dbRating / 2) * 10) / 10;
}

export function formatHalfStepRatingOutOfTen(rating: number | null): string {
  if (rating == null) return "Unknown";
  const display = Number.isInteger(rating)
    ? rating.toFixed(0)
    : rating.toFixed(1);
  return `${display}/10`;
}
