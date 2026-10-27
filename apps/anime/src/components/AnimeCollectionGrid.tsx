"use client";

import { Box } from "@mui/material";
import { CollectionCard } from "@/components/CollectionCard";
import { CollectionItemActions } from "@/components/CollectionItemActions";
import type { Anime, AnimeCollectionItem } from "@/generated/prisma/client";
import { getAnimeDetailPath } from "@/lib/media-routing";

type Props = {
  items: (AnimeCollectionItem & { anime: Anime })[];
  isAuthenticated?: boolean;
};

const RARITY_COLORS: Record<string, string> = {
  STANDARD: "#90caf9",
  COLLECTORS: "#81c784",
  DELUXE: "#9c27b0",
  STEELBOOK: "#ffb74d",
  LIMITED: "#ef5350",
};

const RARITY_LABELS: Record<string, string> = {
  STANDARD: "Standard",
  COLLECTORS: "Collector's",
  DELUXE: "Deluxe",
  STEELBOOK: "Steelbook",
  LIMITED: "Limited",
};

const FORMAT_COLORS: Record<string, string> = {
  DVD: "#795548",
  BLU_RAY: "#1976d2",
  VHS: "#f57c00",
  DIGITAL: "#00796b",
  OTHER: "#757575",
};

const FORMAT_LABELS: Record<string, string> = {
  DVD: "DVD",
  BLU_RAY: "Blu-ray",
  VHS: "VHS",
  DIGITAL: "Digital",
  OTHER: "Other",
};

export function AnimeCollectionGrid({ items, isAuthenticated = false }: Props) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, 1fr)",
          sm: "repeat(3, 1fr)",
          md: "repeat(4, 1fr)",
          lg: "repeat(5, 1fr)",
        },
        gap: 2,
        py: 2,
      }}
    >
      {items.map((item) => (
        <CollectionCard
          key={item.id}
          image={item.anime.coverImageUrl || "/placeholder.png"}
          imageAlt={item.anime.titleEn || ""}
          title={item.anime.titleEn || ""}
          href={getAnimeDetailPath(item.anime)}
          actions={
            isAuthenticated ? (
              <CollectionItemActions
                title={item.anime.titleEn || ""}
                editHref={`/collection/anime/${item.id}/edit`}
                card
              />
            ) : undefined
          }
          chips={[
            {
              label: RARITY_LABELS[item.rarity] ?? item.rarity,
              color: RARITY_COLORS[item.rarity],
            },
            {
              label: FORMAT_LABELS[item.format] ?? item.format,
              color: FORMAT_COLORS[item.format],
            },
          ]}
        />
      ))}
    </Box>
  );
}
