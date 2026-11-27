import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveToken: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/provider-links", () => mocks);

import { buildAniListAuthUrl, exchangeAniListCode } from "./auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("ANILIST_CLIENT_ID", "dummy-client");
  vi.stubEnv("ANILIST_CLIENT_SECRET", "dummy-secret");
  vi.stubEnv(
    "ANILIST_REDIRECT_URI",
    "https://app.invalid/link/anilist/callback",
  );
  mocks.saveToken.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("AniList linking transport", () => {
  it("URL-encodes client and callback parameters including explicit/fallback redirect configuration", () => {
    let url = new URL(buildAniListAuthUrl());
    expect(url.origin + url.pathname).toBe(
      "https://anilist.co/api/v2/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "dummy-client",
      redirect_uri: "https://app.invalid/link/anilist/callback",
      response_type: "code",
    });
    vi.stubEnv("ANILIST_REDIRECT_URI", undefined);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fallback.invalid");
    vi.stubEnv("ANILIST_CLIENT_ID", undefined);
    url = new URL(buildAniListAuthUrl());
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://fallback.invalid/link/anilist/callback",
    );
    expect(url.searchParams.get("client_id")).toBe("");
  });
  it("exchanges the code and persists identity, avatar and expiry scoped to the authenticated user", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            Viewer: { id: 42, name: "name", avatar: { large: "avatar" } },
          },
        }),
      );
    expect(await exchangeAniListCode("dummy-code", { userId: "u" })).toBe(
      "access",
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://anilist.co/api/v2/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: "dummy-client",
          client_secret: "dummy-secret",
          redirect_uri: "https://app.invalid/link/anilist/callback",
          code: "dummy-code",
        }),
      },
    );
    expect(mocks.saveToken).toHaveBeenCalledWith(
      "ANILIST",
      {
        accessToken: "access",
        refreshToken: null,
        expiresAt: new Date("2026-01-01T01:00:00Z"),
        providerUserId: "42",
        username: "name",
        avatarUrl: "avatar",
      },
      { userId: "u" },
    );
  });
  it.each([
    [
      { error_description: "expired code", error: "invalid_grant" },
      "expired code",
    ],
    [{ error: "invalid_grant" }, "invalid_grant"],
    [{}, "HTTP 400"],
  ])("preserves useful upstream token errors", async (body, error) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(body, { status: 400 }),
    );
    await expect(exchangeAniListCode("code")).rejects.toThrow(
      `AniList token exchange failed: ${error}`,
    );
    expect(mocks.saveToken).not.toHaveBeenCalled();
  });
  it("handles a non-JSON token error without persisting anything", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("error", { status: 502 }),
    );
    await expect(exchangeAniListCode("code")).rejects.toThrow("HTTP 502");
    expect(mocks.saveToken).not.toHaveBeenCalled();
  });
  it.each([
    Response.json({ data: { Viewer: { id: 7, name: "n" } } }),
    Response.json({}),
    new Response("{broken"),
    new Response(null, { status: 503 }),
  ])(
    "still persists usable access tokens when optional viewer metadata is unavailable",
    async (viewer) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          Response.json({ access_token: "access", expires_in: 10 }),
        )
        .mockResolvedValueOnce(viewer);
      expect(await exchangeAniListCode("code")).toBe("access");
      expect(mocks.saveToken.mock.calls[0][1]).toMatchObject({
        accessToken: "access",
        avatarUrl: null,
      });
    },
  );
  it("supports fallback configuration and propagates persistence/transport failures", async () => {
    vi.stubEnv("ANILIST_CLIENT_ID", undefined);
    vi.stubEnv("ANILIST_CLIENT_SECRET", undefined);
    vi.stubEnv("ANILIST_REDIRECT_URI", undefined);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fallback.invalid");
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ access_token: "access", expires_in: 1 }),
      )
      .mockResolvedValueOnce(Response.json({}));
    mocks.saveToken.mockRejectedValueOnce(new Error("db down"));
    await expect(exchangeAniListCode("code")).rejects.toThrow("db down");
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)),
    ).toMatchObject({
      client_id: "",
      client_secret: "",
      redirect_uri: "https://fallback.invalid/link/anilist/callback",
    });
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(exchangeAniListCode("code")).rejects.toThrow("offline");
  });
});
