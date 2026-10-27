import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Returns the current session (or null) from server components / server actions.
 */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Throws if there is no session. Use in server actions that require auth.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}
