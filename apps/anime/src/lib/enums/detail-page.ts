import type { SxProps, Theme } from "@mui/material/styles";

enum ExternalLinkType {
  YOUTUBE = "YOUTUBE",
  TWITTER_X = "TWITTER_X",
  INSTAGRAM = "INSTAGRAM",
  FACEBOOK = "FACEBOOK",
  REDDIT = "REDDIT",
  TWITCH = "TWITCH",
  TIKTOK = "TIKTOK",
  CRUNCHYROLL = "CRUNCHYROLL",
  HULU = "HULU",
  NETFLIX = "NETFLIX",
  WEBSITE = "WEBSITE",
  OTHER = "OTHER",
}

export enum SocialIconKey {
  YOUTUBE = "YOUTUBE",
  TWITTER_X = "TWITTER_X",
  INSTAGRAM = "INSTAGRAM",
  FACEBOOK = "FACEBOOK",
  REDDIT = "REDDIT",
  TWITCH = "TWITCH",
  TIKTOK = "TIKTOK",
  CRUNCHYROLL = "CRUNCHYROLL",
  HULU = "HULU",
  NETFLIX = "NETFLIX",
  WEBSITE = "WEBSITE",
  GLOBE = "GLOBE",
}

type ExternalLinkIconRow = {
  type: ExternalLinkType;
  keywords: string[];
  icon: SocialIconKey;
};

const EXTERNAL_LINK_ICON_TABLE: readonly ExternalLinkIconRow[] = [
  {
    type: ExternalLinkType.YOUTUBE,
    keywords: ["youtube", "youtu.be"],
    icon: SocialIconKey.YOUTUBE,
  },
  {
    type: ExternalLinkType.TWITTER_X,
    keywords: ["twitter.com", "x.com", "twitter"],
    icon: SocialIconKey.TWITTER_X,
  },
  {
    type: ExternalLinkType.INSTAGRAM,
    keywords: ["instagram"],
    icon: SocialIconKey.INSTAGRAM,
  },
  {
    type: ExternalLinkType.FACEBOOK,
    keywords: ["facebook"],
    icon: SocialIconKey.FACEBOOK,
  },
  {
    type: ExternalLinkType.REDDIT,
    keywords: ["reddit"],
    icon: SocialIconKey.REDDIT,
  },
  {
    type: ExternalLinkType.TWITCH,
    keywords: ["twitch"],
    icon: SocialIconKey.TWITCH,
  },
  {
    type: ExternalLinkType.TIKTOK,
    keywords: ["tiktok"],
    icon: SocialIconKey.TIKTOK,
  },
  {
    type: ExternalLinkType.CRUNCHYROLL,
    keywords: ["crunchyroll"],
    icon: SocialIconKey.CRUNCHYROLL,
  },
  {
    type: ExternalLinkType.HULU,
    keywords: ["hulu"],
    icon: SocialIconKey.HULU,
  },
  {
    type: ExternalLinkType.NETFLIX,
    keywords: ["netflix"],
    icon: SocialIconKey.NETFLIX,
  },
  {
    type: ExternalLinkType.WEBSITE,
    keywords: ["official", "website", "homepage"],
    icon: SocialIconKey.WEBSITE,
  },
] as const;

export function resolveExternalLinkIcon(
  site: string,
  url: string,
): SocialIconKey {
  const normalizedSite = site.toLowerCase();
  const normalizedUrl = url.toLowerCase();
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Fall back to site-name matching for non-URL values.
  }

  for (const row of EXTERNAL_LINK_ICON_TABLE) {
    if (
      row.keywords.some((keyword) => {
        const normalizedKeyword = keyword.toLowerCase();
        if (normalizedKeyword.includes(".")) {
          return (
            hostname === normalizedKeyword ||
            hostname.endsWith(`.${normalizedKeyword}`)
          );
        }
        return (
          normalizedSite.includes(normalizedKeyword) ||
          normalizedUrl.includes(normalizedKeyword)
        );
      })
    ) {
      return row.icon;
    }
  }

  return SocialIconKey.GLOBE;
}

