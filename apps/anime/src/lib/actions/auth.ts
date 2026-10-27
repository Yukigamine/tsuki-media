"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { persistKitsuToken } from "@/lib/kitsu/auth";
import { deleteToken, getToken } from "@/lib/provider-links";
import { getSession, requireSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import type { ActionResult, SyncProvider } from "./types";

type SaveKitsuTokenInput = {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn: number;
  fallbackUsername?: string | null;
};

export async function saveKitsuTokenAction(
  input: SaveKitsuTokenInput,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!input.accessToken || !Number.isFinite(input.expiresIn)) {
    return { ok: false, error: "Invalid token payload" };
  }

  const { kitsuUsername: requiredUsername } = await getSettings();

  try {
    const { username } = await persistKitsuToken({
      ...input,
      userId: session.user.id,
    });

    if (
      requiredUsername &&
      username &&
      username.toLowerCase() !== requiredUsername.toLowerCase()
    ) {
      await deleteToken("KITSU", { userId: session.user.id });
      return {
        ok: false,
        error: `Authenticated as "${username}" but this app requires "${requiredUsername}".`,
      };
    }

    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function logoutProviderAction(
  provider: SyncProvider | "ALL",
  userId: string,
): Promise<ActionResult> {
  try {
    if (provider === "ALL") {
      await Promise.all([
        deleteToken("KITSU", { userId }),
        deleteToken("ANILIST", { userId }),
      ]);
    } else {
      await deleteToken(provider, { userId });
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getLinkedProviderAccessTokenAction(
  provider: SyncProvider,
): Promise<ActionResult<string>> {
  const session = await requireSession();

  try {
    const token = await getToken(provider, { userId: session.user.id });
    if (!token?.accessToken) {
      return { ok: false, error: `${provider} is not linked` };
    }

    return { ok: true, data: token.accessToken };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function logoutAndRedirectAction(provider: SyncProvider) {
  const session = await requireSession();
  await logoutProviderAction(provider, session.user.id);
  redirect("/link");
}

export async function logoutAppAction(): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (session) {
      await auth.api.signOut({ headers: await headers() });
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
