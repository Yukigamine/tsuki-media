"use client";

import CollectionsBookmarkIcon from "@mui/icons-material/CollectionsBookmark";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import NotesIcon from "@mui/icons-material/Notes";
import PaidIcon from "@mui/icons-material/Paid";
import ReplayIcon from "@mui/icons-material/Replay";
import StarRateIcon from "@mui/icons-material/StarRate";
import TrackChangesIcon from "@mui/icons-material/TrackChanges";
import UpdateIcon from "@mui/icons-material/Update";
import { Chip, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";
import AnimeDetailActions from "@/components/AnimeDetailActions";
import MangaDetailActions from "@/components/MangaDetailActions";
import MediaDetailLayout from "@/components/MediaDetailLayout";
import ProviderMediaHero from "@/components/ProviderMediaHero";
import ProviderSeriesDetails from "@/components/ProviderSeriesDetails";
import RelatedMediaCards from "@/components/RelatedMediaCards";
import type {
  AnimeCollectionItem,
  AnimeListEntry,
  MangaCollectionItem,
  MangaListEntry,
} from "@/generated/prisma/client";
import type { MediaDetailSnapshot } from "@/lib/media-detail-types";
import {
  formatHalfStepRatingOutOfTen,
  normalizeListRatingToTen,
} from "@/lib/media-display";

type Props = {
  kitsuId: string | null;
  fallbackTitle: string;
  mediaType: "anime" | "manga";
  mediaId: string | null;
  anilistId: number | null;
  initialDetail: MediaDetailSnapshot | null;
  hasSession: boolean;
  listEntry: AnimeListEntry | MangaListEntry | null;
  collectionCount: number;
  collectionFormats?: string[];
  collectionItems?: AnimeCollectionItem[] | MangaCollectionItem[];
};

const FORMAT_LABELS: Record<string, string> = {
  DVD: "DVD",
  BLU_RAY: "Blu-ray",
  VHS: "VHS",
  DIGITAL: "Digital",
  LIMITED_EDITION: "Limited Edition",
  OTHER: "Other",
};

function mangaStatusLabel(
  status: MangaListEntry["readStatus"],
  rereading: boolean,
): ReactNode {
  const labels: Record<MangaListEntry["readStatus"], string> = {
    PLAN_TO_READ: "Want to Read",
    READING: "Reading",
    COMPLETED: "Completed",
    ON_HOLD: "On Hold",
    DROPPED: "Dropped",
  };
  return status === "READING" && rereading ? (
    <>
      Reading <ReplayIcon fontSize="small" sx={{ verticalAlign: "middle" }} />
    </>
  ) : (
    labels[status]
  );
}

function animeStatusLabel(
  status: AnimeListEntry["watchStatus"],
  rewatching: boolean,
): ReactNode {
  const labels: Record<AnimeListEntry["watchStatus"], string> = {
    WATCHING: "Watching",
    PLAN_TO_WATCH: "Want to Watch",
    COMPLETED: "Completed",
    ON_HOLD: "On Hold",
    DROPPED: "Dropped",
  };
  return status === "WATCHING" && rewatching ? (
    <>
      Watching <ReplayIcon fontSize="small" sx={{ verticalAlign: "middle" }} />
    </>
  ) : (
    labels[status]
  );
}

function ListDetailRow({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {icon}
      <Typography variant="body2">{children}</Typography>
    </Stack>
  );
}

function collectionValue(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ProviderMediaDetailPage({
  kitsuId,
  fallbackTitle,
  mediaType,
  mediaId,
  anilistId,
  initialDetail,
  hasSession,
  listEntry,
  collectionCount,
  collectionFormats = [],
  collectionItems = [],
}: Props) {
  const animeEntry =
    mediaType === "anime" ? (listEntry as AnimeListEntry | null) : null;
  const mangaEntry =
    mediaType === "manga" ? (listEntry as MangaListEntry | null) : null;
  const title = fallbackTitle.replaceAll("-", " ");
  const [mediaCount, setMediaCount] = useState<number | null>(
    mediaType === "anime"
      ? (initialDetail?.episodeCount ?? null)
      : (initialDetail?.chapterCount ?? null),
  );
  const animeCollectionItems =
    mediaType === "anime" ? (collectionItems as AnimeCollectionItem[]) : [];
  const mangaCollectionItems =
    mediaType === "manga" ? (collectionItems as MangaCollectionItem[]) : [];
  const collectionLabel =
    collectionFormats.length > 0
      ? collectionFormats
          .map((format) => FORMAT_LABELS[format] ?? format)
          .join(", ")
      : collectionCount > 0
        ? `In collection (${collectionCount})`
        : null;

  return (
    <MediaDetailLayout
      title={title}
      mediaType={mediaType}
      heroBanner={null}
      coverImage={null}
      heroContent={
        <ProviderMediaHero
          kitsuId={kitsuId}
          mediaType={mediaType}
          fallbackTitle={title}
          initialDetail={initialDetail}
          anilistId={anilistId}
          onCountLoaded={setMediaCount}
          extraChips={
            <>
              {collectionLabel && (
                <Chip label={collectionLabel} size="small" color="success" />
              )}
              {listEntry && (
                <Chip
                  label={
                    mediaType === "anime"
                      ? animeEntry
                        ? animeStatusLabel(
                            animeEntry.watchStatus,
                            animeEntry.rewatching,
                          )
                        : "Not on list"
                      : mangaEntry
                        ? mangaStatusLabel(
                            mangaEntry.readStatus,
                            mangaEntry.rereading,
                          )
                        : "Not on list"
                  }
                  size="small"
                  color="primary"
                />
              )}
            </>
          }
        />
      }
      heroChips={
        collectionLabel ? (
          <Chip label={collectionLabel} size="small" color="success" />
        ) : null
      }
      quickActions={
        hasSession ? (
          mediaType === "anime" ? (
            <AnimeDetailActions
              animeId={mediaId}
              kitsuId={kitsuId ?? ""}
              title={title}
              episodeCount={mediaCount}
              entry={animeEntry}
            />
          ) : (
            <MangaDetailActions
              mangaId={mediaId}
              kitsuId={kitsuId ?? ""}
              title={title}
              chapterCount={mediaCount}
              volumeCount={initialDetail?.volumeCount ?? null}
              entry={mangaEntry}
            />
          )
        ) : null
      }
      listStatus={
        listEntry ? (
          <Stack spacing={0.75}>
            <ListDetailRow
              icon={<TrackChangesIcon fontSize="small" color="action" />}
            >
              Status:{" "}
              {mediaType === "anime"
                ? animeEntry
                  ? animeStatusLabel(
                      animeEntry.watchStatus,
                      animeEntry.rewatching,
                    )
                  : "Not on list"
                : mangaEntry
                  ? mangaStatusLabel(
                      mangaEntry.readStatus,
                      mangaEntry.rereading,
                    )
                  : "Not on list"}
            </ListDetailRow>
            <ListDetailRow
              icon={
                mediaType === "anime" ? (
                  <UpdateIcon fontSize="small" color="action" />
                ) : (
                  <MenuBookIcon fontSize="small" color="action" />
                )
              }
            >
              Progress: {listEntry.progress}
              {mediaType === "anime" && mediaCount != null
                ? ` / ${mediaCount}`
                : ""}
            </ListDetailRow>
            {mediaType === "manga" && (
              <ListDetailRow
                icon={<MenuBookIcon fontSize="small" color="action" />}
              >
                Volume progress: {mangaEntry?.progressVolumes}
              </ListDetailRow>
            )}
            <ListDetailRow
              icon={<StarRateIcon fontSize="small" color="action" />}
            >
              Rating:{" "}
              {listEntry.rating != null
                ? formatHalfStepRatingOutOfTen(
                    normalizeListRatingToTen(listEntry.rating),
                  )
                : "Not rated"}
            </ListDetailRow>
            {mediaType === "anime" && animeEntry && (
              <>
                <ListDetailRow
                  icon={<ReplayIcon fontSize="small" color="action" />}
                >
                  Rewatches: {animeEntry.rewatchCount}
                </ListDetailRow>
                {animeEntry.notes && (
                  <ListDetailRow
                    icon={<NotesIcon fontSize="small" color="action" />}
                  >
                    Notes: {animeEntry.notes}
                  </ListDetailRow>
                )}
                <ListDetailRow
                  icon={<EventAvailableIcon fontSize="small" color="action" />}
                >
                  Completed:{" "}
                  {animeEntry.completedAt
                    ? animeEntry.completedAt.toLocaleDateString()
                    : "Not set"}
                </ListDetailRow>
              </>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No list entry yet.
          </Typography>
        )
      }
      collectionOwnership={
        collectionCount > 0 ? (
          <Stack spacing={1.5}>
            {(mediaType === "anime"
              ? animeCollectionItems
              : mangaCollectionItems
            ).map((item, index) => (
              <Stack key={item.id} spacing={0.75}>
                {index > 0 && <Divider />}
                {mediaType === "anime" ? (
                  <>
                    <ListDetailRow
                      icon={
                        <CollectionsBookmarkIcon
                          fontSize="small"
                          color="action"
                        />
                      }
                    >
                      Format:{" "}
                      {collectionValue((item as AnimeCollectionItem).format)}
                    </ListDetailRow>
                    <ListDetailRow
                      icon={<StarRateIcon fontSize="small" color="action" />}
                    >
                      Rarity:{" "}
                      {collectionValue((item as AnimeCollectionItem).rarity)}
                    </ListDetailRow>
                    <ListDetailRow
                      icon={
                        <TrackChangesIcon fontSize="small" color="action" />
                      }
                    >
                      Condition:{" "}
                      {collectionValue((item as AnimeCollectionItem).condition)}
                    </ListDetailRow>
                    {(item as AnimeCollectionItem).purchasedAt && (
                      <ListDetailRow
                        icon={
                          <EventAvailableIcon fontSize="small" color="action" />
                        }
                      >
                        Purchased:{" "}
                        {(
                          item as AnimeCollectionItem
                        ).purchasedAt?.toLocaleDateString()}
                      </ListDetailRow>
                    )}
                    {(item as AnimeCollectionItem).pricePaid != null && (
                      <ListDetailRow
                        icon={<PaidIcon fontSize="small" color="action" />}
                      >
                        Price: $
                        {(item as AnimeCollectionItem).pricePaid?.toFixed(2)}
                      </ListDetailRow>
                    )}
                    {(item as AnimeCollectionItem).barcode && (
                      <ListDetailRow
                        icon={
                          <TrackChangesIcon fontSize="small" color="action" />
                        }
                      >
                        Barcode: {(item as AnimeCollectionItem).barcode}
                      </ListDetailRow>
                    )}
                    {(item as AnimeCollectionItem).notes && (
                      <ListDetailRow
                        icon={<NotesIcon fontSize="small" color="action" />}
                      >
                        Notes: {(item as AnimeCollectionItem).notes}
                      </ListDetailRow>
                    )}
                  </>
                ) : (
                  <>
                    <ListDetailRow
                      icon={
                        <TrackChangesIcon fontSize="small" color="action" />
                      }
                    >
                      Condition:{" "}
                      {collectionValue((item as MangaCollectionItem).condition)}
                    </ListDetailRow>
                    <ListDetailRow
                      icon={<MenuBookIcon fontSize="small" color="action" />}
                    >
                      Language:{" "}
                      {collectionValue((item as MangaCollectionItem).language)}
                    </ListDetailRow>
                    <ListDetailRow
                      icon={<MenuBookIcon fontSize="small" color="action" />}
                    >
                      Volumes:{" "}
                      {(item as MangaCollectionItem).volumes.length > 0
                        ? (item as MangaCollectionItem).volumes.join(", ")
                        : "None"}
                    </ListDetailRow>
                    <ListDetailRow
                      icon={<MenuBookIcon fontSize="small" color="action" />}
                    >
                      Chapters:{" "}
                      {(item as MangaCollectionItem).chapters.length > 0
                        ? (item as MangaCollectionItem).chapters.join(", ")
                        : "None"}
                    </ListDetailRow>
                    {((item as MangaCollectionItem).containsSerialized ||
                      (item as MangaCollectionItem).containsOmnibus) && (
                      <ListDetailRow
                        icon={
                          <CollectionsBookmarkIcon
                            fontSize="small"
                            color="action"
                          />
                        }
                      >
                        Includes:{" "}
                        {[
                          (item as MangaCollectionItem).containsSerialized &&
                            "Serialized",
                          (item as MangaCollectionItem).containsOmnibus &&
                            "Omnibus",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </ListDetailRow>
                    )}
                    {(item as MangaCollectionItem).notes && (
                      <ListDetailRow
                        icon={<NotesIcon fontSize="small" color="action" />}
                      >
                        Notes: {(item as MangaCollectionItem).notes}
                      </ListDetailRow>
                    )}
                  </>
                )}
              </Stack>
            ))}
          </Stack>
        ) : undefined
      }
      sidebarExtra={
        kitsuId ? (
          <RelatedMediaCards kitsuId={kitsuId} mediaType={mediaType} />
        ) : undefined
      }
      seriesDetails={
        <ProviderSeriesDetails
          kitsuId={kitsuId}
          mediaType={mediaType}
          anilistId={anilistId}
          initialDetail={initialDetail}
        />
      }
    />
  );
}
