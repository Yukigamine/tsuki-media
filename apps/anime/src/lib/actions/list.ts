"use server";

import {
  resolveAnimeId as resolveAnimeIdImpl,
  resolveMangaId as resolveMangaIdImpl,
} from "./collection/crud";
import type {
  AnimeResolvePayload,
  MangaResolvePayload,
} from "./collection/types";
import {
  applyAnimeQuickStatus as applyAnimeQuickStatusImpl,
  applyMangaQuickStatus as applyMangaQuickStatusImpl,
  removeAnimeListEntry as removeAnimeListEntryImpl,
  removeMangaListEntry as removeMangaListEntryImpl,
  startAnimeRewatch as startAnimeRewatchImpl,
  startMangaReread as startMangaRereadImpl,
  upsertAnimeListEntry as upsertAnimeListEntryImpl,
  upsertMangaListEntry as upsertMangaListEntryImpl,
} from "./list/crud";
import type {
  ActionResult,
  AnimeListUpsertInput,
  AnimeQuickStatusInput,
  MangaListUpsertInput,
  MangaQuickStatusInput,
} from "./list/types";

export async function upsertAnimeListEntry(
  input: AnimeListUpsertInput,
): Promise<ActionResult<{ id: string }>> {
  return upsertAnimeListEntryImpl(input);
}

export async function upsertMangaListEntry(
  input: MangaListUpsertInput,
): Promise<ActionResult<{ id: string }>> {
  return upsertMangaListEntryImpl(input);
}

export async function applyAnimeQuickStatus(
  input: AnimeQuickStatusInput,
): Promise<ActionResult<{ id: string }>> {
  return applyAnimeQuickStatusImpl(input);
}

export async function applyMangaQuickStatus(
  input: MangaQuickStatusInput,
): Promise<ActionResult<{ id: string }>> {
  return applyMangaQuickStatusImpl(input);
}

export async function resolveAndApplyAnimeQuickStatus(
  payload: AnimeResolvePayload,
  watchStatus: AnimeQuickStatusInput["watchStatus"],
): Promise<ActionResult<{ id: string }>> {
  const resolved = await resolveAnimeIdImpl(payload);
  if (!resolved.ok) return resolved;
  return applyAnimeQuickStatusImpl({ animeId: resolved.data, watchStatus });
}

export async function resolveAndApplyMangaQuickStatus(
  payload: MangaResolvePayload,
  readStatus: MangaQuickStatusInput["readStatus"],
): Promise<ActionResult<{ id: string }>> {
  const resolved = await resolveMangaIdImpl(payload);
  if (!resolved.ok) return resolved;
  return applyMangaQuickStatusImpl({ mangaId: resolved.data, readStatus });
}

export async function startAnimeRewatch(
  animeId: string,
): Promise<ActionResult<{ id: string }>> {
  return startAnimeRewatchImpl(animeId);
}

export async function startMangaReread(
  mangaId: string,
): Promise<ActionResult<{ id: string }>> {
  return startMangaRereadImpl(mangaId);
}

export async function removeAnimeListEntry(
  animeId: string,
): Promise<ActionResult> {
  return removeAnimeListEntryImpl(animeId);
}

export async function removeMangaListEntry(
  mangaId: string,
): Promise<ActionResult> {
  return removeMangaListEntryImpl(mangaId);
}
