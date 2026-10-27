"use client";

import { Box, Grid, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AnimeListEntry } from "@/generated/prisma/client";
import type { AnimeWithEntry } from "@/lib/list";
import { getAnimeDetailPath } from "@/lib/media-routing";
import AnimeCard from "./AnimeCard";
import AnimeListEntryEditModal from "./AnimeListEntryEditModal";
import CardSkeleton from "./CardSkeleton";
import type { ViewMode } from "./CollectionViewToggle";
import ListAddButton from "./ListAddButton";
import { MediaLibraryToolbar } from "./MediaLibraryToolbar";
import { MediaListTable } from "./MediaListTable";

type StatusTab =
  | "ALL"
  | "WATCHING"
  | "COMPLETED"
  | "PLAN_TO_WATCH"
  | "ON_HOLD"
  | "DROPPED";

const TABS: { value: StatusTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "WATCHING", label: "Watching" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PLAN_TO_WATCH", label: "Plan to Watch" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

export default function AnimeListClient({
  items,
  counts,
  existingKitsuIds,
  isAuthenticated,
}: {
  items: AnimeWithEntry[];
  counts: Record<string, number>;
  existingKitsuIds: string[];
  isAuthenticated: boolean;
}) {
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<AnimeWithEntry | null>(null);
  const [localItems, setLocalItems] = useState<AnimeWithEntry[]>(items);
  const [isPending, startTransition] = useTransition();
  const tabCacheRef = useRef<Record<StatusTab, AnimeWithEntry[]>>(
    {} as Record<StatusTab, AnimeWithEntry[]>,
  );

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  useEffect(() => {
    const cache: Record<StatusTab, AnimeWithEntry[]> = {} as Record<
      StatusTab,
      AnimeWithEntry[]
    >;
    TABS.forEach(({ value: tab }) => {
      if (tab === "ALL") {
        cache[tab] = localItems;
      } else {
        cache[tab] = localItems.filter((i) => i.listEntry?.watchStatus === tab);
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
    animeId: string,
    patch: {
      watchStatus: AnimeListEntry["watchStatus"];
      progress: number;
      rating: number | null;
      notes: string | null;
      rewatchCount: number;
      rewatching: boolean;
    },
  ) => {
    setLocalItems((current) =>
      current.map((item) => {
        if (item.id !== animeId) return item;

        const existing = item.listEntry;
        return {
          ...item,
          listEntry: {
            id: existing?.id ?? "optimistic",
            animeId,
            watchStatus: patch.watchStatus,
            progress: patch.progress,
            rating: patch.rating,
            notes: patch.notes,
            private: existing?.private ?? false,
            rewatchCount: patch.rewatchCount,
            rewatching: patch.rewatching,
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

  const applyOptimisticRemove = (animeId: string) => {
    setLocalItems((current) =>
      current.map((item) =>
        item.id === animeId ? { ...item, listEntry: null } : item,
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
                type="anime"
                existingKitsuIds={existingKitsuIds}
                iconOnly
              />
            </Box>
          ) : undefined
        }
      />

      {isPending ? (
        <Grid container spacing={2}>
          {Array.from({ length: 12 }).map((_, i) => (
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
              <AnimeCard
                item={item}
                detailHref={getAnimeDetailPath(item)}
                onEdit={(next) => setSelected(next)}
                canEdit={isAuthenticated}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <MediaListTable
          type="anime"
          items={filtered}
          onEdit={setSelected}
          canEdit={isAuthenticated}
        />
      )}

      {selected && (
        <AnimeListEntryEditModal
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          animeId={selected.id}
          title={
            selected.titleEn ??
            selected.titleRomaji ??
            selected.titleJp ??
            "Unknown"
          }
          episodeCount={selected.episodeCount}
          entry={selected.listEntry}
          onSaved={(patch) => applyOptimisticSave(selected.id, patch)}
          onRemoved={() => applyOptimisticRemove(selected.id)}
        />
      )}
    </Box>
  );
}
