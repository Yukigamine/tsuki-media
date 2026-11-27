import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
});

describe("app metadata adapter compatibility", () => {
  it.each([
    [
      "configured origin",
      "https://media.example.invalid",
      "ignored.example.invalid",
      "https://media.example.invalid/",
    ],
    [
      "Vercel origin",
      undefined,
      "media.example.invalid",
      "https://media.example.invalid/",
    ],
    ["local origin", undefined, undefined, "http://localhost:3000/"],
  ])(
    "selects the %s without dropping PWA install metadata",
    async (_name, explicit, host, expected) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", explicit);
      vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", host);
      const { metadata, viewport } = await import("./metadata");
      expect(String(metadata.metadataBase)).toBe(expected);
      expect(metadata.applicationName).toBe("Tsuki Anime");
      expect(metadata.formatDetection).toEqual({ telephone: false });
      expect(metadata.appleWebApp).toMatchObject({
        capable: true,
        title: "Tsuki Anime",
      });
      expect(viewport).toMatchObject({
        width: "device-width",
        initialScale: 1,
      });
    },
  );
  it("serves a standalone manifest with root-scoped install URLs", async () => {
    const { default: manifest } = await import("./manifest");
    expect(manifest()).toMatchObject({
      name: "Tsuki Anime",
      id: "/",
      scope: "/",
      start_url: "/",
      display: "standalone",
    });
  });
});
