"use server";

import {
  deleteInvalidEntriesAction as deleteInvalidEntriesActionImpl,
  findInvalidEntriesAction as findInvalidEntriesActionImpl,
  getSyncStatusAction as getSyncStatusActionImpl,
  normalizeInvalidRatingsAction as normalizeInvalidRatingsActionImpl,
  triggerSyncAction as triggerSyncActionImpl,
} from "./actions/sync";
import type { SyncDirection, SyncProvider } from "./actions/types";

export async function triggerSyncAction(
  provider: SyncProvider,
  direction: SyncDirection,
) {
  return triggerSyncActionImpl(provider, direction);
}

export async function getSyncStatusAction() {
  return getSyncStatusActionImpl();
}

export async function findInvalidEntriesAction() {
  return findInvalidEntriesActionImpl();
}

export async function deleteInvalidEntriesAction(
  animeIds: string[],
  mangaIds: string[],
) {
  return deleteInvalidEntriesActionImpl(animeIds, mangaIds);
}

export async function normalizeInvalidRatingsAction() {
  return normalizeInvalidRatingsActionImpl();
}
