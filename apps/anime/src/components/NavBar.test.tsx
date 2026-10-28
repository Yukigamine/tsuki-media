import "@testing-library/jest-dom/vitest";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NavBar from "./NavBar";

const state = vi.hoisted(() => ({
  mobile: false,
  path: "/list/anime",
  session: null as {
    user: { name?: string; email?: string; image?: string };
  } | null,
  logout: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/lib/betterauth-client", () => ({
  authClient: { useSession: () => ({ data: state.session }) },
}));
vi.mock("@/lib/actions/auth", () => ({ logoutAppAction: state.logout }));
vi.mock("@mui/material", async (load) => ({
  ...(await load<typeof import("@mui/material")>()),
  useMediaQuery: () => state.mobile,
}));
vi.mock("next/image", () => ({
  default: ({ alt, ...props }: ComponentProps<"img">) => (
    // biome-ignore lint/performance/noImgElement: Native markup represents the Next Image boundary in this test.
    <img alt={alt} {...props} />
  ),
}));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _,
    onClick,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    />
  ),
}));
const theme = createTheme({
  colorSchemes: { light: true, dark: true },
  cssVariables: { colorSchemeSelector: "class" },
});
function show() {
  return render(
    <ThemeProvider theme={theme}>
      <NavBar />
    </ThemeProvider>,
  );
}
beforeEach(() => {
  state.mobile = false;
  state.path = "/list/anime";
  state.session = null;
  state.logout.mockReset().mockResolvedValue({ ok: true });
});
describe("library navigation", () => {
  it("keeps public desktop navigation available and account-only actions hidden", () => {
    show();
    expect(screen.getByRole("link", { name: "Anime List" })).toHaveAttribute(
      "href",
      "/list/anime",
    );
    expect(screen.getByRole("link", { name: "Manga List" })).toHaveAttribute(
      "href",
      "/list/manga",
    );
    expect(screen.getByTitle("Log in")).toHaveAttribute("href", "/login");
    expect(
      screen.queryByRole("link", { name: "Sync" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Accounts" }),
    ).not.toBeInTheDocument();
  });
  it("opens collection destinations and closes the menu after a choice", async () => {
    state.path = "/collection/manga/7";
    show();
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Anime" }),
    ).toHaveAttribute("href", "/collection/anime");
    const manga = within(menu).getByRole("menuitem", { name: "Manga" });
    expect(manga).toHaveClass("Mui-selected");
    fireEvent.click(manga);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });
  it("dismisses an open collection menu with Escape", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Collections" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });
  it("shows authenticated controls and uses a provider avatar without a Gravatar lookup", () => {
    state.path = "/sync/history";
    state.session = {
      user: { name: "Owner", image: "https://images.example.test/avatar.png" },
    };
    show();
    expect(screen.getByRole("link", { name: "Sync" })).toHaveAttribute(
      "href",
      "/sync",
    );
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute(
      "href",
      "/link",
    );
    expect(screen.getByTitle("Owner")).toHaveAttribute("href", "/logout");
    expect(screen.getByAltText("Owner")).toHaveAttribute(
      "src",
      "https://images.example.test/avatar.png",
    );
  });
  it("normalizes email before hashing its Gravatar URL and clears an obsolete avatar after sign-out", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    state.session = { user: { email: " Owner@Example.TEST " } };
    const { rerender } = show();
    await waitFor(() =>
      expect(screen.getByAltText("Profile")).toHaveAttribute(
        "src",
        "https://www.gravatar.com/avatar/b2096dbc5111b6305225657ffdfab205aaff1dfb30d71805aea56922b2cbb24f?d=identicon&s=32",
      ),
    );
    expect(digest).toHaveBeenCalledWith(
      "SHA-256",
      new TextEncoder().encode("owner@example.test"),
    );
    expect(screen.getByTitle("Account")).toHaveAttribute("href", "/logout");
    state.session = null;
    rerender(
      <ThemeProvider theme={theme}>
        <NavBar />
      </ThemeProvider>,
    );
    expect(screen.queryByAltText("Profile")).not.toBeInTheDocument();
    expect(screen.getByTitle("Log in")).toBeInTheDocument();
  });
  it("has a usable account fallback if the session has neither avatar nor email", () => {
    state.session = { user: {} };
    show();
    expect(screen.getByTitle("Account")).toHaveAttribute("href", "/logout");
  });
  it.each([
    "Anime List",
    "Manga List",
    "Anime Collection",
    "Manga Collection",
    "About",
    "Log in",
  ])("closes mobile navigation after choosing %s", async (label) => {
    state.mobile = true;
    state.path = "/collection/anime";
    show();
    const menuIcon = screen.getByTestId("MenuIcon");
    fireEvent.click(menuIcon.closest("button") as HTMLButtonElement);
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: label }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: label }),
      ).not.toBeInTheDocument(),
    );
  });
  it("provides mobile account destinations and invokes the logout action", async () => {
    state.mobile = true;
    state.session = { user: { name: "Owner" } };
    show();
    fireEvent.click(
      screen.getByTestId("MenuIcon").closest("button") as HTMLButtonElement,
    );
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute(
      "href",
      "/link",
    );
    expect(screen.getByRole("link", { name: "Sync" })).toHaveAttribute(
      "href",
      "/sync",
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(state.logout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Log out" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("dismisses the mobile drawer with Escape", async () => {
    state.mobile = true;
    show();
    fireEvent.click(
      screen.getByTestId("MenuIcon").closest("button") as HTMLButtonElement,
    );
    fireEvent.keyDown(screen.getByRole("presentation"), { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Log in" }),
      ).not.toBeInTheDocument(),
    );
  });
});
