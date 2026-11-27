// @vitest-environment node
// These tests intentionally use the installed Better Auth runtime, not a mock of
// its API. Each instance has an isolated in-memory store and fake provider URLs.
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { afterEach, describe, expect, it, vi } from "vitest";

const production = "https://production.example.test";
const preview = "https://preview.example.test";
const secret = "isolated-runtime-test-secret-000000000000000000";
function instance(origin: string) {
  return betterAuth({
    secret,
    // Better Auth relaxes origin checks in NODE_ENV=test; keep production checks on.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    baseURL: origin,
    trustedOrigins: [production, preview],
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "oauth",
            clientId: "test-client",
            clientSecret: "test-client-secret",
            authorizationUrl: "https://provider.example.invalid/authorize",
            tokenUrl: "https://provider.example.invalid/token",
            userInfoUrl: "https://provider.example.invalid/userinfo",
            scopes: ["email", "profile"],
          },
        ],
      }),
      oAuthProxy({ productionURL: production }),
    ],
  });
}
const startRequest = (origin: string, callbackURL = "/") =>
  new Request(`${origin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ provider: "oauth", callbackURL }),
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Better Auth dependency compatibility", () => {
  it("keeps the actual app client on the supported custom social endpoint", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("NEXT_PUBLIC_CUSTOM_DOMAIN", "https://preview.example.test");
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          redirect: false,
          url: "https://provider.example.invalid/authorize",
        });
      }),
    );
    const { authClient } = await import("../betterauth-client");
    const result = await authClient.signIn.social({
      provider: "oauth",
      callbackURL: "/",
      disableRedirect: true,
    });
    expect(result.error).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      "https://preview.example.test/api/auth/sign-in/social",
    );
    expect(await requests[0].json()).toMatchObject({
      provider: "oauth",
      callbackURL: "/",
    });
  });
  it("supports the social custom-provider API, production callback and PKCE", async () => {
    const auth = instance(production);
    const response = await auth.handler(startRequest(production));
    expect(response.status).toBe(200);
    const target = new URL((await response.json()).url);
    expect(target.origin).toBe("https://provider.example.invalid");
    expect(target.searchParams.get("redirect_uri")).toBe(
      `${production}/api/auth/callback/oauth`,
    );
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("code_challenge")).toBeTruthy();
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("rejects an untrusted post-login origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (
        await instance(preview).handler(
          startRequest(preview, "https://untrusted.example.invalid/"),
        )
      ).status,
    ).toBe(403);
  });
  it("completes a preview -> production -> preview proxy roundtrip without live services", async () => {
    let tokenCalls = 0,
      userInfoCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = request.url;
        if (url === "https://provider.example.invalid/token") {
          tokenCalls++;
          expect(request.method).toBe("POST");
          const payload = new URLSearchParams(await request.text());
          expect(payload.get("code")).toBe("test-code");
          expect(payload.get("redirect_uri")).toBe(
            `${production}/api/auth/callback/oauth`,
          );
          expect(payload.get("code_verifier")).toBeTruthy();
          return Response.json({
            access_token: "test-access-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        if (url === "https://provider.example.invalid/userinfo") {
          userInfoCalls++;
          expect(request.headers.get("authorization")).toBe(
            "Bearer test-access-token",
          );
          return Response.json({
            id: "test-owner",
            email: "owner@example.invalid",
            name: "Test Owner",
            emailVerified: true,
          });
        }
        throw new Error(
          `Unexpected test network request: ${new URL(url).origin}`,
        );
      }),
    );
    const source = instance(preview),
      proxy = instance(production);
    const start = await source.handler(startRequest(preview));
    expect(start.status).toBe(200);
    const cookies = start.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const authorization = new URL((await start.json()).url);
    const callback = new URL(`${production}/api/auth/callback/oauth`);
    callback.searchParams.set("code", "test-code");
    callback.searchParams.set(
      "state",
      authorization.searchParams.get("state") ?? "",
    );
    const proxied = await proxy.handler(new Request(callback));
    expect(proxied.status).toBe(302);
    const returnUrl = proxied.headers.get("location");
    expect(returnUrl).toBeTruthy();
    expect(new URL(returnUrl ?? "").origin).toBe(preview);
    expect(new URL(returnUrl ?? "").pathname).toBe(
      "/api/auth/callback/oauth/oauth-proxy",
    );
    const completed = await source.handler(
      new Request(returnUrl ?? "", { headers: { cookie: cookies } }),
    );
    expect(completed.status).toBe(302);
    expect(
      completed.headers
        .getSetCookie()
        .some((c) => c.includes("session_token=")),
    ).toBe(true);
    const sessionCookies = completed.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    const session = await source.api.getSession({
      headers: new Headers({ cookie: sessionCookies }),
    });
    expect(session?.user.email).toBe("owner@example.invalid");
    expect(tokenCalls).toBe(1);
    expect(userInfoCalls).toBe(1);
  });
});
