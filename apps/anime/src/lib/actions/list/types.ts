import type { ReadStatus, WatchStatus } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/actions/types";

export type { ActionResult };

export type AnimeListUpsertInput = {
  animeId: string;
  watchStatus?: WatchStatus;
  progress?: number;
  rating?: number | null;
  notes?: string | null;
  rewatchCount?: number;
  rewatching?: boolean;
};

export type MangaListUpsertInput = {
  mangaId: string;
  readStatus?: ReadStatus;
  progress?: number;
  progressVolumes?: number;
  rating?: number | null;
  notes?: string | null;
  rereadCount?: number;
  rereading?: boolean;
};

export type AnimeQuickStatusInput = {
  animeId: string;
  watchStatus: WatchStatus;
};

export type MangaQuickStatusInput = {
  mangaId: string;
  readStatus: ReadStatus;
};
