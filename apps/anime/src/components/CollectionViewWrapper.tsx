"use client";

import {
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import { useMemo, useState } from "react";
import { CollectionAddButton } from "@/components/CollectionAddButton";
import { CollectionItemActions } from "@/components/CollectionItemActions";
import type { ViewMode } from "@/components/CollectionViewToggle";
import { MediaLibraryToolbar } from "@/components/MediaLibraryToolbar";
import type {
  Anime,
  AnimeCollectionItem,
  Manga,
  MangaCollectionItem,
} from "@/generated/prisma/client";
import { formatContiguousRanges } from "@/lib/formatRanges";
import { getAnimeDetailPath, getMangaDetailPath } from "@/lib/media-routing";

type AnimeItem = AnimeCollectionItem & { anime: Anime };
type MangaItem = MangaCollectionItem & { manga: Manga };
type Item = AnimeItem | MangaItem;

interface Props<T> {
  items: T[];
  type: "anime" | "manga";
  gridComponent: React.ComponentType<{ items: T[]; isAuthenticated: boolean }>;
  isAuthenticated?: boolean;
}

type CollectionTab =
  | "ALL"
  | "BLU_RAY"
  | "DVD"
  | "VHS"
  | "DIGITAL"
  | "ENGLISH"
  | "OTHER";

const ANIME_TABS: Array<{ value: CollectionTab; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "BLU_RAY", label: "Blu-ray" },
  { value: "DVD", label: "DVD" },
  { value: "VHS", label: "VHS" },
  { value: "DIGITAL", label: "Digital" },
  { value: "OTHER", label: "Other" },
];

const MANGA_TABS: Array<{ value: CollectionTab; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ENGLISH", label: "English" },
];

const RARITY_LABELS: Record<string, string> = {
  STANDARD: "Standard",
  COLLECTORS: "Collector's",
  DELUXE: "Deluxe",
  STEELBOOK: "Steelbook",
  LIMITED: "Limited",
};

const CONDITION_COLORS: Record<
  string,
  "success" | "primary" | "warning" | "error"
> = {
  MINT: "success",
  NEAR_MINT: "success",
  GOOD: "primary",
  FAIR: "warning",
  POOR: "error",
};

const FORMAT_LABELS: Record<string, string> = {
  DVD: "DVD",
  BLU_RAY: "Blu-ray",
  VHS: "VHS",
  DIGITAL: "Digital",
  OTHER: "Other",
};

const LANGUAGE_LABELS: Record<string, string> = {
  ENGLISH: "🇬🇧 English",
  JAPANESE: "🇯🇵 Japanese",
  OTHER: "🌐 Other",
};

function getCollectionTitle(item: Item): string {
  const media = "anime" in item ? item.anime : item.manga;
  return media.titleEn ?? media.titleRomaji ?? media.titleJp ?? "Unknown";
}

