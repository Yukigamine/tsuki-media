import "server-only";
import { saveToken } from "@/lib/provider-links";

type PersistKitsuTokenInput = {
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn: number;
  fallbackUsername?: string | null;
};

export async function persistKitsuToken({
  userId,
  accessToken,
  refreshToken,
  expiresIn,
  fallbackUsername,
}: PersistKitsuTokenInput): Promise<{ username: string | null }> {
  const profile = await fetchKitsuProfile(accessToken);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const username = profile?.slug ?? fallbackUsername ?? null;

  await saveToken(
    "KITSU",
    {
      accessToken,
      refreshToken: refreshToken ?? null,
      expiresAt,
      providerUserId: profile?.id ?? null,
      username,
      avatarUrl: profile?.avatarUrl ?? null,
    },
    { userId },
  );

  return { username };
}

async function fetchKitsuProfile(
  accessToken: string,
): Promise<{ id: string; slug: string; avatarUrl: string | null } | null> {
  const endpoint =
    process.env.KITSU_API_URL ??
    process.env.NEXT_PUBLIC_KITSU_API_URL ??
    "https://kitsu.app/api/graphql";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: `query CurrentProfileForLinking {
          currentProfile {
            id
            slug
            avatarImage {
              original {
                url
              }
            }
          }
        }`,
      }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const body = (await res.json()) as {
      data?: {
        currentProfile?: {
          id?: string;
          slug?: string;
          avatarImage?: { original?: { url?: string | null } | null } | null;
        } | null;
      };
    };

    const profile = body.data?.currentProfile;
    if (!profile?.id || !profile.slug) return null;

    return {
      id: profile.id,
      slug: profile.slug,
      avatarUrl: profile.avatarImage?.original?.url ?? null,
    };
  } catch {
    return null;
  }
}
