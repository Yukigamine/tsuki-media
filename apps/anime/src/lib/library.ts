import "server-only";
import { cache } from "react";
import prisma from "@/lib/prisma";
import { cacheLibrary, getCached, getLibraryRevision } from "@/lib/redis";

async function loadLibrary() {
  const [anime, manga] = await Promise.all([
    prisma.anime.findMany({
      include: { listEntry: true, collectionItems: true },
      orderBy: { titleEn: "asc" },
    }),
    prisma.manga.findMany({
      include: { listEntry: true, collectionItems: true },
      orderBy: { titleEn: "asc" },
    }),
  ]);
  return { anime, manga };
}

export type LibrarySnapshot = Awaited<ReturnType<typeof loadLibrary>>;
let inFlight:
  | { revision: string | null; promise: Promise<LibrarySnapshot> }
  | undefined;

// Redis JSON has string dates; restore Prisma's Date contract for existing consumers.
function restoreDates(snapshot: LibrarySnapshot): LibrarySnapshot {
  return JSON.parse(JSON.stringify(snapshot), (key, value) =>
    [
      "createdAt",
      "updatedAt",
      "startDate",
      "endDate",
      "startedAt",
      "completedAt",
      "purchasedAt",
    ].includes(key) && typeof value === "string"
      ? new Date(value)
      : value,
  ) as LibrarySnapshot;
}

export const getLibrarySnapshot = cache(async (): Promise<LibrarySnapshot> => {
  const cached = await getCached<LibrarySnapshot>("library:v1:all");
  if (cached) return restoreDates(cached);
  const revision = await getLibraryRevision();
  if (inFlight && inFlight.revision === revision) return inFlight.promise;
  const promise = (async () => {
    const snapshot = await loadLibrary();
    if (revision !== null) await cacheLibrary(snapshot, revision);
    return snapshot;
  })();
  inFlight = { revision, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = undefined;
  }
});
