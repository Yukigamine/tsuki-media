"use client";

import PlusOneIcon from "@mui/icons-material/PlusOne";
import ReplayIcon from "@mui/icons-material/Replay";
import { useRouter } from "next/navigation";
import { enqueueSnackbar } from "notistack";
import { useMemo, useState, useTransition } from "react";
import type { MangaListEntry } from "@/generated/prisma/client";
import {
  applyMangaQuickStatus,
  resolveAndApplyMangaQuickStatus,
  startMangaReread,
  upsertMangaListEntry,
} from "@/lib/actions/list";
import { getMangaResolvePayloadBySlug } from "@/lib/kitsu/client-queries";
import MangaListEntryEditModal from "./MangaListEntryEditModal";
import MediaDetailActionButtons from "./MediaDetailActionButtons";

type Props = {
  mangaId: string | null;
  kitsuId: string;
  title: string;
  chapterCount: number | null;
  volumeCount: number | null;
  entry: MangaListEntry | null;
};

export default function MangaDetailActions({
  mangaId,
  kitsuId,
  title,
  chapterCount,
  volumeCount,
  entry,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const status = entry?.readStatus;

  const quickActions = useMemo(() => {
    if (!status) {
      return [
        { key: "PLAN_TO_READ", label: "Want to Read" },
        { key: "READING", label: "Reading" },
        { key: "COMPLETED", label: "Completed" },
      ] as const;
    }

    if (status === "PLAN_TO_READ") {
      return [
        { key: "READING", label: "Reading" },
        { key: "COMPLETED", label: "Completed" },
      ] as const;
    }

    if (status === "READING") {
      return [{ key: "COMPLETED", label: "Completed" }] as const;
    }

    if (status === "ON_HOLD" || status === "DROPPED") {
      return [
        { key: "READING", label: "Reading" },
        { key: "COMPLETED", label: "Completed" },
      ] as const;
    }

    return [] as const;
  }, [status]);

  const handleStatus = (
    nextStatus: "PLAN_TO_READ" | "READING" | "COMPLETED",
  ) => {
    startTransition(async () => {
      const result = mangaId
        ? await applyMangaQuickStatus({ mangaId, readStatus: nextStatus })
        : await (async () => {
            const payload = await getMangaResolvePayloadBySlug(kitsuId);
            return resolveAndApplyMangaQuickStatus(
              payload ?? { kitsuId, titleEn: title, chapterCount, volumeCount },
              nextStatus,
            );
          })();
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }
      enqueueSnackbar("Manga status updated.", { variant: "success" });
      router.refresh();
    });
  };

  const handleReread = () => {
    if (!mangaId) return;
    startTransition(async () => {
      const result = await startMangaReread(mangaId);
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }
      enqueueSnackbar("Reread started.", { variant: "success" });
      router.refresh();
    });
  };

  const handleIncrementProgress = () => {
    const currentProgress = entry?.progress ?? 0;
    const nextProgress = currentProgress + 1;

    if (chapterCount != null && nextProgress >= chapterCount) {
      handleStatus("COMPLETED");
      return;
    }

    startTransition(async () => {
      if (!mangaId) return;
      const result = await upsertMangaListEntry({
        mangaId,
        readStatus: "READING",
        progress: nextProgress,
      });
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }
      enqueueSnackbar("Chapter progress updated.", { variant: "success" });
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
          status === "READING"
            ? {
                label: "Chapter",
                icon: <PlusOneIcon />,
                onClick: handleIncrementProgress,
              }
            : undefined
        }
        bottomAction={
          status === "COMPLETED"
            ? { label: "Reread", icon: <ReplayIcon />, onClick: handleReread }
            : undefined
        }
        onEdit={mangaId ? () => setEditOpen(true) : undefined}
      />

      {mangaId ? (
        <MangaListEntryEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          mangaId={mangaId}
          title={title}
          chapterCount={chapterCount}
          volumeCount={volumeCount}
          entry={entry}
        />
      ) : null}
    </>
  );
}
