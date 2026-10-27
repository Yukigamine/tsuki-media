/**
 * Lightweight edge-compatible session check for middleware.
 * We manually verify the BetterAuth session cookie without importing
 * the full server auth instance (which uses Prisma – not edge-compatible).
 */
import type { NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "better-auth.session_token";

/**
 * Returns a truthy value when a session cookie is present.
 * For actual session data, use `auth.api.getSession()` in server components.
 */
export async function getSessionFromRequest(
  request: NextRequest,
): Promise<string | null> {
  const token =
    request.cookies.get(AUTH_COOKIE_NAME)?.value ??
    request.cookies.get("__Secure-better-auth.session_token")?.value ??
    null;

  return token ?? null;
}
