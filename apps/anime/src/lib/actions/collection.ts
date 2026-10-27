"use server";

import {
  addAnimeCollectionItem as addAnimeCollectionItemImpl,
  addMangaCollectionItem as addMangaCollectionItemImpl,
  deleteAnimeCollectionItem as deleteAnimeCollectionItemImpl,
  deleteMangaCollectionItem as deleteMangaCollectionItemImpl,
  editAnimeCollectionItem as editAnimeCollectionItemImpl,
  editMangaCollectionItem as editMangaCollectionItemImpl,
  resolveAnimeId as resolveAnimeIdImpl,
  resolveMangaId as resolveMangaIdImpl,
} from "./collection/crud";
import type {
  ActionResult,
  AnimeCollectionItemInput,
  AnimeResolvePayload,
  MangaCollectionItemInput,
  MangaResolvePayload,
} from "./collection/types";

export async function addAnimeCollectionItem(
  input: AnimeCollectionItemInput,
): Promise<ActionResult<{ id: string }>> {
  return addAnimeCollectionItemImpl(input);
}

export async function editAnimeCollectionItem(
  id: string,
  input: Omit<AnimeCollectionItemInput, "animeId">,
): Promise<ActionResult> {
  return editAnimeCollectionItemImpl(id, input);
}

export async function deleteAnimeCollectionItem(
  id: string,
): Promise<ActionResult> {
  return deleteAnimeCollectionItemImpl(id);
}

export async function addMangaCollectionItem(
  input: MangaCollectionItemInput,
): Promise<ActionResult<{ id: string }>> {
  return addMangaCollectionItemImpl(input);
}

export async function editMangaCollectionItem(
  id: string,
  input: Omit<MangaCollectionItemInput, "mangaId">,
  totalVolumes: number | null,
  totalChapters: number | null,
): Promise<ActionResult> {
  return editMangaCollectionItemImpl(id, input, totalVolumes, totalChapters);
}

export async function deleteMangaCollectionItem(
  id: string,
): Promise<ActionResult> {
  return deleteMangaCollectionItemImpl(id);
}

export async function resolveAnimeId(
  payload: AnimeResolvePayload,
): Promise<ActionResult<string>> {
  return resolveAnimeIdImpl(payload);
}

export async function resolveMangaId(
  payload: MangaResolvePayload,
): Promise<ActionResult<string>> {
  return resolveMangaIdImpl(payload);
}
