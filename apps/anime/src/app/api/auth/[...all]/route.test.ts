import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() =>
  vi.fn(async (request: Request) =>
    Response.json({
      method: request.method,
      path: new URL(request.url).pathname,
    }),
  ),
);
vi.mock("@/lib/auth", () => ({ auth: { handler } }));

import { GET, POST } from "./route";

describe("Better Auth Next adapter", () => {
  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)(
    "forwards %s requests unchanged through the actual installed adapter",
    async (method, route) => {
      const request = new Request(
        "https://anime.example.test/api/auth/get-session",
        { method },
      );
      const response = await route(request);
      expect(handler).toHaveBeenLastCalledWith(request);
      expect(await response.json()).toEqual({
        method,
        path: "/api/auth/get-session",
      });
    },
  );
});
