import "@testing-library/jest-dom/vitest";
import { useTheme } from "@mui/material";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSnackbar } from "notistack";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import Providers from "./Providers";

const boundary = vi.hoisted(() => ({ swUrl: vi.fn() }));
// Framework browser registration and server style insertion are integration boundaries;
// actual MUI theme, SWR and snackbar contexts remain active below.
vi.mock("@serwist/turbopack/react", () => ({
  SerwistProvider: ({
    swUrl,
    children,
  }: {
    swUrl: string;
    children: ReactNode;
  }) => {
    boundary.swUrl(swUrl);
    return children;
  },
}));
vi.mock("@mui/material-nextjs/v16-appRouter", () => ({
  AppRouterCacheProvider: ({ children }: { children: ReactNode }) => children,
}));
function Consumer() {
  const variant = "success";
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  return (
    <button
      type="button"
      onClick={() =>
        enqueueSnackbar(`${variant} message`, { variant, persist: true })
      }
    >
      Notify {theme.typography.fontFamily}
    </button>
  );
}
it("provides the app theme and a dismissible snackbar", async () => {
  const variant = "success";
  render(
    <Providers>
      <Consumer />
    </Providers>,
  );
  expect(boundary.swUrl).toHaveBeenCalledWith("/serwist/sw.js");
  const notify = screen.getByRole("button", { name: /Notify/ });
  expect(notify).toHaveTextContent("--font-fredoka");
  fireEvent.click(notify);
  const alert = await screen.findByText(`${variant} message`);
  const container = alert.closest("[role=alert]");
  expect(container).not.toBeNull();
  fireEvent.click(within(container as HTMLElement).getByRole("button"));
  await waitFor(
    () =>
      expect(screen.queryByText(`${variant} message`)).not.toBeInTheDocument(),
    { timeout: 5000 },
  );
});
