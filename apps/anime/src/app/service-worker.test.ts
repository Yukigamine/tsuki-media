import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkerOptions = {
  precacheEntries: unknown;
  skipWaiting: boolean;
  clientsClaim: boolean;
  navigationPreload: boolean;
  runtimeCaching: unknown;
  fallbacks: {
    entries: {
      url: string;
      matcher: (input: { request: { destination: string } }) => boolean;
    }[];
  };
};
const f = vi.hoisted(() => ({
  listener: vi.fn(),
  options: null as WorkerOptions | null,
  route: vi.fn(),
  spawn: vi.fn(),
  runtime: [{ handler: "fake runtime handler" }],
}));
vi.mock("serwist", () => ({
  Serwist: class {
    constructor(options: WorkerOptions) {
      f.options = options;
    }
    addEventListeners() {
      f.listener();
    }
  },
}));
vi.mock("@serwist/turbopack/worker", () => ({ defaultCache: f.runtime }));
vi.mock("@serwist/turbopack", () => ({ createSerwistRoute: f.route }));
vi.mock("node:child_process", () => ({ spawnSync: f.spawn }));

beforeEach(() => {
  vi.resetModules();
  f.options = null;
  f.listener.mockClear();
  f.route
    .mockReset()
    .mockReturnValue({ GET: "handler", dynamic: "force-static" });
  f.spawn.mockReset().mockReturnValue({ stdout: "local-head\n" });
  for (const name of ["VERCEL_GIT_COMMIT_SHA", "GITHUB_SHA", "COMMIT_SHA"])
    vi.stubEnv(name, "");
});

describe("service worker integration contracts", () => {
  it("registers supplied precache entries and only offers the offline document for navigations", async () => {
    const manifest = [{ url: "/app.js", revision: "123" }];
    vi.stubGlobal("self", { __SW_MANIFEST: manifest });
    await import("./sw");
    expect(f.listener).toHaveBeenCalledOnce();
    expect(f.options).toMatchObject({
      precacheEntries: manifest,
      skipWaiting: true,
      clientsClaim: true,
      navigationPreload: true,
      runtimeCaching: f.runtime,
    });
    const fallback = f.options?.fallbacks.entries[0];
    expect(fallback?.url).toBe("/~offline");
    expect(fallback?.matcher({ request: { destination: "document" } })).toBe(
      true,
    );
    for (const destination of ["image", "script", "style", ""])
      expect(fallback?.matcher({ request: { destination } })).toBe(false);
  });
  it.each([
    ["vercel-head", "github-head", "commit-head", "vercel-head"],
    [" ", " github-head ", "commit-head", "github-head"],
    ["", "", "commit-head", "commit-head"],
    ["", "", "", "local-head"],
  ])(
    "uses deployment revision precedence for cache invalidation (%s/%s/%s)",
    async (vercel, github, commit, expected) => {
      vi.stubEnv("VERCEL_GIT_COMMIT_SHA", vercel);
      vi.stubEnv("GITHUB_SHA", github);
      vi.stubEnv("COMMIT_SHA", commit);
      const route = await import("./serwist/[path]/route");
      expect(f.route).toHaveBeenCalledWith({
        additionalPrecacheEntries: [{ url: "/~offline", revision: expected }],
        swSrc: "src/app/sw.ts",
        globIgnores: ["**/icons/tsuki/startup/**"],
        useNativeEsbuild: true,
      });
      expect(route.GET).toBe("handler");
    },
  );
  it("uses a stable development revision when Git returns no head", async () => {
    f.spawn.mockReturnValue({ stdout: " \n" });
    await import("./serwist/[path]/route");
    expect(f.route.mock.calls[0][0].additionalPrecacheEntries).toEqual([
      { url: "/~offline", revision: "dev" },
    ]);
  });
});
