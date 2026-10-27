"use client";

import { Box } from "@mui/material";
import { CollectionCard } from "@/components/CollectionCard";
import { CollectionItemActions } from "@/components/CollectionItemActions";
import type { Manga, MangaCollectionItem } from "@/generated/prisma/client";
import { formatContiguousRanges } from "@/lib/formatRanges";
import { getMangaDetailPath } from "@/lib/media-routing";

type Props = {
  items: (MangaCollectionItem & { manga: Manga })[];
  isAuthenticated?: boolean;
};

const _RARITY_COLORS: Record<string, string> = {
  STANDARD: "#90caf9",
  COLLECTORS: "#81c784",
  DELUXE: "#ffd54f",
  STEELBOOK: "#ffb74d",
  LIMITED: "#ef5350",
};

export function MangaCollectionGrid({ items, isAuthenticated = false }: Props) {
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
      {items.map((item) => {
        const chips: Array<{
          label: string;
          color: string;
          icon?: React.ReactNode;
        }> = [];

        const LANGUAGE_LABELS: Record<string, string> = {
          ENGLISH: "English",
          JAPANESE: "Japanese",
          OTHER: "Other",
        };

        const LANGUAGE_ICONS: Record<string, React.ReactNode> = {
          ENGLISH: "🇬🇧",
          JAPANESE: "🇯🇵",
          OTHER: "🌐",
        };

        chips.push({
          label: LANGUAGE_LABELS[item.language] || item.language,
          color: "#7b68ee",
          icon: LANGUAGE_ICONS[item.language],
        });

        if (item.volumes && item.volumes.length > 0) {
          chips.push({
            label: `Vol ${formatContiguousRanges(item.volumes)}`,
            color: "#757575",
          });
        }

        if (item.chapters && item.chapters.length > 0) {
          chips.push({
            label: `Ch ${formatContiguousRanges(item.chapters)}`,
            color: "#9575cd",
          });
        }

        return (
          <CollectionCard
            key={item.id}
            image={item.manga.coverImageUrl || "/placeholder.png"}
            imageAlt={item.manga.titleEn || ""}
            title={item.manga.titleEn || ""}
            href={getMangaDetailPath(item.manga)}
            actions={
              isAuthenticated ? (
                <CollectionItemActions
                  title={item.manga.titleEn || ""}
                  editHref={`/collection/manga/${item.id}/edit`}
                  card
                />
              ) : undefined
            }
            chips={chips}
          />
        );
      })}
    </Box>
  );
}