enum GenreColorToken {
  COBALT = "COBALT",
  CRIMSON = "CRIMSON",
  EMERALD = "EMERALD",
  AMBER = "AMBER",
  VIOLET = "VIOLET",
  TEAL = "TEAL",
  INDIGO = "INDIGO",
  ROSE = "ROSE",
  ORANGE = "ORANGE",
}

type GenreColorRow = {
  genre: string;
  token: GenreColorToken;
};

const GENRE_COLOR_TABLE: readonly GenreColorRow[] = [
  { genre: "Action", token: GenreColorToken.CRIMSON },
  { genre: "Adventure", token: GenreColorToken.COBALT },
  { genre: "Comedy", token: GenreColorToken.AMBER },
  { genre: "Drama", token: GenreColorToken.INDIGO },
  { genre: "Ecchi", token: GenreColorToken.ROSE },
  { genre: "Fantasy", token: GenreColorToken.VIOLET },
  { genre: "Horror", token: GenreColorToken.ORANGE },
  { genre: "Mahou Shoujo", token: GenreColorToken.TEAL },
  { genre: "Mecha", token: GenreColorToken.COBALT },
  { genre: "Music", token: GenreColorToken.TEAL },
  { genre: "Mystery", token: GenreColorToken.INDIGO },
  { genre: "Psychological", token: GenreColorToken.VIOLET },
  { genre: "Romance", token: GenreColorToken.ROSE },
  { genre: "Sci-Fi", token: GenreColorToken.TEAL },
  { genre: "Slice of Life", token: GenreColorToken.EMERALD },
  { genre: "Sports", token: GenreColorToken.ORANGE },
  { genre: "Supernatural", token: GenreColorToken.VIOLET },
  { genre: "Thriller", token: GenreColorToken.CRIMSON },
] as const;

const GENRE_COLOR_STYLES: Record<
  GenreColorToken,
  { bg: string; border: string; text: string }
> = {
  [GenreColorToken.COBALT]: {
    bg: "#e8f0ff",
    border: "#7aa2ff",
    text: "#1f3a82",
  },
  [GenreColorToken.CRIMSON]: {
    bg: "#ffe8ed",
    border: "#ff86a2",
    text: "#8f1e3f",
  },
  [GenreColorToken.EMERALD]: {
    bg: "#e7f9ef",
    border: "#6dcf95",
    text: "#1f6d46",
  },
  [GenreColorToken.AMBER]: {
    bg: "#fff5e2",
    border: "#f3b559",
    text: "#8a5a11",
  },
  [GenreColorToken.VIOLET]: {
    bg: "#f3ebff",
    border: "#b68cff",
    text: "#5d3c94",
  },
  [GenreColorToken.TEAL]: { bg: "#e6faf9", border: "#67d0ca", text: "#1b6a66" },
  [GenreColorToken.INDIGO]: {
    bg: "#ecefff",
    border: "#8e9cff",
    text: "#2f3f92",
  },
  [GenreColorToken.ROSE]: { bg: "#ffeef5", border: "#ff9ac6", text: "#8f2f5e" },
  [GenreColorToken.ORANGE]: {
    bg: "#fff0e6",
    border: "#ffa96f",
    text: "#8a4a1d",
  },
};

const GENRE_FALLBACK_SEQUENCE = Object.values(GenreColorToken);

function resolveGenreColorToken(genre: string): GenreColorToken {
  const normalized = genre.trim().toLowerCase();
  const match = GENRE_COLOR_TABLE.find(
    (row) => row.genre.toLowerCase() === normalized,
  );

  if (match) return match.token;

  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }

  return GENRE_FALLBACK_SEQUENCE[
    Math.abs(hash) % GENRE_FALLBACK_SEQUENCE.length
  ];
}

export function getGenreChipSx(genre: string): SxProps<Theme> {
  const token = resolveGenreColorToken(genre);
  const style = GENRE_COLOR_STYLES[token];

  return {
    backgroundColor: style.bg,
    borderColor: style.border,
    color: style.text,
    "& .MuiChip-label": {
      fontWeight: 600,
    },
  };
}
