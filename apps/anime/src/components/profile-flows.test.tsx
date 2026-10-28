import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KitsuFavoriteItem,
  KitsuUserProfile,
} from "@/lib/kitsu/user-types";
import LogoutForm from "./LogoutForm";
import UserFavorites from "./UserFavorites";
import UserProfileContent from "./UserProfileContent";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  toast: vi.fn(),
  logout: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/hooks/useKitsuProfile", () => ({
  useKitsuProfile: mocks.profile,
}));
vi.mock("notistack", () => ({ enqueueSnackbar: mocks.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/lib/actions/auth", () => ({ logoutAppAction: mocks.logout }));
const emptyFavorites = () => ({
  anime: [],
  manga: [],
  character: [],
  person: [],
});
const favorite = (
  name: string,
  type: KitsuFavoriteItem["type"] = "anime",
  imageUrl: string | null = null,
): KitsuFavoriteItem => ({
  id: name,
  slug: name.toLowerCase(),
  name,
  type,
  imageUrl,
});
const profile = (extra: Partial<KitsuUserProfile> = {}): KitsuUserProfile => ({
  slug: "test",
  name: "Test User",
  about: null,
  avatarUrl: null,
  bannerUrl: null,
  birthday: null,
  createdAt: "2020-01-01",
  gender: null,
  location: null,
  waifu: null,
  stats: {
    animeTimeSecs: null,
    animeCompleted: null,
    animeEpisodes: null,
    mangaCompleted: null,
    mangaChapters: null,
  },
  favorites: emptyFavorites(),
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockReturnValue({
    data: profile(),
    error: null,
    isLoading: false,
  });
});
describe("profile loading and summaries", () => {
  it("renders loading placeholders instead of stale profile data", () => {
    mocks.profile.mockReturnValue({
      data: profile(),
      error: null,
      isLoading: true,
    });
    const { container } = render(<UserProfileContent username="test" />);
    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll(".MuiSkeleton-root").length,
    ).toBeGreaterThan(10);
    expect(mocks.profile).toHaveBeenCalledWith("test");
  });
  it("reports provider failure without presenting it as a missing user", () => {
    mocks.profile.mockReturnValue({
      data: null,
      error: new Error("HTTP 503"),
      isLoading: false,
    });
    render(<UserProfileContent username="test" />);
    expect(screen.getByText("Unable to load profile")).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(
      "Failed to load profile: HTTP 503",
      { variant: "error" },
    );
  });
  it("distinguishes an absent profile", () => {
    mocks.profile.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    });
    render(<UserProfileContent username="missing" />);
    expect(screen.getByText("Profile not found")).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("omits unavailable optional profile fields and statistics", () => {
    render(
      <UserProfileContent
        username="test"
        profileSummary={{
          animeOwned: 0,
          mangaVolumesOwned: 0,
          mangaChaptersOwned: 0,
          favoriteGenres: [],
        }}
      />,
    );
    expect(screen.getByText("No favorites listed.")).toBeInTheDocument();
    expect(screen.queryByText("User Stats")).not.toBeInTheDocument();
    expect(screen.queryByText("Manga Owned")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("joins profile, local collection counts and escaped provider links", () => {
    mocks.profile.mockReturnValue({
      data: profile({
        about: "About me",
        birthday: "2000-01-01",
        gender: "Other",
        location: "Tokyo",
        avatarUrl: "https://images.test/avatar.png",
        bannerUrl: "https://images.test/banner.png",
        waifu: {
          name: "Hero",
          label: "Favorite character",
          slug: "hero",
          imageUrl: "https://images.test/hero.png",
        },
        stats: {
          animeTimeSecs: 3600,
          animeCompleted: 0,
          animeEpisodes: 12,
          mangaCompleted: 2,
          mangaChapters: 100,
        },
        favorites: { ...emptyFavorites(), anime: [favorite("Alpha")] },
      }),
      error: null,
      isLoading: false,
    });
    render(
      <UserProfileContent
        username="test"
        linkedAccounts={{ kitsu: "a/b", anilist: "a b" }}
        profileSummary={{
          animeOwned: 12,
          mangaVolumesOwned: 3,
          mangaChaptersOwned: 9,
          favoriteGenres: ["Drama", "Comedy"],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Kitsu: @a/b" })).toHaveAttribute(
      "href",
      "https://kitsu.app/users/a%2Fb",
    );
    expect(screen.getByRole("link", { name: "AniList: @a b" })).toHaveAttribute(
      "href",
      "https://anilist.co/user/a%20b",
    );
    for (const text of [
      "About me",
      "Tokyo",
      "3 volumes · 9 chapters",
      "Drama, Comedy",
      "1 hr",
      "User Stats",
      "Anime Completed",
      "Chapters read",
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Profile banner" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hero" })).toHaveAttribute(
      "href",
      "https://kitsu.app/characters/hero",
    );
  });
  it("supports manga-only statistics and a character without an image", () => {
    mocks.profile.mockReturnValue({
      data: profile({
        waifu: { name: "Hero", label: "Waifu", slug: "hero", imageUrl: null },
        stats: {
          animeTimeSecs: null,
          animeCompleted: null,
          animeEpisodes: null,
          mangaCompleted: 3,
          mangaChapters: null,
        },
      }),
      isLoading: false,
      error: null,
    });
    render(
      <UserProfileContent
        username="test"
        linkedAccounts={{ kitsu: null, anilist: null }}
        profileSummary={{
          animeOwned: 0,
          mangaVolumesOwned: 2,
          mangaChaptersOwned: 0,
          favoriteGenres: [],
        }}
      />,
    );
    expect(screen.getByText("2 volumes")).toBeInTheDocument();
    expect(screen.getByText("Manga Completed")).toBeInTheDocument();
    expect(screen.queryByText("Time watching")).not.toBeInTheDocument();
  });
});
describe("favorites navigation", () => {
  it("renders nothing when all favorite lists are empty", () => {
    const { container } = render(
      <UserFavorites favorites={emptyFavorites()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("sorts favorites without mutating input and switches all supported categories", () => {
    const anime = [
      favorite("Zulu"),
      favorite("Alpha", "anime", "https://images.test/alpha.png"),
    ];
    render(
      <UserFavorites
        favorites={{
          anime,
          manga: [favorite("Manga", "manga")],
          character: [favorite("Hero", "character")],
          person: [favorite("Artist", "person")],
        }}
      />,
    );
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["Alpha", "No imageZulu"],
    );
    expect(anime.map((item) => item.name)).toEqual(["Zulu", "Alpha"]);
    for (const [tab, name, base] of [
      ["Manga (1)", "Manga", "manga"],
      ["Characters (1)", "Hero", "characters"],
      ["People (1)", "Artist", "people"],
    ]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(
        screen.getByRole("link", { name: `No image ${name}` }),
      ).toHaveAttribute(
        "href",
        `https://kitsu.app/${base}/${name.toLowerCase()}`,
      );
    }
  });
  it("selects the first nonempty category when anime is absent", () => {
    render(
      <UserFavorites
        favorites={{
          ...emptyFavorites(),
          person: [favorite("Artist", "person")],
        }}
      />,
    );
    expect(screen.getByRole("tab", { name: "People (1)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
const user = {
  id: "u",
  name: "Test User",
  email: "test@example.test",
  emailVerified: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
describe("logout flow", () => {
  it("cancels through browser history without signing out", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<LogoutForm user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(back).toHaveBeenCalledOnce();
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it("disables repeat actions while awaiting logout and routes only on success", async () => {
    let resolve!: (value: { ok: boolean }) => void;
    mocks.logout.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<LogoutForm user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(
      screen.getByRole("button", { name: "Logging out..." }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    resolve({ ok: true });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/login"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("stays on the page when logout reports failure and allows retry", async () => {
    mocks.logout.mockResolvedValue({ ok: false });
    render(<LogoutForm user={{ ...user, email: "" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled(),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  });
});
