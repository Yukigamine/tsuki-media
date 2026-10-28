import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginForm, { type LoginProvider } from "./LoginForm";

const state = vi.hoisted(() => ({ query: "", signIn: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/lib/betterauth-client", () => ({
  authClient: { signIn: { social: state.signIn } },
}));
const provider = (
  id: string,
  iconUrl: string | null = null,
): LoginProvider => ({
  id,
  label: id === "oauth" ? "My Identity" : id,
  color: "#123456",
  svg: '<svg data-testid="untrusted-svg"></svg>',
  iconUrl,
});
beforeEach(() => {
  state.query = "";
  state.signIn.mockReset();
});
afterEach(cleanup);

describe("sign-in provider flow", () => {
  it("shows a configuration warning when no providers are enabled", () => {
    render(<LoginForm providers={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No OAuth providers are configured",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an unauthorized error only for the authorization error code", () => {
    state.query = "error=unauthorized";
    const { rerender } = render(<LoginForm providers={[provider("oauth")]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("not authorized");
    state.query = "error=other";
    rerender(<LoginForm providers={[provider("oauth")]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses Better Auth's supported social endpoint for custom OAuth and prevents duplicate submissions", async () => {
    let resolve!: (value: { error: null }) => void;
    state.signIn.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<LoginForm providers={[provider("oauth"), provider("google")]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with My Identity" }),
    );
    expect(state.signIn).toHaveBeenCalledExactlyOnceWith({
      provider: "oauth",
      callbackURL: "/",
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with google" }),
    );
    expect(state.signIn).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ error: null });
    });
  });

  it.each(["returned", "thrown"])(
    "re-enables provider buttons after a %s SDK error",
    async (kind) => {
      if (kind === "returned")
        state.signIn.mockResolvedValue({ error: { message: "Denied" } });
      else state.signIn.mockRejectedValue(new Error("SDK failed"));
      render(<LoginForm providers={[provider("github")]} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with github" }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Continue with github" }),
        ).toBeEnabled(),
      );
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with github" }),
      );
      await waitFor(() => expect(state.signIn).toHaveBeenCalledTimes(2));
    },
  );

  it("renders configured image, built-in SVG and generic icon without injecting supplied SVG", () => {
    render(
      <LoginForm
        providers={[
          provider("oauth", "https://example.invalid/icon.png"),
          provider("google"),
          provider("discord"),
          provider("github"),
          provider("twitter"),
          provider("custom"),
        ]}
      />,
    );
    expect(
      document.querySelector('img[src="https://example.invalid/icon.png"]'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.queryByTestId("untrusted-svg")).not.toBeInTheDocument();
    expect(screen.getByTestId("LanguageIcon")).toBeInTheDocument();
  });
});
