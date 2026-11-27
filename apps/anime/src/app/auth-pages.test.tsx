import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: vi.fn(),
  status: vi.fn(),
  profile: vi.fn(),
  authUrl: vi.fn(),
  logout: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: f.redirect }));
vi.mock("@/lib/session", () => ({ getSession: f.session }));
vi.mock("@/lib/provider-links", () => ({ getAuthStatus: f.status }));
vi.mock("@/lib/profile-summary", () => ({ getProfileSummary: f.profile }));
vi.mock("@/lib/anilist/auth", () => ({ buildAniListAuthUrl: f.authUrl }));
vi.mock("@/lib/actions/auth", () => ({ logoutAndRedirectAction: f.logout }));
vi.mock("@/components/SyncDashboard", () => ({
  default: () => <div>Sync dashboard</div>,
}));
vi.mock("@/components/LogoutForm", () => ({
  default: ({ user }: { user: { name: string } }) => (
    <div>Logout {user.name}</div>
  ),
}));
vi.mock("@/components/UserProfileContent", () => ({
  default: (props: object) => (
    <pre data-testid="profile">{JSON.stringify(props)}</pre>
  ),
}));
vi.mock("./link/kitsu/KitsuLoginForm", () => ({
  default: ({ configuredUsername }: { configuredUsername: string }) => (
    <div>Kitsu identity: {configuredUsername || "unrestricted"}</div>
  ),
}));
vi.mock("./link/LinkFlashSnackbar", () => ({ default: () => null }));

import AniListPage from "./link/anilist/page";
import KitsuPage from "./link/kitsu/page";
import LinkPage from "./link/page";
import ListPage from "./list/page";
import LogoutPage from "./logout/page";
import MePage from "./me/page";
import HomePage from "./page";
import SyncPage from "./sync/page";

beforeEach(() => {
  f.session
    .mockReset()
    .mockResolvedValue({ user: { id: "owner", name: "Owner" } });
  f.status.mockReset().mockResolvedValue({
    KITSU: { loggedIn: false, username: null },
    ANILIST: { loggedIn: false, username: null },
  });
  f.profile.mockReset().mockResolvedValue({ anime: 2, manga: 1 });
  f.authUrl
    .mockReset()
    .mockReturnValue(
      "https://anilist.co/api/v2/oauth/authorize?client_id=test",
    );
  f.redirect.mockClear();
  f.logout.mockReset();
  vi.stubEnv("ANILIST_CLIENT_ID", undefined);
  vi.stubEnv("NEXT_PUBLIC_KITSU_USERNAME", undefined);
});

describe("server page authentication boundaries", () => {
  it.each([
    ["sync", () => SyncPage(), "/login?next=/sync"],
    ["logout", () => LogoutPage(), "/login"],
    ["AniList", () => AniListPage(), "/login"],
    ["Kitsu", () => KitsuPage(), "/login"],
    [
      "link accounts",
      () => LinkPage({ searchParams: Promise.resolve({}) }),
      "/login?next=/link",
    ],
  ] as const)(
    "redirects signed-out %s before provider work",
    async (_name, page, target) => {
      f.session.mockResolvedValue(null);
      await expect(page()).rejects.toThrow(`redirect:${target}`);
      expect(f.status).not.toHaveBeenCalled();
      expect(f.authUrl).not.toHaveBeenCalled();
    },
  );
  it("renders the sync dashboard only for an authenticated session", async () => {
    render(await SyncPage());
    expect(screen.getByText("Sync dashboard")).toBeInTheDocument();
  });
  it("passes the authenticated identity to logout", async () => {
    render(await LogoutPage());
    expect(screen.getByText("Logout Owner")).toBeInTheDocument();
  });
  it("shows actionable missing-provider configuration rather than redirecting to an invalid URL", async () => {
    render(await AniListPage());
    expect(screen.getByText("AniList not configured")).toBeInTheDocument();
    expect(f.redirect).not.toHaveBeenCalled();
  });
  it("redirects configured AniList login to the provider-generated authorization URL", async () => {
    vi.stubEnv("ANILIST_CLIENT_ID", "test");
    await expect(AniListPage()).rejects.toThrow(
      "redirect:https://anilist.co/api/v2/oauth/authorize?client_id=test",
    );
    expect(f.authUrl).toHaveBeenCalledOnce();
  });
  it.each([undefined, "configured-owner"])(
    "passes the optional Kitsu identity restriction %s",
    async (username) => {
      vi.stubEnv("NEXT_PUBLIC_KITSU_USERNAME", username);
      render(await KitsuPage());
      expect(
        screen.getByText(`Kitsu identity: ${username || "unrestricted"}`),
      ).toBeInTheDocument();
    },
  );
  it.each([false, true])(
    "scopes linked-account controls to the session (linked=%s)",
    async (linked) => {
      f.status.mockResolvedValue({
        KITSU: { loggedIn: linked, username: linked ? "kitsu-owner" : null },
        ANILIST: {
          loggedIn: linked,
          username: linked ? "anilist-owner" : null,
        },
      });
      render(
        await LinkPage({
          searchParams: Promise.resolve({ error: "Provider%20unavailable" }),
        }),
      );
      expect(f.status).toHaveBeenCalledWith("owner");
      expect(screen.getByText("Provider unavailable")).toBeInTheDocument();
      expect(
        screen.queryAllByRole("button", { name: "Disconnect" }),
      ).toHaveLength(linked ? 2 : 0);
    },
  );
  it("joins profile counts with the linked provider identities", async () => {
    f.status.mockResolvedValue({
      KITSU: { loggedIn: true, username: "kitsu-owner" },
      ANILIST: { loggedIn: true, username: "anilist-owner" },
    });
    render(await MePage());
    expect(f.profile).toHaveBeenCalledWith("anilist-owner");
    const result = JSON.parse(
      screen.getByTestId("profile").textContent || "{}",
    );
    expect(result.linkedAccounts).toEqual({
      kitsu: "kitsu-owner",
      anilist: "anilist-owner",
    });
    expect(result.profileSummary).toEqual({ anime: 2, manga: 1 });
  });
  it("keeps launch and list landing routes directed to the canonical anime list", () => {
    expect(() => HomePage()).toThrow("redirect:/list");
    expect(() => ListPage()).toThrow("redirect:/list/anime");
  });
});
