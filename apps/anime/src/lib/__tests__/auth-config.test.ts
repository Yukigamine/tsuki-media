import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  findFirst: vi.fn(),
  betterAuth: vi.fn((options: unknown) => options),
  prismaAdapter: vi.fn(() => ({ adapter: "test" })),
  genericOAuth: vi.fn((options: unknown) => ({ id: "generic-oauth", options })),
  proxy: vi.fn((options: unknown) => ({ id: "oauth-proxy", options })),
}));
vi.mock("server-only", () => ({}));
vi.mock("better-auth", () => ({ betterAuth: fakes.betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({
  prismaAdapter: fakes.prismaAdapter,
}));
vi.mock("better-auth/plugins/generic-oauth", () => ({
  genericOAuth: fakes.genericOAuth,
}));
vi.mock("better-auth/plugins/oauth-proxy", () => ({ oAuthProxy: fakes.proxy }));
vi.mock("@/lib/prisma", () => ({
  default: { user: { findFirst: fakes.findFirst } },
}));
const keys = [
  "AUTHORIZED_EMAIL",
  "CUSTOM_OAUTH_CLIENT_ID",
  "CUSTOM_OAUTH_CLIENT_SECRET",
  "CUSTOM_OAUTH_AUTHORIZATION_URL",
  "CUSTOM_OAUTH_TOKEN_URL",
  "CUSTOM_OAUTH_USERINFO_URL",
  "CUSTOM_OAUTH_DISCOVERY_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "TWITTER_CLIENT_ID",
  "TWITTER_CLIENT_SECRET",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "BETTER_AUTH_OAUTH_PROXY_SECRET",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_PRODUCTION_URL",
  "NEXT_PUBLIC_CUSTOM_DOMAIN",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of keys) vi.stubEnv(key, "");
  fakes.findFirst.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
type TestUser = { email: string; name?: string };
type AuthOptions = {
  baseURL: string;
  socialProviders: Record<string, { clientId: string; clientSecret: string }>;
  trustedOrigins: string[];
  plugins: unknown[];
  databaseHooks: {
    user: {
      create: { before: (user: TestUser) => Promise<{ data: TestUser }> };
    };
  };
};
const load = async () =>
  (await import("../auth")).auth as unknown as AuthOptions;

describe("production auth configuration", () => {
  it("keeps providers disabled without complete credentials and handles a blank optional proxy secret safely", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "incomplete-id");
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_ID", "incomplete-id");
    vi.stubEnv("BETTER_AUTH_OAUTH_PROXY_SECRET", "   ");
    const options = await load();
    expect(options.socialProviders).toEqual({});
    expect(options.plugins).toEqual([
      {
        id: "oauth-proxy",
        options: {
          productionURL: "https://anime.yukigamine.net",
          secret: undefined,
        },
      },
    ]);
    expect(fakes.genericOAuth).not.toHaveBeenCalled();
    expect(fakes.prismaAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.anything() }),
      { provider: "postgresql" },
    );
    expect(options.baseURL).toBe("http://localhost:3000");
  });
  it("configures supported social providers and restricts trust to explicit origins and the owned preview namespace", async () => {
    for (const provider of ["GOOGLE", "DISCORD", "GITHUB", "TWITTER"]) {
      vi.stubEnv(`${provider}_CLIENT_ID`, `${provider}-id`);
      vi.stubEnv(`${provider}_CLIENT_SECRET`, "test-provider-secret");
    }
    vi.stubEnv("BETTER_AUTH_URL", "https://current.example.test");
    vi.stubEnv("BETTER_AUTH_PRODUCTION_URL", "https://production.example.test");
    vi.stubEnv(
      "BETTER_AUTH_TRUSTED_ORIGINS",
      " https://extra.example.test, ,https://other.example.test ",
    );
    vi.stubEnv("BETTER_AUTH_OAUTH_PROXY_SECRET", " proxy-test-secret ");
    const options = await load();
    expect(Object.keys(options.socialProviders)).toEqual([
      "google",
      "discord",
      "github",
      "twitter",
    ]);
    for (const [provider, config] of Object.entries(options.socialProviders))
      expect(config).toEqual({
        clientId: `${provider.toUpperCase()}-id`,
        clientSecret: "test-provider-secret",
      });
    expect(options.trustedOrigins).toEqual([
      "https://current.example.test",
      "https://production.example.test",
      "http://localhost:3000",
      "https://tsuki-client-*-team-yuki.vercel.app",
      "https://extra.example.test",
      "https://other.example.test",
    ]);
    expect(fakes.proxy).toHaveBeenCalledWith({
      productionURL: "https://production.example.test",
      secret: "proxy-test-secret",
    });
  });
  it("prefers explicit custom OAuth endpoints over discovery and keeps required OIDC scopes", async () => {
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_ID", "custom-id");
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_SECRET", "test-secret");
    vi.stubEnv(
      "CUSTOM_OAUTH_AUTHORIZATION_URL",
      "https://id.example.test/authorize",
    );
    vi.stubEnv("CUSTOM_OAUTH_TOKEN_URL", "https://id.example.test/token");
    vi.stubEnv("CUSTOM_OAUTH_USERINFO_URL", "https://id.example.test/userinfo");
    vi.stubEnv(
      "CUSTOM_OAUTH_DISCOVERY_URL",
      "https://id.example.test/discovery",
    );
    const options = await load();
    expect(options.plugins).toHaveLength(2);
    expect(fakes.genericOAuth).toHaveBeenCalledWith({
      config: [
        {
          providerId: "oauth",
          clientId: "custom-id",
          clientSecret: "test-secret",
          authorizationUrl: "https://id.example.test/authorize",
          tokenUrl: "https://id.example.test/token",
          userInfoUrl: "https://id.example.test/userinfo",
          scopes: ["openid", "email", "profile"],
        },
      ],
    });
  });
  it("uses discovery when explicit endpoints are incomplete and ignores an unconfigured custom provider", async () => {
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_ID", "custom-id");
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_SECRET", "test-secret");
    vi.stubEnv(
      "CUSTOM_OAUTH_DISCOVERY_URL",
      "https://id.example.test/discovery",
    );
    await load();
    expect(fakes.genericOAuth).toHaveBeenLastCalledWith({
      config: [
        {
          providerId: "oauth",
          clientId: "custom-id",
          clientSecret: "test-secret",
          discoveryUrl: "https://id.example.test/discovery",
          scopes: ["openid", "email", "profile"],
        },
      ],
    });
    vi.resetModules();
    vi.stubEnv("CUSTOM_OAUTH_DISCOVERY_URL", "");
    await load();
    expect(fakes.genericOAuth).toHaveBeenLastCalledWith({ config: [] });
  });
});

