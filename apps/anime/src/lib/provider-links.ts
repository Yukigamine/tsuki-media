import "server-only";
import type { Provider } from "@/generated/prisma/client";
import prisma from "./prisma";

const LINK_PROVIDER_IDS: Record<Provider, string> = {
  KITSU: "kitsu-link",
  ANILIST: "anilist-link",
};

interface TokenInfo {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  username?: string | null;
  providerUserId?: string | null;
  avatarUrl?: string | null;
}

async function resolveLinkedUserId(userId?: string): Promise<string> {
  if (userId) return userId;

  const users = await prisma.user.findMany({
    select: { id: true },
    take: 2,
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) {
    throw new Error("No user found for linked provider token operations");
  }

  if (users.length > 1) {
    throw new Error(
      "Multiple users detected; linked provider token operations require explicit user context",
    );
  }

  return users[0].id;
}

export async function saveToken(
  provider: Provider,
  info: TokenInfo,
  options?: { userId?: string },
): Promise<void> {
  const userId = await resolveLinkedUserId(options?.userId);
  const providerId = LINK_PROVIDER_IDS[provider];
  const now = new Date();

  const existing = await prisma.account.findFirst({
    where: { userId, providerId },
    select: { id: true },
  });

  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: {
        accountId:
          info.username ?? info.providerUserId ?? provider.toLowerCase(),
        accessToken: info.accessToken,
        refreshToken: info.refreshToken,
        accessTokenExpiresAt: info.expiresAt,
        idToken: info.avatarUrl,
      },
    });
    return;
  }

  await prisma.account.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      providerId,
      accountId: info.username ?? info.providerUserId ?? provider.toLowerCase(),
      accessToken: info.accessToken,
      refreshToken: info.refreshToken ?? null,
      accessTokenExpiresAt: info.expiresAt ?? null,
      refreshTokenExpiresAt: null,
      idToken: info.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export async function getToken(
  provider: Provider,
  options?: { userId?: string },
): Promise<TokenInfo | null> {
  const userId = await resolveLinkedUserId(options?.userId);
  const providerId = LINK_PROVIDER_IDS[provider];
  const record = await prisma.account.findFirst({
    where: { userId, providerId },
    orderBy: { updatedAt: "desc" },
  });
  if (!record?.accessToken) return null;

  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken ?? null,
    expiresAt: record.accessTokenExpiresAt ?? null,
    username: record.accountId,
    providerUserId: record.accountId,
    avatarUrl: record.idToken,
  };
}

export async function deleteToken(
  provider: Provider,
  options?: { userId?: string },
): Promise<void> {
  const userId = await resolveLinkedUserId(options?.userId);
  const providerId = LINK_PROVIDER_IDS[provider];

  await prisma.account.deleteMany({
    where: { userId, providerId },
  });
}

export async function getAuthStatus(
  userId?: string,
): Promise<Record<Provider, { loggedIn: boolean; username: string | null }>> {
  const linkedUserId = await resolveLinkedUserId(userId);
  const [kitsu, anilist] = await Promise.all([
    prisma.account.findFirst({
      where: { userId: linkedUserId, providerId: LINK_PROVIDER_IDS.KITSU },
      orderBy: { updatedAt: "desc" },
      select: { accountId: true },
    }),
    prisma.account.findFirst({
      where: { userId: linkedUserId, providerId: LINK_PROVIDER_IDS.ANILIST },
      orderBy: { updatedAt: "desc" },
      select: { accountId: true },
    }),
  ]);

  return {
    KITSU: { loggedIn: !!kitsu, username: kitsu?.accountId ?? null },
    ANILIST: { loggedIn: !!anilist, username: anilist?.accountId ?? null },
  };
}
