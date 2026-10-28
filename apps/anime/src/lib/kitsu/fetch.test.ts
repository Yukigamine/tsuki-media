import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoCloudflareChallenge, kitsuFetch } from "./fetch";

afterEach(() => vi.unstubAllGlobals());
describe("Kitsu HTTP boundary", () => {
  it("preserves non-JSON errors and response headers while opting out of caching", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response("upstream error", {
          status: 503,
          headers: { "Retry-After": "5" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await kitsuFetch("https://test.invalid");
    expect({
      ...result,
      headers: Object.fromEntries(
        Object.entries(result.headers).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    }).toEqual({
      status: 503,
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "retry-after": "5",
      },
      body: "upstream error",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://test.invalid", {
      method: "GET",
      headers: undefined,
      body: undefined,
      cache: "no-store",
    });
    await kitsuFetch("https://test.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer dummy" },
      body: "{}",
    });
    expect(fetchMock).toHaveBeenLastCalledWith("https://test.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer dummy" },
      body: "{}",
      cache: "no-store",
    });
  });
  it.each([
    "cloudflare",
    "Attention Required",
    "cdn-cgi/challenge-platform",
    "cf-browser-verification",
  ])("rejects a challenge page containing %s", (body) => {
    expect(() =>
      assertNoCloudflareChallenge({ status: 403, headers: {}, body }),
    ).toThrow("Kitsu request blocked by Cloudflare challenge");
  });
  it("handles case-insensitive mitigation headers and empty challenge bodies", () => {
    expect(() =>
      assertNoCloudflareChallenge({
        status: 200,
        headers: { "CF-Mitigated": "CHALLENGE" },
        body: "",
      }),
    ).toThrow(/^Kitsu request blocked by Cloudflare challenge$/);
    expect(() =>
      assertNoCloudflareChallenge({
        status: 503,
        headers: {},
        body: " <html>\n Cloudflare   challenge</html> ",
      }),
    ).toThrow("<html> Cloudflare challenge</html>");
    expect(() =>
      assertNoCloudflareChallenge({
        status: 200,
        headers: {},
        body: "cloudflare documentation",
      }),
    ).not.toThrow();
    expect(() =>
      assertNoCloudflareChallenge({
        status: 500,
        headers: {},
        body: "server error",
      }),
    ).not.toThrow();
  });
  it("propagates transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(kitsuFetch("https://test.invalid")).rejects.toThrow("offline");
  });
});
