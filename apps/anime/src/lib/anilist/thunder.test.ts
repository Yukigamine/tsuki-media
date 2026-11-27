import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokens = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/provider-links", () => tokens);
vi.mock("@/lib/zeus/anilist", () => ({
  Thunder: (request: unknown) => request,
}));

import { anilistThunder } from "./thunder";

const request = anilistThunder as unknown as (
  query: string,
  variables?: unknown,
) => Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  tokens.getToken.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AniList transport error and retry contract", () => {
  it("sends the linked token only when present and serializes GraphQL variables", async () => {
    tokens.getToken.mockResolvedValue({ accessToken: "dummy-token" });
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ data: { Viewer: { id: 1 } } }),
    );
    expect(await request("query Viewer", { id: 1 })).toEqual({
      Viewer: { id: 1 },
    });
    expect(fetch).toHaveBeenCalledWith("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer dummy-token",
      },
      body: JSON.stringify({ query: "query Viewer", variables: { id: 1 } }),
      next: { revalidate: 0 },
    });
    tokens.getToken.mockResolvedValue(null);
    await request("query Public");
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });
  it("retries a 429 using Retry-After and then returns data", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(Response.json({ data: { ok: true } }));
    const result = request("q");
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([null, "invalid", "0"])(
    "bounds retries when Retry-After is %s",
    async (retry) => {
      vi.useFakeTimers();
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, {
          status: 429,
          headers: retry === null ? {} : { "Retry-After": retry },
        }),
      );
      const result = request("q");
      const assertion = expect(result).rejects.toThrow("exceeded retry limit");
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetch).toHaveBeenCalledTimes(5);
    },
  );
  it("rejects Cloudflare challenges without retrying or parsing challenge HTML", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("challenge", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      }),
    );
    await expect(request("q")).rejects.toThrow("blocked by Cloudflare");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves GraphQL errors on both successful and failed HTTP responses", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          { errors: [{ message: "bad query" }, { message: "forbidden" }] },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: {}, errors: [{ message: "denied" }] }),
      );
    await expect(request("q")).rejects.toThrow("bad query; forbidden");
    await expect(request("q")).rejects.toThrow("denied");
  });
  it("uses status for non-JSON errors and rejects absent data or malformed JSON", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(new Response("{broken"));
    await expect(request("q")).rejects.toThrow("AniList HTTP 500");
    await expect(request("q")).rejects.toThrow("returned no data");
    await expect(request("q")).rejects.toThrow();
  });
  it("handles unreadable error bodies and network failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers(),
        text: vi.fn().mockRejectedValue(new Error("closed")),
      } as unknown as Response)
      .mockRejectedValueOnce(new Error("offline"));
    await expect(request("q")).rejects.toThrow("AniList HTTP 502");
    await expect(request("q")).rejects.toThrow("offline");
  });
});
