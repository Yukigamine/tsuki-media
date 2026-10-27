export function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

export function anilistFuzzyDate(
  value: { year?: unknown; month?: unknown; day?: unknown } | undefined,
): string | null {
  if (typeof value?.year !== "number") return null;
  const month = typeof value.month === "number" ? value.month : 1;
  const day = typeof value.day === "number" ? value.day : 1;
  return new Date(Date.UTC(value.year, month - 1, day)).toISOString();
}
