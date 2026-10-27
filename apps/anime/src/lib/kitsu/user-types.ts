export interface KitsuFavoriteItem {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  type: "anime" | "manga" | "character" | "person";
}

export interface KitsuUserProfile {
  slug: string;
  name: string;
  about: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  birthday: string | null;
  createdAt: string;
  gender: string | null;
  location: string | null;
  waifu: {
    slug: string;
    name: string;
    imageUrl: string | null;
    label: string;
  } | null;
  stats: {
    animeTimeSecs: number | null;
    animeCompleted: number | null;
    animeEpisodes: number | null;
    mangaCompleted: number | null;
    mangaChapters: number | null;
  };
  favorites: {
    anime: KitsuFavoriteItem[];
    manga: KitsuFavoriteItem[];
    character: KitsuFavoriteItem[];
    person: KitsuFavoriteItem[];
  };
}

export function formatWatchTime(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days} day${days !== 1 ? "s" : ""}`;
  const years = Math.floor(days / 365);
  const rem = days % 365;
  return rem > 0
    ? `${years} yr${years !== 1 ? "s" : ""} ${rem} day${rem !== 1 ? "s" : ""}`
    : `${years} yr${years !== 1 ? "s" : ""}`;
}

export function formatProfileDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ageFromBirthday(iso: string): number {
  const bd = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  if (
    now.getMonth() < bd.getMonth() ||
    (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())
  )
    age--;
  return age;
}
