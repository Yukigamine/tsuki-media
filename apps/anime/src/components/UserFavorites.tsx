"use client";

import { Box, Tab, Tabs, Typography } from "@mui/material";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { KitsuFavoriteItem } from "@/lib/kitsu/user-types";

const TYPE_LABELS: Record<KitsuFavoriteItem["type"], string> = {
  anime: "Anime",
  manga: "Manga",
  character: "Characters",
  person: "People",
};

const TYPE_HREFS: Record<KitsuFavoriteItem["type"], string> = {
  anime: "https://kitsu.app/anime",
  manga: "https://kitsu.app/manga",
  character: "https://kitsu.app/characters",
  person: "https://kitsu.app/people",
};

function FavoriteCard({ item }: { item: KitsuFavoriteItem }) {
  return (
    <Box
      component={Link}
      href={`${TYPE_HREFS[item.type]}/${item.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.75,
        textDecoration: "none",
        color: "inherit",
        width: { xs: "100%", sm: 110 },
        flexShrink: 0,
        "&:hover .fav-img": { boxShadow: 4, transform: "translateY(-2px)" },
      }}
    >
      <Box
        className="fav-img"
        sx={{
          position: "relative",
          width: { xs: "100%", sm: 110 },
          height: { xs: "auto", sm: 155 },
          aspectRatio: "110 / 155",
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: "action.hover",
          transition: "box-shadow 0.15s, transform 0.15s",
          flexShrink: 0,
        }}
      >
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 899px) 45vw, 110px"
            style={{ objectFit: "cover" }}
            unoptimized
          />
        ) : (
          <Box
            sx={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "text.disabled",
              fontSize: 11,
              textAlign: "center",
              p: 0.5,
            }}
          >
            No image
          </Box>
        )}
      </Box>
      <Typography
        variant="caption"
        sx={{
          textAlign: "center",
          lineHeight: 1.3,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          maxWidth: "100%",
        }}
      >
        {item.name}
      </Typography>
    </Box>
  );
}

export default function UserFavorites({
  favorites,
}: {
  favorites: {
    anime: KitsuFavoriteItem[];
    manga: KitsuFavoriteItem[];
    character: KitsuFavoriteItem[];
    person: KitsuFavoriteItem[];
  };
}) {
  const types = (
    ["anime", "manga", "character", "person"] as KitsuFavoriteItem["type"][]
  ).filter((t) => favorites[t].length > 0);

  const [activeTab, setActiveTab] = useState<KitsuFavoriteItem["type"]>(
    types[0] ?? "anime",
  );

  if (types.length === 0) return null;

  const sorted = [...favorites[activeTab]].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v as KitsuFavoriteItem["type"])}
        sx={{
          mb: 2,
          minHeight: { xs: 42, sm: 48 },
          "& .MuiTabs-list": {
            gap: { xs: 0.25, sm: 1 },
            justifyContent: { xs: "space-around", md: "flex-start" },
          },
        }}
      >
        {types.map((t) => (
          <Tab
            key={t}
            value={t}
            label={`${TYPE_LABELS[t]} (${favorites[t].length})`}
            sx={{
              minWidth: 0,
              px: { xs: 0.75, sm: 2 },
              fontSize: { xs: "0.875rem", sm: "0.9rem" },
              textTransform: "none",
              whiteSpace: "nowrap",
            }}
          />
        ))}
      </Tabs>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(auto-fit, minmax(min(100%, 120px), 1fr))",
            sm: "repeat(auto-fit, minmax(110px, 1fr))",
            md: "repeat(auto-fill, 110px)",
          },
          gap: 2,
          justifyContent: "flex-start",
        }}
      >
        {sorted.map((item) => (
          <FavoriteCard key={item.id} item={item} />
        ))}
      </Box>
    </Box>
  );
}
