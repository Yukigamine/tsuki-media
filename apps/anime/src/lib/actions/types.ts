export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type SyncProvider = "KITSU" | "ANILIST";
export type SyncDirection = "PULL" | "PUSH";
