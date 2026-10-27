import type {
  CollectionCondition,
  CollectionRarity,
  MangaLanguage,
  MediaFormat,
} from "@/generated/prisma/enums";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type KitsuSearchResult = {
  kitsuId: string;
  rawId: string;
  titleTranslated: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJp: string | null;
  posterUrl: string | null;
};

export type AnimeResolvePayload = {
  kitsuId: string;
  anilistId?: number | null;
  malId?: number | null;
  titleEn?: string | null;
  titleRomaji?: string | null;
  titleJp?: string | null;
  episodeCount?: number | null;
  averageRating?: number | null;
  coverImageUrl?: string | null;
  bannerImageUrl?: string | null;
};

export type MangaResolvePayload = {
  kitsuId: string;
  anilistId?: number | null;
  malId?: number | null;
  titleEn?: string | null;
  titleRomaji?: string | null;
  titleJp?: string | null;
  chapterCount?: number | null;
  volumeCount?: number | null;
  averageRating?: number | null;
  coverImageUrl?: string | null;
};

export type AnimeCollectionItemInput = {
  animeId: string;
  rarity: CollectionRarity;
  format: MediaFormat;
  condition: CollectionCondition;
  notes?: string;
  purchasedAt?: string;
  pricePaid?: number;
  barcode?: string;
};

export type MangaCollectionItemInput = {
  mangaId: string;
  condition: CollectionCondition;
  language: MangaLanguage;
  notes?: string;
  containsSerialized: boolean;
  containsOmnibus: boolean;
  volumes: number[];
  chapters: number[];
};
