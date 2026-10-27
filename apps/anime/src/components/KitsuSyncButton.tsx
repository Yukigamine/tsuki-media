"use client";

import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Box, Button, CircularProgress } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useState } from "react";
import { getLinkedProviderAccessTokenAction } from "@/lib/actions/auth";
import {
  finishKitsuSyncLogAction,
  getKitsuPushSnapshotAction,
  type KitsuPushSnapshot,
  startKitsuSyncLogAction,
  syncKitsuLibraryAction,
} from "@/lib/actions/kitsu-sync";
import { repairMissingKitsuMappings } from "@/lib/kitsu/client-mapping-repair";
import { assertNoCloudflareChallenge, kitsuFetch } from "@/lib/kitsu/fetch";
import type {
  KitsuLibraryEntry,
  KitsuLibrarySyncPayload,
} from "@/lib/kitsu/sync-payload";
import { MediaTypeEnum, Thunder } from "@/lib/zeus/kitsu";

const KITSU_GRAPHQL =
  process.env.NEXT_PUBLIC_KITSU_API_URL ?? "https://kitsu.app/api/graphql";

type KitsuRemoteEntry = {
  entryId: string;
  mediaId: string;
  title: string;
  status: string | null | undefined;
  progress: number | null | undefined;
  rating: number | null | undefined;
  notes: string | null | undefined;
  reconsumeCount: number | null | undefined;
  reconsuming: boolean | null | undefined;
  private: boolean | null | undefined;
  malId?: number | null;
  episodeCount?: number | null;
  chapterCount?: number | null;
};

type KitsuMutationUpdateOp = {
  alias: string;
  entryId: string;
  input: {
    notes: string;
    private: boolean;
    progress: number;
    rating: number | null;
    reconsumeCount: number;
    reconsuming: boolean;
    status: string;
  };
};

type KitsuMutationCreateOp = {
  alias: string;
  mediaId: string;
  input: {
    mediaType: "ANIME" | "MANGA";
    notes: string;
    private: boolean;
    progress: number;
    rating: number | null;
    reconsumeCount: number;
    reconsuming: boolean;
    status: string;
  };
};

type KitsuMutationDeleteOp = {
  alias: string;
  entryId: string;
  title: string;
};

const KITSU_BATCH_SIZE = 10;

function getKitsuAuthClient(accessToken: string) {
  return Thunder(async (query, variables) => {
    const response = await kitsuFetch(KITSU_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Referer: "https://kitsu.app",
        Origin: "https://kitsu.app",
      },
      body: JSON.stringify({ query, variables }),
    });

    assertNoCloudflareChallenge(response);

    const body = JSON.parse(response.body) as {
      data?: unknown;
      errors?: { message: string }[];
    };

    if (
      response.status < 200 ||
      response.status >= 300 ||
      body.errors?.length
    ) {
      throw new Error(
        body.errors?.[0]?.message ?? `Kitsu GraphQL ${response.status}`,
      );
    }

    if (!body.data) {
      throw new Error("Kitsu GraphQL returned no data");
    }

    return body.data;
  });
}

async function getCurrentProfileSlug(accessToken: string): Promise<string> {
  const client = getKitsuAuthClient(accessToken);
  const data = await client("query")({
    currentProfile: {
      slug: true,
    },
  });

  if (!data.currentProfile?.slug) {
    throw new Error("Unable to resolve the current Kitsu profile slug");
  }

  return data.currentProfile.slug;
}

