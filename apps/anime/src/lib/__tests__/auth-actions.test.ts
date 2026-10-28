import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  headers: vi.fn(),
  signOut: vi.fn(),
  persist: vi.fn(),
  deleteToken: vi.fn(),
  getToken: vi.fn(),
  getSession: vi.fn(),
  requireSession: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: fakes.headers }));
vi.mock("next/navigation", () => ({ redirect: fakes.redirect }));
vi.mock("@/lib/auth", () => ({ auth: { api: { signOut: fakes.signOut } } }));
vi.mock("@/lib/kitsu/auth", () => ({ persistKitsuToken: fakes.persist }));
vi.mock("@/lib/provider-links", () => ({
  deleteToken: fakes.deleteToken,
  getToken: fakes.getToken,
}));
vi.mock("@/lib/session", () => ({
  getSession: fakes.getSession,
  requireSession: fakes.requireSession,
}));

import {
  getLinkedProviderAccessTokenAction,
  logoutAndRedirectAction,
  logoutAppAction,
  saveKitsuTokenAction,
} from "../actions/auth";

beforeEach(() => {
  for (const fake of Object.values(fakes)) fake.mockReset();
  vi.stubEnv("NEXT_PUBLIC_KITSU_USERNAME", "");
  fakes.requireSession.mockResolvedValue({ user: { id: "owner" } });
  fakes.persist.mockResolvedValue({ username: "Owner" });
});
afterEach(() => vi.unstubAllEnvs());
describe("token linking actions", () => {
  it.each([
    { accessToken: "", expiresIn: 3600 },
    { accessToken: "token", expiresIn: Number.NaN },
    { accessToken: "token", expiresIn: Number.POSITIVE_INFINITY },
  ])("rejects invalid payloads without persisting them", async (input) => {
    expect(await saveKitsuTokenAction(input)).toEqual({
      ok: false,
      error: "Invalid token payload",
    });
    expect(fakes.persist).not.toHaveBeenCalled();
  });
  it("binds persistence to the authenticated user and accepts a matching username regardless of case", async () => {
    vi.stubEnv("NEXT_PUBLIC_KITSU_USERNAME", "owner");
    const input = {
      accessToken: "token",
      refreshToken: "refresh",
      expiresIn: 3600,
      fallbackUsername: "fallback",
    };
    expect(await saveKitsuTokenAction(input)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(fakes.persist).toHaveBeenCalledWith({ ...input, userId: "owner" });
    expect(fakes.deleteToken).not.toHaveBeenCalled();
  });
  it("removes a token linked to the wrong account", async () => {
    vi.stubEnv("NEXT_PUBLIC_KITSU_USERNAME", "required");
    expect(
      await saveKitsuTokenAction({ accessToken: "token", expiresIn: 3600 }),
    ).toEqual({
      ok: false,
      error: 'Authenticated as "Owner" but this app requires "required".',
    });
    expect(fakes.deleteToken).toHaveBeenCalledWith("KITSU", {
      userId: "owner",
    });
  });
  it("normalizes provider persistence failures without claiming a linked account", async () => {
    for (const error of [
      new Error("upstream unavailable"),
      "invalid response",
    ]) {
      fakes.persist.mockRejectedValueOnce(error);
      expect(
        await saveKitsuTokenAction({ accessToken: "token", expiresIn: 1 }),
      ).toEqual({
        ok: false,
        error: String(error instanceof Error ? error.message : error),
      });
    }
  });
  it("does not persist or retrieve tokens without a session", async () => {
    fakes.requireSession.mockRejectedValue(new Error("Unauthorized"));
    await expect(
      saveKitsuTokenAction({ accessToken: "token", expiresIn: 1 }),
    ).rejects.toThrow("Unauthorized");
    await expect(getLinkedProviderAccessTokenAction("ANILIST")).rejects.toThrow(
      "Unauthorized",
    );
    expect(fakes.persist).not.toHaveBeenCalled();
    expect(fakes.getToken).not.toHaveBeenCalled();
  });
  it("returns only the signed-in user's linked access token", async () => {
    fakes.getToken.mockResolvedValue({ accessToken: "linked" });
    expect(await getLinkedProviderAccessTokenAction("ANILIST")).toEqual({
      ok: true,
      data: "linked",
    });
    expect(fakes.getToken).toHaveBeenCalledWith("ANILIST", { userId: "owner" });
    for (const value of [null, {}]) {
      fakes.getToken.mockResolvedValueOnce(value);
      expect(await getLinkedProviderAccessTokenAction("KITSU")).toEqual({
        ok: false,
        error: "KITSU is not linked",
      });
    }
    for (const error of [new Error("store down"), "store error"]) {
      fakes.getToken.mockRejectedValueOnce(error);
      expect(await getLinkedProviderAccessTokenAction("KITSU")).toEqual({
        ok: false,
        error: error instanceof Error ? error.message : error,
      });
    }
  });
});
describe("logout boundaries", () => {
  it("deletes only the selected user's provider and then redirects", async () => {
    await logoutAndRedirectAction("KITSU");
    expect(fakes.deleteToken).toHaveBeenCalledWith("KITSU", {
      userId: "owner",
    });
    expect(fakes.redirect).toHaveBeenCalledWith("/link");
  });
  it("still navigates to link management after a provider-store error", async () => {
    for (const error of [new Error("store down"), "unavailable"]) {
      fakes.deleteToken.mockRejectedValueOnce(error);
      await logoutAndRedirectAction("ANILIST");
    }
    expect(fakes.redirect).toHaveBeenCalledTimes(2);
  });
  it("signs out with the incoming headers when a session exists and is idempotent otherwise", async () => {
    const headers = new Headers({ cookie: "test-cookie" });
    fakes.headers.mockResolvedValue(headers);
    fakes.getSession.mockResolvedValue({ user: { id: "owner" } });
    expect(await logoutAppAction()).toEqual({ ok: true, data: undefined });
    expect(fakes.signOut).toHaveBeenCalledWith({ headers });
    fakes.getSession.mockResolvedValue(null);
    fakes.signOut.mockClear();
    expect((await logoutAppAction()).ok).toBe(true);
    expect(fakes.signOut).not.toHaveBeenCalled();
  });
  it.each([new Error("signout failed"), "signout unavailable"])(
    "surfaces logout failures without reporting success",
    async (error) => {
      fakes.getSession.mockResolvedValue({ user: { id: "owner" } });
      fakes.signOut.mockRejectedValue(error);
      expect(await logoutAppAction()).toEqual({
        ok: false,
        error: error instanceof Error ? error.message : error,
      });
    },
  );
});
