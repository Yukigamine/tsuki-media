import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageFromBirthday,
  formatProfileDate,
  formatWatchTime,
} from "./user-types";

afterEach(() => vi.useRealTimers());
describe("profile formatting", () => {
  it.each([
    [0, "0 sec"],
    [59, "59 sec"],
    [60, "1 min"],
    [3599, "59 min"],
    [3600, "1 hr"],
    [86399, "23 hr"],
    [86400, "1 day"],
    [172800, "2 days"],
    [31536000, "1 yr"],
    [31622400, "1 yr 1 day"],
    [63244800, "2 yrs 2 days"],
  ])("formats %i seconds", (seconds, expected) =>
    expect(formatWatchTime(seconds)).toBe(expected),
  );
  it("formats a stable calendar date", () =>
    expect(formatProfileDate("2024-02-29T12:00:00")).toBe("February 29, 2024"));
  it("adjusts ages around the birthday in the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12));
    expect(ageFromBirthday("2000-06-11T12:00:00")).toBe(25);
    expect(ageFromBirthday("2000-06-10T12:00:00")).toBe(26);
    expect(ageFromBirthday("2000-07-01T12:00:00")).toBe(25);
    expect(ageFromBirthday("2000-05-01T12:00:00")).toBe(26);
  });
});
