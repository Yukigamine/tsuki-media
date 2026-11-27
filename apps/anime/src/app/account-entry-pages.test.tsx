import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn((target: string): never => {
    throw new Error(`redirect:${target}`);
  }),
}));
vi.mock("@/lib/session", () => ({ getSession: f.session }));
vi.mock("next/navigation", () => ({ redirect: f.redirect }));
vi.mock("@/components/LoginForm", () => ({
  default: ({ providers }: { providers: object[] }) => (
    <pre data-testid="providers">{JSON.stringify(providers)}</pre>
  ),
}));
vi.mock("@/components/UserProfileContent", () => ({
  default: ({ username }: { username: string }) => (
    <div>Profile: {username}</div>
  ),
}));

import LoginPage from "./login/page";
import UserPage, { generateMetadata } from "./user/[username]/page";

const providerNames = [
  "GOOGLE",
  "DISCORD",
  "GITHUB",
  "TWITTER",
  "CUSTOM_OAUTH",
] as const;
beforeEach(() => {
  f.session.mockReset().mockResolvedValue(null);
  f.redirect.mockClear();
  for (const name of providerNames) {
    vi.stubEnv(`${name}_CLIENT_ID`, undefined);
    vi.stubEnv(`${name}_CLIENT_SECRET`, undefined);
  }
  vi.stubEnv("CUSTOM_OAUTH_NAME", undefined);
  vi.stubEnv("CUSTOM_OAUTH_ICON", undefined);
});
const configuredProviders = () =>
  JSON.parse(screen.getByTestId("providers").textContent || "[]");

describe("login provider configuration", () => {
  it("redirects signed-in users instead of exposing another login form", async () => {
    f.session.mockResolvedValue({ user: { id: "test-user" } });
    await expect(LoginPage()).rejects.toThrow("redirect:/logout");
  });
  it("renders an empty provider list when no credentials are configured", async () => {
    render(await LoginPage());
    expect(configuredProviders()).toEqual([]);
  });
  it.each(providerNames)("requires both credentials for %s", async (name) => {
    vi.stubEnv(`${name}_CLIENT_ID`, "fake-client");
    const { unmount } = render(await LoginPage());
    expect(configuredProviders()).toEqual([]);
    unmount();
    vi.stubEnv(`${name}_CLIENT_ID`, undefined);
    vi.stubEnv(`${name}_CLIENT_SECRET`, "fake-secret");
    render(await LoginPage());
    expect(configuredProviders()).toEqual([]);
  });
  it("passes only public provider presentation to the login UI", async () => {
    for (const name of providerNames) {
      vi.stubEnv(`${name}_CLIENT_ID`, "fake-client");
      vi.stubEnv(`${name}_CLIENT_SECRET`, "fake-secret");
    }
    render(await LoginPage());
    const providers = configuredProviders();
    expect(
      providers.map((p: { id: string; label: string }) => [p.id, p.label]),
    ).toEqual([
      ["google", "Google"],
      ["discord", "Discord"],
      ["github", "GitHub"],
      ["twitter", "Twitter / X"],
      ["oauth", "Custom"],
    ]);
    expect(
      providers.every(
        (p: { color: string; svg: null; iconUrl: null }) =>
          /^#[0-9a-f]{6}$/i.test(p.color) &&
          p.svg === null &&
          p.iconUrl === null,
      ),
    ).toBe(true);
    expect(screen.getByTestId("providers")).not.toHaveTextContent(
      "fake-secret",
    );
    expect(screen.getByTestId("providers")).not.toHaveTextContent(
      "fake-client",
    );
  });
  it("passes configured custom OAuth branding without changing the stable provider id", async () => {
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_ID", "fake-client");
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_SECRET", "fake-secret");
    vi.stubEnv("CUSTOM_OAUTH_NAME", "Test identity");
    vi.stubEnv("CUSTOM_OAUTH_ICON", "https://identity.test/icon.png");
    render(await LoginPage());
    expect(configuredProviders()).toEqual([
      expect.objectContaining({
        id: "oauth",
        label: "Test identity",
        iconUrl: "https://identity.test/icon.png",
      }),
    ]);
  });
});

describe("public user route", () => {
  it("awaits route params for both metadata and profile content", async () => {
    const props = { params: Promise.resolve({ username: "reader-one" }) };
    expect(await generateMetadata(props)).toEqual({
      title: "reader-one – Tsuki Anime",
    });
    render(await UserPage(props));
    expect(screen.getByText("Profile: reader-one")).toBeInTheDocument();
    expect(f.session).not.toHaveBeenCalled();
  });
});
