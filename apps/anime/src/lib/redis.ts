import "server-only";
import { createClient } from "redis";

let redis: ReturnType<typeof createClient> | undefined;
let connectPromise: Promise<ReturnType<typeof createClient>> | undefined;

async function getRedis() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not configured");
  if (redis && !redis.isOpen) {
    redis = undefined;
    connectPromise = undefined;
  }
  if (!redis) {
    redis = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 5000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    redis.on("error", (err) => console.error("[redis] error:", err));
    connectPromise = redis.connect();
  }

  try {
    await connectPromise;
  } catch (err) {
    redis = undefined;
    connectPromise = undefined;
    throw err;
  }
  return redis;
}

// ─── Key namespaces ───────────────────────────────────────────────────────────
// All KV keys follow: {type}:{category}:{id|status|query}
// e.g.  anime:list:WATCHING   manga:series:berserk   anime:search:naruto

export const ANIME_LIST_KEY = "anime:list";
export const MANGA_LIST_KEY = "manga:list";
export const ANIME_TITLE_KEY = "anime:title";
export const MANGA_TITLE_KEY = "manga:title";

// ─── TTLs ─────────────────────────────────────────────────────────────────────

export const LIST_TTL = 60 * 60 * 24; // Writes invalidate the shared library.
export const TITLE_TTL = 60 * 60 * 24;

// ─── Primitives ───────────────────────────────────────────────────────────────

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const r = await getRedis();
    const data = await r.get(key);
    return data ? (JSON.parse(data) as T) : null;
  } catch (err) {
    console.error(`[cache] Failed to get ${key}:`, err);
    return null;
  }
}

export async function setCached<T>(
  key: string,
  value: T,
  ttl: number,
): Promise<void> {
  try {
    const r = await getRedis();
    await r.setEx(key, ttl, JSON.stringify(value));
  } catch (err) {
    console.error(`[cache] Failed to set ${key}:`, err);
    // Cache writes are best-effort
  }
}

export async function deleteCached(key: string): Promise<void> {
  try {
    const r = await getRedis();
    await r.del(key);
  } catch (err) {
    console.error(`[cache] Failed to delete ${key}:`, err);
  }
}

const LIBRARY_KEY = "library:v1:all";
const LIBRARY_REVISION_KEY = "library:v1:revision";

export async function getLibraryRevision(): Promise<string | null> {
  try {
    return (await (await getRedis()).get(LIBRARY_REVISION_KEY)) ?? "0";
  } catch (err) {
    console.error("[cache] Failed to read library revision:", err);
    return null;
  }
}

export async function cacheLibrary(
  value: unknown,
  revision: string,
): Promise<void> {
  try {
    const r = await getRedis();
    // An edit during a cold-cache rebuild must not publish an outdated snapshot.
    await r.eval(
      `if (redis.call('GET', KEYS[1]) or '0') == ARGV[1] then
        return redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
      end
      return nil`,
      {
        keys: [LIBRARY_REVISION_KEY, LIBRARY_KEY],
        arguments: [revision, JSON.stringify(value), String(LIST_TTL)],
      },
    );
  } catch (err) {
    console.error("[cache] Failed to cache library:", err);
  }
}

async function invalidateLibraryCache(): Promise<void> {
  try {
    const r = await getRedis();
    await r.multi().incr(LIBRARY_REVISION_KEY).del(LIBRARY_KEY).exec();
  } catch (err) {
    console.error("[cache] Failed to invalidate library:", err);
  }
}

async function invalidateByPrefix(prefix: string): Promise<void> {
  try {
    const r = await getRedis();
    const keys = await r.keys(`${prefix}:*`);
    if (keys.length > 0) await r.del(keys);
  } catch (err) {
    console.error(`[cache] Failed to invalidate prefix ${prefix}:`, err);
  }
}

// ─── Invalidation ────────────────────────────────────────────────────────────

export async function invalidateAnimeListCache(): Promise<void> {
  await invalidateLibraryCache();
  await invalidateByPrefix(ANIME_LIST_KEY);
}

export async function invalidateMangaListCache(): Promise<void> {
  await invalidateLibraryCache();
  await invalidateByPrefix(MANGA_LIST_KEY);
}

export async function invalidateAnimeTitleCache(
  id: string,
  kitsuId: string | null,
): Promise<void> {
  await invalidateLibraryCache();
  await Promise.all(
    [id, kitsuId]
      .filter((identifier): identifier is string => identifier !== null)
      .map((identifier) => deleteCached(`${ANIME_TITLE_KEY}:${identifier}`)),
  );
}

export async function invalidateMangaTitleCache(
  id: string,
  kitsuId: string | null,
): Promise<void> {
  await invalidateLibraryCache();
  await Promise.all(
    [id, kitsuId]
      .filter((identifier): identifier is string => identifier !== null)
      .map((identifier) => deleteCached(`${MANGA_TITLE_KEY}:${identifier}`)),
  );
}

/** Invalidates both anime and manga list caches (use after a full sync). */
export async function invalidateListCache(): Promise<void> {
  await invalidateLibraryCache();
  await Promise.all([
    invalidateByPrefix(ANIME_LIST_KEY),
    invalidateByPrefix(MANGA_LIST_KEY),
  ]);
}
