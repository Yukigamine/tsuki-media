import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-edge", () => ({ getSessionFromRequest: session }));

import { config, proxy } from "./proxy";

const request = (path: string, method = "GET") =>
  new NextRequest(`https://anime.example.test${path}`, { method });
beforeEach(() => {
  session.mockReset().mockResolvedValue(null);
});
describe("request authorization guard", () => {
  it.each(["/login", "/api/auth/sign-in/social"])(
    "leaves %s available without a session lookup",
    async (path) => {
      expect(
        (await proxy(request(path))).headers.get("x-middleware-next"),
      ).toBe("1");
      expect(session).not.toHaveBeenCalled();
    },
  );
  it.each([
    "/sync",
    "/api/sync",
    "/link",
    "/logout",
    "/list/anime/add",
    "/library/123/edit",
  ])("redirects unauthenticated %s to login with its path", async (path) => {
    const location = new URL(
      (await proxy(request(path))).headers.get("location") ?? "",
    );
    expect(location.origin).toBe("https://anime.example.test");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(path);
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects unauthenticated %s mutations as JSON",
    async (method) => {
      const response = await proxy(request("/list/anime", method));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
    },
  );
  it("allows public reads and authenticated protected actions", async () => {
    expect(
      (await proxy(request("/list/anime"))).headers.get("x-middleware-next"),
    ).toBe("1");
    session.mockResolvedValue("cookie-hint");
    for (const [path, method] of [
      ["/link", "GET"],
      ["/list/anime/add", "GET"],
      ["/list/anime", "POST"],
    ])
      expect(
        (await proxy(request(path, method))).headers.get("x-middleware-next"),
      ).toBe("1");
  });
  it("keeps static startup assets and auth metadata outside middleware matching", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of [
      "/icons/tsuki/startup/1290x2796.png",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/_next/static/chunk.js",
      "/_next/image",
    ])
      expect(matcher.test(path)).toBe(false);
    expect(matcher.test("/link")).toBe(true);
  });
});
