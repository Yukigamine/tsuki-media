import { describe, expect, it } from "vitest";
import {
  getGenreChipSx,
  resolveExternalLinkIcon,
  SocialIconKey,
} from "./detail-page";

describe("provider external link presentation", () => {
  it.each([
    ["YouTube", "", SocialIconKey.YOUTUBE],
    ["", "https://youtu.be/a", SocialIconKey.YOUTUBE],
    ["", "https://www.X.COM/a", SocialIconKey.TWITTER_X],
    ["", "https://mobile.x.com/a", SocialIconKey.TWITTER_X],
    ["Instagram", "bad-url", SocialIconKey.INSTAGRAM],
    ["Facebook", "", SocialIconKey.FACEBOOK],
    ["Reddit", "", SocialIconKey.REDDIT],
    ["Twitch", "", SocialIconKey.TWITCH],
    ["TikTok", "", SocialIconKey.TIKTOK],
    ["Crunchyroll", "", SocialIconKey.CRUNCHYROLL],
    ["Hulu", "", SocialIconKey.HULU],
    ["Netflix", "", SocialIconKey.NETFLIX],
    ["Official Website", "not a url", SocialIconKey.WEBSITE],
    ["Homepage", "", SocialIconKey.WEBSITE],
    ["Other", "https://x.com.evil.test", SocialIconKey.GLOBE],
    ["Other", "invalid", SocialIconKey.GLOBE],
  ])("renders %s %s with the matching service icon", (site, url, expected) => {
    expect(resolveExternalLinkIcon(site, url)).toBe(expected);
  });
});
describe("genre chip colors", () => {
  it("normalizes known and unfamiliar genres without dropping label readability styles", () => {
    expect(getGenreChipSx("  ACTION ")).toEqual(getGenreChipSx("Action"));
    expect(getGenreChipSx("Action")).toMatchObject({
      backgroundColor: expect.stringMatching(/^#[a-f0-9]{6}$/),
      borderColor: expect.stringMatching(/^#[a-f0-9]{6}$/),
      color: expect.stringMatching(/^#[a-f0-9]{6}$/),
      "& .MuiChip-label": { fontWeight: expect.any(Number) },
    });
    expect(getGenreChipSx(" Slice of Life ")).not.toEqual(
      getGenreChipSx("Action"),
    );
    expect(
      getGenreChipSx(
        "a very long unfamiliar genre name causing integer overflow",
      ),
    ).toEqual(
      getGenreChipSx(
        " A VERY LONG UNFAMILIAR GENRE NAME CAUSING INTEGER OVERFLOW ",
      ),
    );
    expect(getGenreChipSx("")).toMatchObject({
      backgroundColor: expect.stringMatching(/^#[a-f0-9]{6}$/),
      color: expect.stringMatching(/^#[a-f0-9]{6}$/),
    });
  });
});
