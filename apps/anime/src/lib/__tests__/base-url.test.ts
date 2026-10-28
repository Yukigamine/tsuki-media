import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientBaseUrl,
  getProductionBaseUrl,
  getServerBaseUrl,
} from "../base-url";

const keys = [
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "NEXT_PUBLIC_CUSTOM_DOMAIN",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "BETTER_AUTH_PRODUCTION_URL",
];
beforeEach(() => {
  for (const key of keys) vi.stubEnv(key, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("auth origins", () => {
  it("keeps a preview on its branch origin even with production public URLs", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "preview.example.test///");
    vi.stubEnv("NEXT_PUBLIC_CUSTOM_DOMAIN", "production.example.test");
    expect(getServerBaseUrl()).toBe("https://preview.example.test");
    vi.stubEnv("VERCEL_BRANCH_URL", "");
    vi.stubEnv("VERCEL_URL", "deployment.example.test");
    expect(getServerBaseUrl()).toBe("https://deployment.example.test");
  });
  it("applies documented server precedence and normalizes protocols and trailing slashes", () => {
    const choices = [
      [
        "NEXT_PUBLIC_CUSTOM_DOMAIN",
        " https://custom.example.test/// ",
        "https://custom.example.test",
      ],
      [
        "BETTER_AUTH_URL",
        "http://auth.example.test/",
        "http://auth.example.test",
      ],
      ["NEXT_PUBLIC_APP_URL", "app.example.test", "https://app.example.test"],
      [
        "VERCEL_BRANCH_URL",
        "branch.example.test",
        "https://branch.example.test",
      ],
      [
        "VERCEL_URL",
        "deployment.example.test",
        "https://deployment.example.test",
      ],
    ];
    for (const [key, value] of choices) vi.stubEnv(key, value);
    for (const [key, , expected] of choices) {
      expect(getServerBaseUrl()).toBe(expected);
      vi.stubEnv(key, "");
    }
    expect(getServerBaseUrl()).toBe("http://localhost:3000");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getServerBaseUrl()).toBe("http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_URL", "   ");
    expect(getServerBaseUrl()).toBe("http://localhost:3000");
  });
  it("uses a stable configured callback origin independently of the preview", () => {
    expect(getProductionBaseUrl()).toBe("https://anime.yukigamine.net");
    vi.stubEnv("BETTER_AUTH_PRODUCTION_URL", " callback.example.test/// ");
    expect(getProductionBaseUrl()).toBe("https://callback.example.test");
  });
  it("prefers the actual browser origin to compiled production variables", () => {
    vi.stubEnv("NEXT_PUBLIC_CUSTOM_DOMAIN", "production.example.test");
    vi.stubGlobal("window", {
      location: { origin: "https://preview.example.test" },
    });
    expect(getClientBaseUrl()).toBe("https://preview.example.test");
  });
  it("resolves client origins safely during server rendering", () => {
    vi.stubGlobal("window", undefined);
    vi.stubEnv("NEXT_PUBLIC_CUSTOM_DOMAIN", "custom.example.test/");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "app.example.test/");
    expect(getClientBaseUrl()).toBe("https://custom.example.test");
    vi.stubEnv("NEXT_PUBLIC_CUSTOM_DOMAIN", "");
    expect(getClientBaseUrl()).toBe("https://app.example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getClientBaseUrl()).toBe("http://localhost:3000");
    vi.stubGlobal("window", { location: null });
    expect(getClientBaseUrl()).toBe("http://localhost:3000");
  });
});
