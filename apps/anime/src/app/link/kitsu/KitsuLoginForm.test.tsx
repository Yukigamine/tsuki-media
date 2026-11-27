import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KitsuLoginForm from "./KitsuLoginForm";

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
  save: vi.fn(),
  snackbar: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fakes.push }) }));
vi.mock("notistack", () => ({ enqueueSnackbar: fakes.snackbar }));
vi.mock("@/lib/actions/auth", () => ({ saveKitsuTokenAction: fakes.save }));
beforeEach(() => {
  for (const fake of Object.values(fakes)) fake.mockReset();
  fakes.save.mockResolvedValue({ ok: true });
});
function fill() {
  fireEvent.change(screen.getByLabelText(/^Kitsu username or email/), {
    target: { value: " Owner " },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "test-password" },
  });
}
describe("browser Kitsu linking", () => {
  it("sends credentials only to Kitsu and persists only returned token data", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        access_token: "token",
        refresh_token: "refresh",
        expires_in: 3600,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<KitsuLoginForm configuredUsername="" />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(fakes.push).toHaveBeenCalledWith("/link"));
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://kitsu.app/api/oauth/token");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(options.body.get("grant_type")).toBe("password");
    expect(options.body.get("username")).toBe(" Owner ");
    expect(options.body.get("password")).toBe("test-password");
    expect(fakes.save).toHaveBeenCalledWith({
      accessToken: "token",
      refreshToken: "refresh",
      expiresIn: 3600,
      fallbackUsername: "Owner",
    });
    expect(fakes.snackbar).toHaveBeenCalledWith(
      "Kitsu account linked successfully.",
      { variant: "success" },
    );
  });
  it("prevents duplicate submission while the provider is responding and supports absent refresh tokens", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    render(<KitsuLoginForm configuredUsername="Owner" />);
    expect(screen.getByLabelText(/^Kitsu username or email/)).toBeDisabled();
    expect(
      screen.getByText("Pre-filled from server configuration"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText(/^Password/)).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
    resolve(Response.json({ access_token: "token", expires_in: 20 }));
    await waitFor(() =>
      expect(fakes.save).toHaveBeenCalledWith({
        accessToken: "token",
        refreshToken: null,
        expiresIn: 20,
        fallbackUsername: "Owner",
      }),
    );
  });
  it("rejects a configured-account change before contacting the provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<KitsuLoginForm configuredUsername="Owner" />);
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "test" },
    });
    rerender(<KitsuLoginForm configuredUsername="Another" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(fakes.snackbar).toHaveBeenCalledWith(
        expect.stringContaining('configured for "Another"'),
        { variant: "error" },
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(fakes.save).not.toHaveBeenCalled();
  });
  it.each([
    [400, { error_description: "Wrong password" }, "Wrong password"],
    [401, { error: "invalid_grant" }, "invalid_grant"],
    [503, {}, "Kitsu login failed (503)"],
    [200, {}, "Kitsu login failed (200)"],
  ])(
    "reports provider rejection %s without storing an absent token",
    async (status, payload, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json(payload, { status })),
      );
      render(<KitsuLoginForm configuredUsername="" />);
      fill();
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() =>
        expect(fakes.snackbar).toHaveBeenCalledWith(message, {
          variant: "error",
        }),
      );
      expect(fakes.save).not.toHaveBeenCalled();
      expect(fakes.push).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    },
  );
  it("surfaces app token validation errors without navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ access_token: "token", expires_in: 20 }),
        ),
    );
    fakes.save.mockResolvedValue({ ok: false, error: "Wrong account" });
    render(<KitsuLoginForm configuredUsername="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(fakes.snackbar).toHaveBeenCalledWith("Wrong account", {
        variant: "error",
      }),
    );
    expect(fakes.push).not.toHaveBeenCalled();
  });
  it("restores controls after browser/network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    render(<KitsuLoginForm configuredUsername="" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(fakes.snackbar).toHaveBeenCalledWith(
        expect.stringContaining("CORS/network"),
        { variant: "error" },
      ),
    );
    expect(screen.getByLabelText(/^Password/)).toBeEnabled();
    expect(fakes.save).not.toHaveBeenCalled();
  });
});
