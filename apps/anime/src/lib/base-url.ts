function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "http://localhost:3000";
  }

  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

/**
 * Production-aware base URL resolution for server-side auth logic.
 * Matches the Vercel-first strategy used in nostalgia-safety.
 */
export function getServerBaseUrl(): string {
  if (process.env.VERCEL_ENV === "preview") {
    const previewUrl = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    if (previewUrl) return normalizeBaseUrl(previewUrl);
  }

  if (process.env.NEXT_PUBLIC_CUSTOM_DOMAIN) {
    return normalizeBaseUrl(process.env.NEXT_PUBLIC_CUSTOM_DOMAIN);
  }

  if (process.env.BETTER_AUTH_URL) {
    return normalizeBaseUrl(process.env.BETTER_AUTH_URL);
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  }

  if (process.env.VERCEL_BRANCH_URL) {
    return normalizeBaseUrl(process.env.VERCEL_BRANCH_URL);
  }

  if (process.env.VERCEL_URL) {
    return normalizeBaseUrl(process.env.VERCEL_URL);
  }

  return "http://localhost:3000";
}

/** Stable origin registered with OAuth providers. */
export function getProductionBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.BETTER_AUTH_PRODUCTION_URL || "https://anime.yukigamine.net",
  );
}

/** Browser-safe base URL resolution for Better Auth client calls. */
export function getClientBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeBaseUrl(window.location.origin);
  }

  if (process.env.NEXT_PUBLIC_CUSTOM_DOMAIN) {
    return normalizeBaseUrl(process.env.NEXT_PUBLIC_CUSTOM_DOMAIN);
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  }

  return "http://localhost:3000";
}