describe("single-identity provisioning boundary", () => {
  it("allows the first identity and repeat provisioning of the same email, case-insensitively", async () => {
    const options = await load();
    const user = { email: "Owner@example.test", name: "Owner" };
    expect(await options.databaseHooks.user.create.before(user)).toEqual({
      data: user,
    });
    fakes.findFirst.mockResolvedValue({
      id: "owner",
      email: "owner@EXAMPLE.test",
    });
    expect(await options.databaseHooks.user.create.before(user)).toEqual({
      data: user,
    });
    expect(fakes.findFirst).toHaveBeenCalledWith({
      select: { id: true, email: true },
    });
  });
  it("rejects another identity even if the provider authenticates successfully", async () => {
    fakes.findFirst.mockResolvedValue({
      id: "owner",
      email: "owner@example.test",
    });
    const options = await load();
    await expect(
      options.databaseHooks.user.create.before({
        email: "intruder@example.test",
      }),
    ).rejects.toThrow("only allows a single user identity");
  });
  it("enforces configured authorized email for the first identity and propagates database failures", async () => {
    vi.stubEnv("AUTHORIZED_EMAIL", "Owner@Example.test");
    const options = await load();
    await expect(
      options.databaseHooks.user.create.before({ email: "other@example.test" }),
    ).rejects.toThrow("is not authorized");
    await expect(
      options.databaseHooks.user.create.before({ email: "owner@example.test" }),
    ).resolves.toEqual({ data: { email: "owner@example.test" } });
    fakes.findFirst.mockRejectedValue(new Error("database unavailable"));
    await expect(
      options.databaseHooks.user.create.before({ email: "owner@example.test" }),
    ).rejects.toThrow("database unavailable");
  });
});