export function CollectionViewWrapper<T extends Item>({
  items,
  type,
  gridComponent: GridComponent,
  isAuthenticated = false,
}: Props<T>) {
  const [view, setView] = useState<ViewMode>("grid");
  const [activeTab, setActiveTab] = useState<CollectionTab>("ALL");
  const [search, setSearch] = useState("");

  const getCoverUrl = (item: T): string => {
    if ("anime" in item)
      return (item.anime as Anime).coverImageUrl || "/placeholder.png";
    return (item.manga as Manga).coverImageUrl || "/placeholder.png";
  };

  const getDetailPath = (item: T): string => {
    return "anime" in item
      ? getAnimeDetailPath(item.anime as Anime)
      : getMangaDetailPath(item.manga as Manga);
  };

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: items.length };
    for (const item of items) {
      const category =
        "anime" in item
          ? (item as AnimeItem).format
          : (item as MangaItem).language;
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }, [items]);
  const tabs = (type === "anime" ? ANIME_TABS : MANGA_TABS).filter(
    (tab) => (tabCounts[tab.value] ?? 0) > 0,
  );
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const category =
        "anime" in item
          ? (item as AnimeItem).format
          : (item as MangaItem).language;
      const matchesTab = activeTab === "ALL" || category === activeTab;
      const matchesSearch =
        !query || getCollectionTitle(item).toLowerCase().includes(query);
      return matchesTab && matchesSearch;
    });
  }, [activeTab, items, search]);

  return (
    <Stack spacing={2}>
      <MediaLibraryToolbar
        tabs={tabs.map((tab) => ({ ...tab, count: tabCounts[tab.value] ?? 0 }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSearchChange={setSearch}
        view={view}
        onViewChange={setView}
        mobileAdd={
          isAuthenticated ? (
            <Box sx={{ display: { xs: "block", md: "none" } }}>
              <CollectionAddButton type={type} iconOnly />
            </Box>
          ) : undefined
        }
      />

      {filteredItems.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          No collection items found
        </Box>
      ) : view === "grid" ? (
        <GridComponent
          items={filteredItems}
          isAuthenticated={isAuthenticated}
        />
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    width: 48,
                    minWidth: 48,
                    maxWidth: 48,
                    boxSizing: "border-box",
                    p: 0.5,
                  }}
                />
                <TableCell sx={{ minWidth: 150, pl: 0.5 }}>Title</TableCell>
                {type !== "manga" && (
                  <>
                    <TableCell>Rarity</TableCell>
                    <TableCell>Format</TableCell>
                  </>
                )}
                <TableCell>Condition</TableCell>
                {type === "manga" && <TableCell>Language</TableCell>}
                {type !== "manga" && (
                  <>
                    <TableCell>Purchased</TableCell>
                    <TableCell align="right">Price</TableCell>
                  </>
                )}
                {type === "manga" && (
                  <>
                    <TableCell align="center">Volumes</TableCell>
                    <TableCell align="center">Chapters</TableCell>
                  </>
                )}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredItems.map((item) => {
                const title = getCollectionTitle(item);
                const coverUrl = getCoverUrl(item);
                const isMangaItem = "manga" in item;
                const mangaItem = isMangaItem ? (item as MangaItem) : null;

                return (
                  <TableRow key={item.id} hover>
                    <TableCell
                      sx={{
                        width: 48,
                        minWidth: 48,
                        maxWidth: 48,
                        boxSizing: "border-box",
                        p: 0.5,
                      }}
                    >
                      <Box
                        component="img"
                        src={coverUrl}
                        alt={title}
                        sx={{
                          width: 40,
                          height: 50,
                          objectFit: "cover",
                          borderRadius: 0.5,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 150, fontWeight: 500, pl: 0.5 }}>
                      <Box
                        component="a"
                        href={getDetailPath(item)}
                        sx={{ color: "inherit", textDecoration: "none" }}
                      >
                        {title}
                      </Box>
                    </TableCell>
                    {type !== "manga" && (
                      <>
                        <TableCell>
                          {RARITY_LABELS[(item as AnimeItem).rarity] ??
                            (item as AnimeItem).rarity}
                        </TableCell>
                        <TableCell>
                          {FORMAT_LABELS[(item as AnimeItem).format] ??
                            (item as AnimeItem).format}
                        </TableCell>
                      </>
                    )}
                    <TableCell>
                      <Chip
                        label={item.condition}
                        color={CONDITION_COLORS[item.condition] ?? "default"}
                        size="small"
                      />
                    </TableCell>
                    {type === "manga" && (
                      <TableCell>
                        {LANGUAGE_LABELS[(item as MangaItem).language] ??
                          (item as MangaItem).language}
                      </TableCell>
                    )}
                    {type !== "manga" &&
                      (() => {
                        const animeItem = item as AnimeItem;
                        return (
                          <>
                            <TableCell>
                              {animeItem.purchasedAt instanceof Date
                                ? animeItem.purchasedAt.toLocaleDateString()
                                : "—"}
                            </TableCell>
                            <TableCell align="right">
                              {animeItem.pricePaid != null
                                ? `$${animeItem.pricePaid.toFixed(2)}`
                                : "—"}
                            </TableCell>
                          </>
                        );
                      })()}
                    {type === "manga" && mangaItem && (
                      <>
                        <TableCell align="center">
                          <Tooltip
                            title={
                              mangaItem.volumes && mangaItem.volumes.length > 0
                                ? `Vol ${formatContiguousRanges(mangaItem.volumes)}`
                                : "No volumes recorded"
                            }
                          >
                            <span>{mangaItem.volumes?.length || 0}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip
                            title={
                              mangaItem.chapters &&
                              mangaItem.chapters.length > 0
                                ? `Ch ${formatContiguousRanges(mangaItem.chapters)}`
                                : "No chapters recorded"
                            }
                          >
                            <span>{mangaItem.chapters?.length || 0}</span>
                          </Tooltip>
                        </TableCell>
                      </>
                    )}
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {isAuthenticated && (
                        <CollectionItemActions
                          title={title}
                          editHref={`/collection/${type}/${item.id}/edit`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
