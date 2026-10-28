import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveToken: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/provider-links", () => mocks);

import { persistKitsuToken } from "./auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("KITSU_API_URL", "https://provider.invalid/graphql");
  mocks.saveToken.mockResolvedValue(undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Kitsu token persistence", () => {
  it("resolves provider identity and expiry before persisting in the explicit user scope", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          currentProfile: {
            id: "42",
            slug: "profile",
            avatarImage: { original: { url: "avatar" } },
          },
        },
      }),
    );
    expect(
      await persistKitsuToken({
        userId: "u",
        accessToken: "dummy",
        refreshToken: "refresh",
        expiresIn: 3600,
        fallbackUsername: "fallback",
      }),
    ).toEqual({ username: "profile" });
    expect(fetch).toHaveBeenCalledWith(
      "https://provider.invalid/graphql",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer dummy",
        },
      }),
    );
    expect(mocks.saveToken).toHaveBeenCalledWith(
      "KITSU",
      {
        accessToken: "dummy",
        refreshToken: "refresh",
        expiresAt: new Date("2026-01-01T01:00:00Z"),
        providerUserId: "42",
        username: "profile",
        avatarUrl: "avatar",
      },
      { userId: "u" },
    );
  });
  it.each([
    Response.json({ data: { currentProfile: { id: "42" } } }),
    Response.json({ data: { currentProfile: null } }),
    new Response(null, { status: 503 }),
    new Response("{broken"),
  ])(
    "falls back when profile metadata is absent or unavailable",
    async (response) => {
      vi.mocked(fetch).mockResolvedValue(response);
      expect(
        await persistKitsuToken({
          userId: "u",
          accessToken: "dummy",
          expiresIn: 0,
          fallbackUsername: "fallback",
        }),
      ).toEqual({ username: "fallback" });
      expect(mocks.saveToken).toHaveBeenCalledWith(
        "KITSU",
        expect.objectContaining({
          username: "fallback",
          providerUserId: null,
          avatarUrl: null,
          refreshToken: null,
        }),
        { userId: "u" },
      );
    },
  );
  it("uses configured public/default endpoints and tolerates missing avatars/network failures", async () => {
    vi.stubEnv("KITSU_API_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_KITSU_API_URL", "https://public.invalid/graphql");
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ data: { currentProfile: { id: "1", slug: "name" } } }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    await persistKitsuToken({
      userId: "u",
      accessToken: "dummy",
      expiresIn: 1,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      "https://public.invalid/graphql",
      expect.any(Object),
    );
    expect(mocks.saveToken.mock.calls[0][1].avatarUrl).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_KITSU_API_URL", undefined);
    expect(
      await persistKitsuToken({
        userId: "u",
        accessToken: "dummy",
        expiresIn: 1,
      }),
    ).toEqual({ username: null });
    expect(fetch).toHaveBeenLastCalledWith(
      "https://kitsu.app/api/graphql",
      expect.any(Object),
    );
    mocks.saveToken.mockRejectedValueOnce(new Error("db down"));
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(
      persistKitsuToken({ userId: "u", accessToken: "dummy", expiresIn: 1 }),
    ).rejects.toThrow("db down");
  });
});
