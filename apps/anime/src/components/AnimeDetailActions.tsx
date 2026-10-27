"use client";

import PlusOneIcon from "@mui/icons-material/PlusOne";
import ReplayIcon from "@mui/icons-material/Replay";
import { useRouter } from "next/navigation";
import { enqueueSnackbar } from "notistack";
import { useMemo, useState, useTransition } from "react";
import type { AnimeListEntry } from "@/generated/prisma/client";
import {
  applyAnimeQuickStatus,
  resolveAndApplyAnimeQuickStatus,
  startAnimeRewatch,
  upsertAnimeListEntry,
} from "@/lib/actions/list";
import { getAnimeResolvePayloadBySlug } from "@/lib/kitsu/client-queries";
import AnimeListEntryEditModal from "./AnimeListEntryEditModal";
import MediaDetailActionButtons from "./MediaDetailActionButtons";

type Props = {
  animeId: string | null;
  kitsuId: string;
  title: string;
  episodeCount: number | null;
  entry: AnimeListEntry | null;
};

export default function AnimeDetailActions({
  animeId,
  kitsuId,
  title,
  episodeCount,
  entry,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const status = entry?.watchStatus;

  const quickActions = useMemo(() => {
    if (!status) {
      return [
        { key: "PLAN_TO_WATCH", label: "Want to Watch" },
        { key: "WATCHING", label: "Watching" },
        { key: "COMPLETED", label: "Completed" },
      ] as const;
    }

    if (status === "PLAN_TO_WATCH") {
      return [
        { key: "WATCHING", label: "Watching" },
        { key: "COMPLETED", label: "Completed" },
      ] as const;
    }

    if (status === "WATCHING") {
      return [{ key: "COMPLETED", label: "Completed" }] as const;
    }

    if (status === "ON_HOLD" || status === "DROPPED") {
      return [
        { key: "WATCHING", label: "Watching" },
        { key: "COMPLETED", label: "Completed" },
      ] as const;
    }

    return [] as const;
  }, [status]);

  const handleStatus = (
    nextStatus: "PLAN_TO_WATCH" | "WATCHING" | "COMPLETED",
  ) => {
    startTransition(async () => {
      const result = animeId
        ? await applyAnimeQuickStatus({ animeId, watchStatus: nextStatus })
        : await (async () => {
            const payload = await getAnimeResolvePayloadBySlug(kitsuId);
            return resolveAndApplyAnimeQuickStatus(
              payload ?? { kitsuId, titleEn: title, episodeCount },
              nextStatus,
            );
          })();
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }
      enqueueSnackbar("Anime status updated.", { variant: "success" });
      router.refresh();
    });
  };

  const handleRewatch = () => {
    if (!animeId) return;
    startTransition(async () => {
      const result = await startAnimeRewatch(animeId);
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }
      enqueueSnackbar("Rewatch started.", { variant: "success" });
      router.refresh();
    });
  };

  const handleIncrementProgress = () => {
    const currentProgress = entry?.progress ?? 0;
    const nextProgress = currentProgress + 1;

    if (episodeCount != null && nextProgress >= episodeCount) {
      handleStatus("COMPLETED");
      return;
    }

    startTransition(async () => {
      if (!animeId) return;
      const result = await upsertAnimeListEntry({
        animeId,
        watchStatus: "WATCHING",
        progress: nextProgress,
      });
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }
      enqueueSnackbar("Episode progress updated.", { variant: "success" });
      router.refresh();
    });
  };

  return (
    <>
      <MediaDetailActionButtons
        pending={isPending}
        quickActions={quickActions.map((action) => ({
          ...action,
          onClick: () => handleStatus(action.key),
        }))}
        topAction={
          status === "WATCHING"
            ? {
                label: "Episode",
                icon: <PlusOneIcon />,
                onClick: handleIncrementProgress,
              }
            : undefined
        }
        bottomAction={
          status === "COMPLETED"
            ? { label: "Rewatch", icon: <ReplayIcon />, onClick: handleRewatch }
            : undefined
        }
        onEdit={animeId ? () => setEditOpen(true) : undefined}
      />

      {animeId ? (
        <AnimeListEntryEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          animeId={animeId}
          title={title}
          episodeCount={episodeCount}
          entry={entry}
        />
      ) : null}
    </>
  );
}
