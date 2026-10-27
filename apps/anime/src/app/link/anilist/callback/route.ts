import { NextResponse } from "next/server";
import { exchangeAniListCode } from "@/lib/anilist/auth";
import { getToken } from "@/lib/provider-links";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

// Allowlist of safe error messages to surface to the user.
const SAFE_ERRORS = new Set(["access_denied", "missing_code"]);

function safeError(raw: string): string {
  if (SAFE_ERRORS.has(raw)) return raw;
  // Don't leak internal details; log server-side instead
  return "authentication_failed";
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(
      new URL("/login?error=unauthorized", request.url),
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/link?error=${encodeURIComponent(safeError(error))}`,
        request.url,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/link?error=missing_code", request.url),
    );
  }

  try {
    await exchangeAniListCode(code, { userId: session.user.id });

    const { anilistUsername: requiredUsername } = await getSettings();
    if (requiredUsername) {
      const stored = await getToken("ANILIST", { userId: session.user.id });
      if (
        stored?.username &&
        stored.username.toLowerCase() !== requiredUsername.toLowerCase()
      ) {
        console.warn(
          `[anilist/callback] Expected "${requiredUsername}" but got "${stored.username}"`,
        );
        return NextResponse.redirect(
          new URL(
            `/link?error=${encodeURIComponent("wrong_account")}`,
            request.url,
          ),
        );
      }
    }

    const response = NextResponse.redirect(new URL("/link", request.url));
    response.cookies.set("link_success", "anilist", {
      path: "/",
      maxAge: 60,
      sameSite: "lax",
    });
    return response;
  } catch (err) {
    console.error("[anilist/callback] token exchange error:", err);
    return NextResponse.redirect(
      new URL("/link?error=authentication_failed", request.url),
    );
  }
}
