"use client";

import { Box, Grid, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MangaListEntry } from "@/generated/prisma/client";
import type { MangaWithEntry } from "@/lib/list";
import { getMangaDetailPath } from "@/lib/media-routing";
import CardSkeleton from "./CardSkeleton";
import type { ViewMode } from "./CollectionViewToggle";
import ListAddButton from "./ListAddButton";
import MangaCard from "./MangaCard";
import MangaListEntryEditModal from "./MangaListEntryEditModal";
import { MediaLibraryToolbar } from "./MediaLibraryToolbar";
import { MediaListTable } from "./MediaListTable";

type StatusTab =
  | "ALL"
  | "READING"
  | "COMPLETED"
  | "PLAN_TO_READ"
  | "ON_HOLD"
  | "DROPPED";

const TABS: { value: StatusTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "READING", label: "Reading" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PLAN_TO_READ", label: "Want to Read" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

export default function MangaListClient({
  items,
  counts,
  existingKitsuIds,
  isAuthenticated,
}: {
  items: MangaWithEntry[];
  counts: Record<string, number>;
  existingKitsuIds: string[];
  isAuthenticated: boolean;
}) {
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<MangaWithEntry | null>(null);
  const [localItems, setLocalItems] = useState<MangaWithEntry[]>(items);
  const [isPending, startTransition] = useTransition();
  const tabCacheRef = useRef<Record<StatusTab, MangaWithEntry[]>>(
    {} as Record<StatusTab, MangaWithEntry[]>,
  );

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  useEffect(() => {
    const cache: Record<StatusTab, MangaWithEntry[]> = {} as Record<
      StatusTab,
      MangaWithEntry[]
    >;
    TABS.forEach(({ value: tab }) => {
      if (tab === "ALL") {
        cache[tab] = localItems;
      } else {
        cache[tab] = localItems.filter((i) => i.listEntry?.readStatus === tab);
      }
    });
    tabCacheRef.current = cache;
  }, [localItems]);

  const filtered = useMemo(() => {
    let list = tabCacheRef.current[activeTab] ?? localItems;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          (i.titleEn ?? "").toLowerCase().includes(q) ||
          (i.titleRomaji ?? "").toLowerCase().includes(q) ||
          (i.titleJp ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeTab, search, localItems]);

  const applyOptimisticSave = (
    mangaId: string,
    patch: {
      readStatus: MangaListEntry["readStatus"];
      progress: number;
      progressVolumes: number;
      rating: number | null;
      notes: string | null;
      rereadCount: number;
      rereading: boolean;
    },
  ) => {
    setLocalItems((current) =>
      current.map((item) => {
        if (item.id !== mangaId) return item;

        const existing = item.listEntry;
        return {
          ...item,
          listEntry: {
            id: existing?.id ?? "optimistic",
            mangaId,
            readStatus: patch.readStatus,
            progress: patch.progress,
            progressVolumes: patch.progressVolumes,
            rating: patch.rating,
            notes: patch.notes,
            private: existing?.private ?? false,
            rereadCount: patch.rereadCount,
            rereading: patch.rereading,
            kitsuEntryId: existing?.kitsuEntryId ?? null,
            anilistEntryId: existing?.anilistEntryId ?? null,
            startedAt: existing?.startedAt ?? null,
            completedAt: existing?.completedAt ?? null,
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date(),
          },
        };
      }),
    );
  };

  const applyOptimisticRemove = (mangaId: string) => {
    setLocalItems((current) =>
      current.map((item) =>
        item.id === mangaId ? { ...item, listEntry: null } : item,
      ),
    );
  };

  return (
    <Box>
      <MediaLibraryToolbar
        tabs={TABS.map((tab) => ({ ...tab, count: counts[tab.value] }))}
        activeTab={activeTab}
        onTabChange={(tab) => {
          startTransition(() => setActiveTab(tab));
        }}
        onSearchChange={setSearch}
        view={view}
        onViewChange={setView}
        mobileAdd={
          isAuthenticated ? (
            <Box sx={{ display: { xs: "block", md: "none" } }}>
              <ListAddButton
                type="manga"
                existingKitsuIds={existingKitsuIds}
                iconOnly
              />
            </Box>
          ) : undefined
        }
      />

      {isPending ? (
        <Grid container spacing={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <CardSkeleton />
            </Grid>
          ))}
        </Grid>
      ) : filtered.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <Typography variant="h6">No entries found</Typography>
          {search && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Try a different search term
            </Typography>
          )}
        </Box>
      ) : view === "grid" ? (
        <Grid container spacing={2}>
          {filtered.map((item) => (
            <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <MangaCard
                item={item}
                detailHref={getMangaDetailPath(item)}
                onEdit={(next) => setSelected(next)}
                canEdit={isAuthenticated}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <MediaListTable
          type="manga"
          items={filtered}
          onEdit={setSelected}
          canEdit={isAuthenticated}
        />
      )}

      {selected && (
        <MangaListEntryEditModal
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          mangaId={selected.id}
          title={
            selected.titleEn ??
            selected.titleRomaji ??
            selected.titleJp ??
            "Unknown"
          }
          chapterCount={selected.chapterCount}
          volumeCount={selected.volumeCount}
          entry={selected.listEntry}
          onSaved={(patch) => applyOptimisticSave(selected.id, patch)}
          onRemoved={() => applyOptimisticRemove(selected.id)}
        />
      )}
    </Box>
  );
}
