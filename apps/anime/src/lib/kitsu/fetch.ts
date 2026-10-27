export interface KitsuFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function isLikelyCloudflareChallenge(result: KitsuFetchResponse): boolean {
  const lowerHeaders = Object.fromEntries(
    Object.entries(result.headers).map(([key, value]) => [
      key.toLowerCase(),
      value.toLowerCase(),
    ]),
  );

  const body = result.body.toLowerCase();

  if (lowerHeaders["cf-mitigated"] === "challenge") {
    return true;
  }

  if (
    (result.status === 403 || result.status === 503) &&
    (body.includes("cloudflare") ||
      body.includes("attention required") ||
      body.includes("cdn-cgi/challenge-platform") ||
      body.includes("cf-browser-verification"))
  ) {
    return true;
  }

  return false;
}

export async function kitsuFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<KitsuFetchResponse> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    cache: "no-store",
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    headers,
    body: await response.text(),
  };
}

export function assertNoCloudflareChallenge(result: KitsuFetchResponse): void {
  if (!isLikelyCloudflareChallenge(result)) return;

  const preview = result.body.slice(0, 240).replace(/\s+/g, " ").trim();
  throw new Error(
    `Kitsu request blocked by Cloudflare challenge${preview ? `: ${preview}` : ""}`,
  );
}
