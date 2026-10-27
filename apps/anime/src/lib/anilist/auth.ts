import "server-only";
import { saveToken } from "@/lib/provider-links";

const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const ANILIST_AUTH_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_GRAPHQL =
  process.env.ANILIST_API_URL ?? "https://graphql.anilist.co";

export function buildAniListAuthUrl(): string {
  const clientId = process.env.ANILIST_CLIENT_ID ?? "";
  const redirectUri =
    process.env.ANILIST_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL}/link/anilist/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
  });

  return `${ANILIST_AUTH_URL}?${params.toString()}`;
}

export async function exchangeAniListCode(
  code: string,
  options?: { userId?: string },
): Promise<string> {
  const clientId = process.env.ANILIST_CLIENT_ID ?? "";
  const clientSecret = process.env.ANILIST_CLIENT_SECRET ?? "";
  const redirectUri =
    process.env.ANILIST_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL}/link/anilist/callback`;

  const res = await fetch(ANILIST_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      if (data.error_description) errorMsg = data.error_description;
      else if (data.error) errorMsg = data.error;
    } catch {
      // Fallback if response isn't JSON
    }
    throw new Error(`AniList token exchange failed: ${errorMsg}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  const viewerRes = await fetch(ANILIST_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.access_token}`,
    },
    body: JSON.stringify({ query: "{ Viewer { id name avatar { large } } }" }),
  });

  let viewer: {
    data: {
      Viewer: { id: number; name: string; avatar?: { large?: string } };
    };
  } | null = null;
  if (viewerRes.ok) {
    try {
      viewer = (await viewerRes.json()) as {
        data: {
          Viewer: { id: number; name: string; avatar?: { large?: string } };
        };
      };
    } catch {
      console.error("Failed to parse AniList viewer response");
    }
  } else {
    console.error(`AniList viewer query failed: ${viewerRes.status}`);
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await saveToken(
    "ANILIST",
    {
      accessToken: data.access_token,
      refreshToken: null,
      expiresAt,
      providerUserId: viewer?.data?.Viewer?.id?.toString() ?? null,
      username: viewer?.data?.Viewer?.name ?? null,
      avatarUrl: viewer?.data?.Viewer?.avatar?.large ?? null,
    },
    { userId: options?.userId },
  );

  return data.access_token;
}
