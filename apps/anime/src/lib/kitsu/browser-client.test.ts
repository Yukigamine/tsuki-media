import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  kitsuFetch: vi.fn(),
  assertNoCloudflareChallenge: vi.fn(),
}));
vi.mock("./fetch", () => mocks);
vi.mock("@/lib/zeus/kitsu", () => ({ Thunder: (request: unknown) => request }));

import { kitsuBrowserClient } from "./browser-client";

const request = kitsuBrowserClient as unknown as (
  query: string,
  variables?: unknown,
) => Promise<unknown>;
beforeEach(() => vi.clearAllMocks());
describe("browser Kitsu transport", () => {
  it("sends GraphQL JSON and validates Cloudflare status before parsing", async () => {
    mocks.kitsuFetch.mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: { ok: true } }),
    });
    expect(await request("query Me", { id: "1" })).toEqual({ ok: true });
    expect(mocks.kitsuFetch).toHaveBeenCalledWith(
      "https://kitsu.app/api/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Referer: "https://kitsu.app",
          Origin: "https://kitsu.app",
        },
        body: JSON.stringify({ query: "query Me", variables: { id: "1" } }),
      },
    );
    mocks.assertNoCloudflareChallenge.mockImplementationOnce(() => {
      throw new Error("challenge");
    });
    mocks.kitsuFetch.mockResolvedValue({
      status: 403,
      headers: {},
      body: "<html>challenge</html>",
    });
    await expect(request("q")).rejects.toThrow("challenge");
  });
  it.each([
    [400, { errors: [{ message: "invalid query" }] }, "invalid query"],
    [500, {}, "Kitsu GraphQL 500"],
    [200, { errors: [{ message: "denied" }] }, "denied"],
    [200, {}, "returned no data"],
  ])("handles HTTP/GraphQL failure %s", async (status, body, error) => {
    mocks.kitsuFetch.mockResolvedValue({
      status,
      body: JSON.stringify(body),
      headers: {},
    });
    await expect(request("q")).rejects.toThrow(error);
  });
  it("propagates malformed JSON and fetch failures", async () => {
    mocks.kitsuFetch
      .mockResolvedValueOnce({ status: 200, headers: {}, body: "{broken" })
      .mockRejectedValueOnce(new Error("offline"));
    await expect(request("q")).rejects.toThrow();
    await expect(request("q")).rejects.toThrow("offline");
  });
});
