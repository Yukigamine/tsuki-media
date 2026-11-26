import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session-edge";
import { isSetupComplete } from "@/lib/settings";

// Routes that require a valid session entirely (not even viewable)
const AUTH_ONLY_PREFIXES = [
  "/sync",
  "/api/sync",
  "/link",
  "/logout",
  "/settings",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const setupComplete = await isSetupComplete();
  if (!setupComplete) {
    if (pathname.startsWith("/welcome")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/welcome")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/login")) return NextResponse.next();

  const session = await getSessionFromRequest(request);

  // ─── Fully restricted pages ───────────────────────────────────────────────
  const isAuthOnly = AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
  if (isAuthOnly && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ─── Write-only restriction ───────────────────────────────────────────────
  // Add/edit pages require a session.
  const isAddOrEdit = pathname.endsWith("/add") || pathname.includes("/edit");

  const isMutatingMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method,
  );

  if ((isAddOrEdit || isMutatingMethod) && !session) {
    // For server actions (POST to a page URL), return 401
    if (isMutatingMethod) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|images/).*)",
  ],
};
