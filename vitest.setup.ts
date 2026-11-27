import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Tests must opt into an explicit fake rather than contacting a live provider.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error(
        "Unexpected network request: provide a test-local fetch fake",
      );
    }),
  );
});

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
  vi.useRealTimers();
});
