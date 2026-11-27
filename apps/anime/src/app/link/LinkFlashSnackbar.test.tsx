import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LinkFlashSnackbar from "./LinkFlashSnackbar";

const snackbar = vi.hoisted(() => vi.fn());
vi.mock("notistack", () => ({ enqueueSnackbar: snackbar }));
let cookie = "";
beforeEach(() => {
  snackbar.mockClear();
  sessionStorage.clear();
  cookie = "";
  vi.spyOn(document, "cookie", "get").mockImplementation(() => cookie);
});
describe("link success flash", () => {
  it("does nothing without its cookie", () => {
    render(<LinkFlashSnackbar />);
    expect(snackbar).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("link_success_seen")).toBeNull();
  });
  it("decodes the success cookie among unrelated cookies and deduplicates across remounts", () => {
    cookie = "another=value; link_success=%61nilist";
    const { unmount } = render(<LinkFlashSnackbar />);
    expect(snackbar).toHaveBeenCalledWith(
      "AniList account linked successfully.",
      { variant: "success" },
    );
    unmount();
    render(<LinkFlashSnackbar />);
    expect(snackbar).toHaveBeenCalledTimes(1);
  });
  it("does not expose unknown provider text as a notification", () => {
    cookie = "link_success=unknown-provider";
    render(<LinkFlashSnackbar />);
    expect(snackbar).not.toHaveBeenCalled();
  });
  it("recognizes the provider independent of case", () => {
    cookie = "link_success=ANILIST";
    render(<LinkFlashSnackbar />);
    expect(snackbar).toHaveBeenCalledTimes(1);
  });
});