async function fetchLibraryPages(
  slug: string,
  type: MediaTypeEnum,
  accessToken: string,
): Promise<KitsuLibraryEntry[]> {
  const client = getKitsuAuthClient(accessToken);
  const nodes: KitsuLibraryEntry[] = [];
  let after: string | null = null;

  type LibraryPageResponse = {
    findProfileBySlug: {
      library: {
        all: {
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          nodes: KitsuLibraryEntry[];
        } | null;
      } | null;
    } | null;
  };

  do {
    const pageResponse: LibraryPageResponse = (await client("query")({
      findProfileBySlug: [
        { slug },
        {
          library: {
            all: [
              { first: 100, after, mediaType: type },
              {
                pageInfo: {
                  endCursor: true,
                  hasNextPage: true,
                },
                nodes: {
                  id: true,
                  notes: true,
                  private: true,
                  progress: true,
                  rating: true,
                  reconsumeCount: true,
                  reconsuming: true,
                  status: true,
                  updatedAt: true,
                  media: {
                    id: true,
                    slug: true,
                    status: true,
                    startDate: true,
                    endDate: true,
                    averageRating: true,
                    description: [{ locales: ["en", "en_jp"] }, true],
                    posterImage: {
                      original: {
                        url: true,
                      },
                    },
                    bannerImage: {
                      original: {
                        url: true,
                      },
                    },
                    titles: {
                      canonical: true,
                      translated: true,
                      romanized: true,
                      original: true,
                    },
                    mappings: [
                      { first: 5 },
                      {
                        nodes: {
                          externalId: true,
                          externalSite: true,
                        },
                      },
                    ],
                    "...on Anime": {
                      episodeCount: true,
                    },
                    "...on Manga": {
                      chapterCount: true,
                      volumeCount: true,
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    })) as LibraryPageResponse;

    const page = pageResponse.findProfileBySlug?.library?.all;
    if (!page) break;

    nodes.push(...(page.nodes ?? []));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return nodes;
}

async function fetchKitsuMediaDetails(
  mediaId: string,
  type: "ANIME" | "MANGA",
  accessToken: string,
): Promise<{
  episodeCount?: number | null;
  chapterCount?: number | null;
} | null> {
  const client = getKitsuAuthClient(accessToken);
  const result = (await client("query")({
    findMediaByIdAndType: [
      { id: mediaId, mediaType: type as MediaTypeEnum },
      {
        id: true,
        "...on Anime": { episodeCount: true },
        "...on Manga": { chapterCount: true },
      },
    ],
  })) as {
    findMediaByIdAndType?: {
      episodeCount?: number | null;
      chapterCount?: number | null;
    } | null;
  };

  return result.findMediaByIdAndType ?? null;
}

function toKitsuRating(rating: number | null): number | null {
  if (rating == null || rating === 0) return null;
  return Math.max(2, Math.min(20, Math.round(rating)));
}

function mapWatchStatus(status: string | null | undefined): string {
  switch (status) {
    case "CURRENT":
      return "WATCHING";
    case "PLANNED":
      return "PLAN_TO_WATCH";
    case "COMPLETED":
      return "COMPLETED";
    case "ON_HOLD":
      return "ON_HOLD";
    case "DROPPED":
      return "DROPPED";
    default:
      return "PLAN_TO_WATCH";
  }
}

function mapReadStatus(status: string | null | undefined): string {
  switch (status) {
    case "CURRENT":
      return "READING";
    case "PLANNED":
      return "PLAN_TO_READ";
    case "COMPLETED":
      return "COMPLETED";
    case "ON_HOLD":
      return "ON_HOLD";
    case "DROPPED":
      return "DROPPED";
    default:
      return "PLAN_TO_READ";
  }
}

function reverseWatchStatus(
  status: KitsuPushSnapshot["anime"][number]["watchStatus"],
): string {
  switch (status) {
    case "WATCHING":
      return "CURRENT";
    case "PLAN_TO_WATCH":
      return "PLANNED";
    case "COMPLETED":
      return "COMPLETED";
    case "ON_HOLD":
      return "ON_HOLD";
    case "DROPPED":
      return "DROPPED";
  }
}

function reverseReadStatus(
  status: KitsuPushSnapshot["manga"][number]["readStatus"],
): string {
  switch (status) {
    case "READING":
      return "CURRENT";
    case "PLAN_TO_READ":
      return "PLANNED";
    case "COMPLETED":
      return "COMPLETED";
    case "ON_HOLD":
      return "ON_HOLD";
    case "DROPPED":
      return "DROPPED";
  }
}

function kitsuAnimeNeedsUpdate(
  local: KitsuPushSnapshot["anime"][number],
  remote: KitsuRemoteEntry,
): boolean {
  return (
    mapWatchStatus(remote.status) !== local.watchStatus ||
    (remote.progress ?? 0) !== local.progress ||
    toKitsuRating(remote.rating ?? null) !== toKitsuRating(local.rating) ||
    (remote.notes || null) !== (local.notes || null) ||
    (remote.reconsumeCount ?? 0) !== local.rewatchCount ||
    (remote.reconsuming ?? false) !== local.rewatching ||
    (remote.private ?? false) !== local.private
  );
}

function kitsuMangaNeedsUpdate(
  local: KitsuPushSnapshot["manga"][number],
  remote: KitsuRemoteEntry,
): boolean {
  return (
    mapReadStatus(remote.status) !== local.readStatus ||
    (remote.progress ?? 0) !== local.progress ||
    toKitsuRating(remote.rating ?? null) !== toKitsuRating(local.rating) ||
    (remote.notes || null) !== (local.notes || null) ||
    (remote.reconsumeCount ?? 0) !== local.rereadCount ||
    (remote.reconsuming ?? false) !== local.rereading ||
    (remote.private ?? false) !== local.private
  );
}

function parseRemoteEntry(node: KitsuLibraryEntry): KitsuRemoteEntry | null {
  if (!node.id || !node.media?.id) return null;

  const title =
    node.media.titles?.translated ??
    node.media.titles?.canonical ??
    node.media.titles?.romanized ??
    node.media.slug ??
    String(node.id);

  const malMapping = (node.media.mappings?.nodes ?? []).find((mapping) =>
    mapping.externalSite.includes("MYANIMELIST"),
  );

  return {
    entryId: node.id,
    mediaId: node.media.id,
    title,
    status: node.status,
    progress: node.progress,
    rating: node.rating,
    notes: node.notes,
    reconsumeCount: node.reconsumeCount,
    reconsuming: node.reconsuming,
    private: node.private,
    malId: malMapping ? Number(malMapping.externalId) : null,
    episodeCount: node.media.episodeCount ?? null,
    chapterCount: node.media.chapterCount ?? null,
  };
}

function toGraphQLValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") {
    if (/^[A-Z_][A-Z0-9_]*$/.test(value)) return value;
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(toGraphQLValue).join(", ")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${toGraphQLValue(item)}`)
    .join(", ");
  return `{${entries}}`;
}

function buildKitsuUpdateBatch(ops: KitsuMutationUpdateOp[]): string {
  const selections = ops.map((op) => {
    const input = toGraphQLValue({ id: op.entryId, ...op.input });
    return `${op.alias}: libraryEntry { update(input: ${input}) { libraryEntry { id } errors { message } } }`;
  });
  return `mutation { ${selections.join(" ")} }`;
}

function buildKitsuCreateBatch(ops: KitsuMutationCreateOp[]): string {
  const selections = ops.map((op) => {
    const input = toGraphQLValue({ mediaId: op.mediaId, ...op.input });
    return `${op.alias}: libraryEntry { create(input: ${input}) { libraryEntry { id } errors { message } } }`;
  });
  return `mutation { ${selections.join(" ")} }`;
}

function buildKitsuDeleteBatch(ops: KitsuMutationDeleteOp[]): string {
  const selections = ops.map((op) => {
    const input = toGraphQLValue({ id: op.entryId });
    return `${op.alias}: libraryEntry { delete(input: ${input}) { libraryEntry { id } } }`;
  });
  return `mutation { ${selections.join(" ")} }`;
}

async function batchKitsuMutation(
  query: string,
  accessToken: string,
): Promise<void> {
  const response = await kitsuFetch(KITSU_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Referer: "https://kitsu.app",
      Origin: "https://kitsu.app",
    },
    body: JSON.stringify({ query }),
  });

  assertNoCloudflareChallenge(response);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Kitsu GraphQL ${response.status}`);
  }

  const body = JSON.parse(response.body) as {
    data?: Record<string, { errors?: Array<{ message?: string }> }>;
    errors?: Array<{ message?: string }>;
  };

  if (body.errors?.length) {
    throw new Error(
      body.errors.map((error) => error.message || "Unknown error").join("; "),
    );
  }

  const nestedErrors = Object.values(body.data ?? {})
    .flatMap((entry) => entry.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  if (nestedErrors.length) {
    throw new Error(nestedErrors.join("; "));
  }
}

async function runMutationBatches<
  T extends
    | KitsuMutationUpdateOp
    | KitsuMutationCreateOp
    | KitsuMutationDeleteOp,
>(
  ops: T[],
  buildQuery: (chunk: T[]) => string,
  accessToken: string,
  errors: string[],
  label: string,
): Promise<void> {
  for (let i = 0; i < ops.length; i += KITSU_BATCH_SIZE) {
    const batchIndex = Math.floor(i / KITSU_BATCH_SIZE) + 1;
    const chunk = ops.slice(i, i + KITSU_BATCH_SIZE);
    const query = buildQuery(chunk);

    try {
      await batchKitsuMutation(query, accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${label} batch ${batchIndex}: ${message}`);
    }
  }
}

function trimSyncEntryDescription(
  entry: KitsuLibrarySyncPayload["anime"][number],
) {
  const { description: _description, ...media } = entry.media;
  return { ...entry, media };
}

export default function KitsuSyncButton({
  onSynced,
  renderAfterButton,
}: {
  onSynced?: () => Promise<void> | void;
  renderAfterButton?: (direction: "PULL" | "PUSH") => ReactNode;
}) {
  const [loadingDirection, setLoadingDirection] = useState<
    "PULL" | "PUSH" | null
  >(null);

  async function handlePull() {
    const logStart = await startKitsuSyncLogAction("PULL");
    const logId = logStart.ok ? logStart.data?.logId : undefined;

    const tokenResult = await getLinkedProviderAccessTokenAction("KITSU");
    if (!tokenResult.ok) {
      enqueueSnackbar("Connect your Kitsu account first", { variant: "error" });
      if (logId) {
        await finishKitsuSyncLogAction({
          logId,
          status: "FAILED",
          animeSynced: 0,
          mangaSynced: 0,
          animeChanged: 0,
          mangaChanged: 0,
          errors: ["Connect your Kitsu account first"],
        });
      }
      return;
    }
    const accessToken = tokenResult.data;

    setLoadingDirection("PULL");
    try {
      const slug = await getCurrentProfileSlug(accessToken);
      const [anime, manga] = await Promise.all([
        fetchLibraryPages(slug, MediaTypeEnum.ANIME, accessToken),
        fetchLibraryPages(slug, MediaTypeEnum.MANGA, accessToken),
      ]);

      const payload: KitsuLibrarySyncPayload = {
        slug,
        anime: anime.map(trimSyncEntryDescription),
        manga: manga.map(trimSyncEntryDescription),
      };
      const result = await syncKitsuLibraryAction(payload);

      if (!result.ok) {
        enqueueSnackbar(result.error ?? "Kitsu sync failed", {
          variant: "error",
        });
        if (logId) {
          await finishKitsuSyncLogAction({
            logId,
            status: "FAILED",
            animeSynced: 0,
            mangaSynced: 0,
            animeChanged: 0,
            mangaChanged: 0,
            errors: [result.error ?? "Kitsu pull failed"],
          });
        }
        return;
      }

      const pullErrors = result.data?.errors ?? [];

      if (pullErrors.length > 0) {
        enqueueSnackbar(
          `Pulled with ${pullErrors.length} error(s): check sync log details.`,
          { variant: "warning" },
        );
      }

      if (logId) {
        await finishKitsuSyncLogAction({
          logId,
          status: pullErrors.length ? "FAILED" : "COMPLETED",
          animeSynced: result.data?.animeSynced ?? 0,
          mangaSynced: result.data?.mangaSynced ?? 0,
          animeChanged: result.data?.animeChanged ?? 0,
          mangaChanged: result.data?.mangaChanged ?? 0,
          errors: pullErrors,
        });
      }

      enqueueSnackbar(
        `Synced ${result.data?.animeSynced ?? 0} anime and ${result.data?.mangaSynced ?? 0} manga entries (${result.data?.animeChanged ?? 0} anime / ${result.data?.mangaChanged ?? 0} manga changed)`,
        { variant: "success" },
      );
      await onSynced?.();
    } catch (error) {
      if (logId) {
        await finishKitsuSyncLogAction({
          logId,
          status: "FAILED",
          animeSynced: 0,
          mangaSynced: 0,
          animeChanged: 0,
          mangaChanged: 0,
          errors: [
            error instanceof Error ? error.message : "Kitsu pull failed",
          ],
        });
      }
      enqueueSnackbar(
        error instanceof Error ? error.message : "Kitsu sync failed",
        { variant: "error" },
      );
    } finally {
      setLoadingDirection(null);
    }
  }

  async function handlePush() {
    const logStart = await startKitsuSyncLogAction("PUSH");
    const logId = logStart.ok ? logStart.data?.logId : undefined;

    const tokenResult = await getLinkedProviderAccessTokenAction("KITSU");
    if (!tokenResult.ok) {
      enqueueSnackbar("Connect your Kitsu account first", { variant: "error" });
      if (logId) {
        await finishKitsuSyncLogAction({
          logId,
          status: "FAILED",
          animeSynced: 0,
          mangaSynced: 0,
          animeChanged: 0,
          mangaChanged: 0,
          errors: ["Connect your Kitsu account first"],
        });
      }
      return;
    }

    setLoadingDirection("PUSH");

    const errors: string[] = [];
    const deletions: string[] = [];
    let animeMatched = 0;
    let animeChanged = 0;
    let mangaMatched = 0;
    let mangaChanged = 0;

    try {
      const accessToken = tokenResult.data;
      const slug = await getCurrentProfileSlug(accessToken);
      const mappingRepair = await repairMissingKitsuMappings();
      errors.push(
        ...mappingRepair.unresolved.map(
          (item) => `${item}: provider mapping could not be resolved`,
        ),
      );
      const snapshotResult = await getKitsuPushSnapshotAction();

      if (!snapshotResult.ok || !snapshotResult.data) {
        throw new Error(
          snapshotResult.error ?? "Unable to load local snapshot",
        );
      }

      const [remoteAnime, remoteManga] = await Promise.all([
        fetchLibraryPages(slug, MediaTypeEnum.ANIME, accessToken),
        fetchLibraryPages(slug, MediaTypeEnum.MANGA, accessToken),
      ]);

      const remoteAnimeMap = new Map<string, KitsuRemoteEntry>();
      for (const node of remoteAnime) {
        const parsed = parseRemoteEntry(node);
        if (parsed) remoteAnimeMap.set(parsed.mediaId, parsed);
      }

      const remoteMangaMap = new Map<string, KitsuRemoteEntry>();
      for (const node of remoteManga) {
        const parsed = parseRemoteEntry(node);
        if (parsed) remoteMangaMap.set(parsed.mediaId, parsed);
      }

      const animeUpdateOps: KitsuMutationUpdateOp[] = [];
      const animeCreateOps: KitsuMutationCreateOp[] = [];
      const animeDeleteOps: KitsuMutationDeleteOp[] = [];

      for (const entry of snapshotResult.data.anime) {
        let remote = entry.anime.kitsuId
          ? remoteAnimeMap.get(entry.anime.kitsuId)
          : null;
        if (!remote && entry.anime.malId) {
          for (const candidate of remoteAnimeMap.values()) {
            if (candidate.malId === entry.anime.malId) {
              remote = candidate;
              break;
            }
          }
        }

        if (remote) {
          animeMatched++;
          remoteAnimeMap.delete(remote.mediaId);

          const remoteEpisodeCount = remote.episodeCount;
          const clampedProgress = remoteEpisodeCount
            ? Math.min(entry.progress, remoteEpisodeCount)
            : entry.progress;

          if (
            kitsuAnimeNeedsUpdate(
              { ...entry, progress: clampedProgress },
              remote,
            )
          ) {
            animeChanged++;
            animeUpdateOps.push({
              alias: `au${animeUpdateOps.length}`,
              entryId: remote.entryId,
              input: {
                notes: entry.notes ?? "",
                private: entry.private,
                progress: clampedProgress,
                rating: toKitsuRating(entry.rating),
                reconsumeCount: entry.rewatchCount,
                reconsuming: entry.rewatching,
                status: reverseWatchStatus(entry.watchStatus),
              },
            });
          }
        } else if (entry.anime.kitsuId) {
          animeMatched++;
          animeChanged++;
          let episodeCount = entry.anime.episodeCount;
          if (entry.progress > 0) {
            const mediaDetails = await fetchKitsuMediaDetails(
              entry.anime.kitsuId,
              "ANIME",
              accessToken,
            );
            if (mediaDetails?.episodeCount != null) {
              episodeCount = mediaDetails.episodeCount;
            }
          }

          const clampedProgress = episodeCount
            ? Math.min(entry.progress, episodeCount)
            : entry.progress;

          animeCreateOps.push({
            alias: `ac${animeCreateOps.length}`,
            mediaId: entry.anime.kitsuId,
            input: {
              mediaType: "ANIME",
              notes: entry.notes ?? "",
              private: entry.private,
              progress: clampedProgress,
              rating: toKitsuRating(entry.rating),
              reconsumeCount: entry.rewatchCount,
              reconsuming: entry.rewatching,
              status: reverseWatchStatus(entry.watchStatus),
            },
          });
        }
      }

      for (const remote of remoteAnimeMap.values()) {
        animeDeleteOps.push({
          alias: `ad${animeDeleteOps.length}`,
          entryId: remote.entryId,
          title: remote.title,
        });
        deletions.push(
          `anime "${remote.title}" (Kitsu entry ${remote.entryId})`,
        );
        animeChanged++;
      }

      const mangaUpdateOps: KitsuMutationUpdateOp[] = [];
      const mangaCreateOps: KitsuMutationCreateOp[] = [];
      const mangaDeleteOps: KitsuMutationDeleteOp[] = [];

      for (const entry of snapshotResult.data.manga) {
        let remote = entry.manga.kitsuId
          ? remoteMangaMap.get(entry.manga.kitsuId)
          : null;
        if (!remote && entry.manga.malId) {
          for (const candidate of remoteMangaMap.values()) {
            if (candidate.malId === entry.manga.malId) {
              remote = candidate;
              break;
            }
          }
        }

        if (remote) {
          mangaMatched++;
          remoteMangaMap.delete(remote.mediaId);

          const remoteChapterCount = remote.chapterCount;
          const clampedProgress = remoteChapterCount
            ? Math.min(entry.progress, remoteChapterCount)
            : entry.progress;

          if (
            kitsuMangaNeedsUpdate(
              { ...entry, progress: clampedProgress },
              remote,
            )
          ) {
            mangaChanged++;
            mangaUpdateOps.push({
              alias: `mu${mangaUpdateOps.length}`,
              entryId: remote.entryId,
              input: {
                notes: entry.notes ?? "",
                private: entry.private,
                progress: clampedProgress,
                rating: toKitsuRating(entry.rating),
                reconsumeCount: entry.rereadCount,
                reconsuming: entry.rereading,
                status: reverseReadStatus(entry.readStatus),
              },
            });
          }
        } else if (entry.manga.kitsuId) {
          mangaMatched++;
          mangaChanged++;
          let chapterCount = entry.manga.chapterCount;
          if (entry.progress > 0) {
            const mediaDetails = await fetchKitsuMediaDetails(
              entry.manga.kitsuId,
              "MANGA",
              accessToken,
            );
            if (mediaDetails?.chapterCount != null) {
              chapterCount = mediaDetails.chapterCount;
            }
          }

          const clampedProgress = chapterCount
            ? Math.min(entry.progress, chapterCount)
            : entry.progress;

          mangaCreateOps.push({
            alias: `mc${mangaCreateOps.length}`,
            mediaId: entry.manga.kitsuId,
            input: {
              mediaType: "MANGA",
              notes: entry.notes ?? "",
              private: entry.private,
              progress: clampedProgress,
              rating: toKitsuRating(entry.rating),
              reconsumeCount: entry.rereadCount,
              reconsuming: entry.rereading,
              status: reverseReadStatus(entry.readStatus),
            },
          });
        }
      }

      for (const remote of remoteMangaMap.values()) {
        mangaDeleteOps.push({
          alias: `md${mangaDeleteOps.length}`,
          entryId: remote.entryId,
          title: remote.title,
        });
        deletions.push(
          `manga "${remote.title}" (Kitsu entry ${remote.entryId})`,
        );
        mangaChanged++;
      }

      await runMutationBatches(
        animeUpdateOps,
        buildKitsuUpdateBatch,
        accessToken,
        errors,
        "anime update",
      );
      await runMutationBatches(
        animeCreateOps,
        buildKitsuCreateBatch,
        accessToken,
        errors,
        "anime create",
      );
      await runMutationBatches(
        animeDeleteOps,
        buildKitsuDeleteBatch,
        accessToken,
        errors,
        "anime delete",
      );
      await runMutationBatches(
        mangaUpdateOps,
        buildKitsuUpdateBatch,
        accessToken,
        errors,
        "manga update",
      );
      await runMutationBatches(
        mangaCreateOps,
        buildKitsuCreateBatch,
        accessToken,
        errors,
        "manga create",
      );
      await runMutationBatches(
        mangaDeleteOps,
        buildKitsuDeleteBatch,
        accessToken,
        errors,
        "manga delete",
      );

      if (logId) {
        await finishKitsuSyncLogAction({
          logId,
          status: errors.length ? "FAILED" : "COMPLETED",
          animeSynced: animeMatched,
          mangaSynced: mangaMatched,
          animeChanged,
          mangaChanged,
          errors,
          deletions,
        });
      }

      if (errors.length) {
        enqueueSnackbar(
          `Kitsu push completed with ${errors.length} error(s).`,
          {
            variant: "warning",
          },
        );
      } else {
        enqueueSnackbar(
          `Pushed ${animeChanged} anime and ${mangaChanged} manga changes to Kitsu`,
          { variant: "success" },
        );
      }

      await onSynced?.();
    } catch (error) {
      if (logId) {
        await finishKitsuSyncLogAction({
          logId,
          status: "FAILED",
          animeSynced: animeMatched,
          mangaSynced: mangaMatched,
          animeChanged,
          mangaChanged,
          errors: [
            error instanceof Error ? error.message : "Kitsu push failed",
          ],
          deletions,
        });
      }

      enqueueSnackbar(
        error instanceof Error ? error.message : "Kitsu push failed",
        { variant: "error" },
      );
    } finally {
      setLoadingDirection(null);
    }
  }

  const pullLoading = loadingDirection === "PULL";
  const pushLoading = loadingDirection === "PUSH";
  const disabled = loadingDirection !== null;

  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}
    >
      <Box sx={{ flex: "1 1 240px", minWidth: 0 }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={
            pullLoading ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <CloudDownloadIcon />
            )
          }
          onClick={handlePull}
          disabled={disabled}
          sx={{ textTransform: "none", mb: 1.5 }}
          fullWidth
        >
          {pullLoading ? "Running..." : "Pull from Kitsu"}
        </Button>
        {renderAfterButton?.("PULL")}
      </Box>

      <Box sx={{ flex: "1 1 240px", minWidth: 0 }}>
        <Button
          variant="outlined"
          color="primary"
          startIcon={
            pushLoading ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <CloudUploadIcon />
            )
          }
          onClick={handlePush}
          disabled={disabled}
          sx={{ textTransform: "none", mb: 1.5 }}
          fullWidth
        >
          {pushLoading ? "Running..." : "Push to Kitsu"}
        </Button>
        {renderAfterButton?.("PUSH")}
      </Box>
    </Box>
  );
}
