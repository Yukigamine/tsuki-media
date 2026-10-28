import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  session: vi.fn(),
  exchange: vi.fn(),
  token: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: fakes.session }));
vi.mock("@/lib/anilist/auth", () => ({ exchangeAniListCode: fakes.exchange }));
vi.mock("@/lib/provider-links", () => ({ getToken: fakes.token }));

import { GET } from "../route";

const request = (query = "") =>
  new Request(`https://anime.example.test/link/anilist/callback${query}`);
beforeEach(() => {
  for (const fake of Object.values(fakes)) fake.mockReset();
  vi.stubEnv("NEXT_PUBLIC_ANILIST_USERNAME", "");
  fakes.session.mockResolvedValue({ user: { id: "owner" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("AniList callback authorization and redirects", () => {
  it("requires a session before processing provider input", async () => {
    fakes.session.mockResolvedValue(null);
    const response = await GET(request("?code=secret-code"));
    expect(response.headers.get("location")).toBe(
      "https://anime.example.test/login?error=unauthorized",
    );
    expect(fakes.exchange).not.toHaveBeenCalled();
  });
  it.each([
    ["access_denied", "access_denied"],
    ["missing_code", "missing_code"],
    ["internal detail / sensitive", "authentication_failed"],
  ])("allowlists the %s provider error", async (raw, safe) => {
    const response = await GET(request(`?error=${encodeURIComponent(raw)}`));
    expect(response.headers.get("location")).toBe(
      `https://anime.example.test/link?error=${safe}`,
    );
    expect(fakes.exchange).not.toHaveBeenCalled();
  });
  it("handles an absent authorization code", async () => {
    expect((await GET(request())).headers.get("location")).toBe(
      "https://anime.example.test/link?error=missing_code",
    );
  });
  it("exchanges a code only for the current user and sets a short-lived success cookie", async () => {
    const response = await GET(request("?code=authorization-code"));
    expect(fakes.exchange).toHaveBeenCalledWith("authorization-code", {
      userId: "owner",
    });
    expect(response.headers.get("location")).toBe(
      "https://anime.example.test/link",
    );
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("link_success=anilist");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=60");
    expect(cookie?.toLowerCase()).toContain("samesite=lax");
    expect(fakes.token).not.toHaveBeenCalled();
  });
  it("accepts the configured account case-insensitively and rejects another linked identity", async () => {
    vi.stubEnv("NEXT_PUBLIC_ANILIST_USERNAME", "Required");
    fakes.token.mockResolvedValue({ username: "required" });
    expect((await GET(request("?code=test"))).headers.get("location")).toBe(
      "https://anime.example.test/link",
    );
    expect(fakes.token).toHaveBeenCalledWith("ANILIST", { userId: "owner" });
    fakes.token.mockResolvedValue({ username: "other" });
    const response = await GET(request("?code=test"));
    expect(response.headers.get("location")).toBe(
      "https://anime.example.test/link?error=wrong_account",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("does not expose token exchange details in redirect URLs", async () => {
    fakes.exchange.mockRejectedValue(
      new Error("upstream credentials and token details"),
    );
    const response = await GET(request("?code=test"));
    expect(response.headers.get("location")).toBe(
      "https://anime.example.test/link?error=authentication_failed",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
