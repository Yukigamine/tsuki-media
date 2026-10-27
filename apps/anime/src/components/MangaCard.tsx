"use client";

import EditIcon from "@mui/icons-material/Edit";
import ReplayIcon from "@mui/icons-material/Replay";
import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Rating,
  Tooltip,
  Typography,
} from "@mui/material";
import Image from "next/image";
import { memo } from "react";
import AppLink from "@/components/Link";
import type { MangaListEntry } from "@/generated/prisma/client";
import type { MangaWithEntry } from "@/lib/list";

const STATUS_COLORS = {
  READING: "primary",
  PLAN_TO_READ: "default",
  COMPLETED: "success",
  ON_HOLD: "warning",
  DROPPED: "error",
} as const;

const STATUS_LABELS: Record<MangaListEntry["readStatus"], string> = {
  READING: "Reading",
  PLAN_TO_READ: "Want to Read",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
  DROPPED: "Dropped",
};

function MangaCard({
  item,
  detailHref,
  onEdit,
  canEdit,
}: {
  item: MangaWithEntry;
  detailHref: string;
  onEdit: (item: MangaWithEntry) => void;
  canEdit: boolean;
}) {
  const entry = item.listEntry;
  const title = item.titleEn ?? item.titleRomaji ?? item.titleJp ?? "Unknown";
  const chapterProgress =
    item.chapterCount != null
      ? `${entry?.progress ?? 0} / ${item.chapterCount} ch`
      : `${entry?.progress ?? 0} ch`;

  const volumeProgress =
    (entry?.progressVolumes ?? 0) > 0
      ? item.volumeCount != null
        ? `${entry?.progressVolumes} / ${item.volumeCount} vol`
        : `${entry?.progressVolumes} vol`
      : null;

  return (
    <Card
      sx={{
        display: "flex",
        height: 140,
        contentVisibility: "auto",
        containIntrinsicSize: "140px",
        overflow: "hidden",
        position: "relative",
        transition: "transform 0.15s, box-shadow 0.15s",
        "&:hover": { transform: "translateY(-2px)", boxShadow: 6 },
        "&:hover .edit-action, &:focus-within .edit-action": {
          opacity: 1,
          pointerEvents: "auto",
        },
      }}
    >
      <AppLink
        href={detailHref}
        aria-label={`View ${title}`}
        sx={{
          display: "block",
          position: "relative",
          width: 93,
          flexShrink: 0,
          bgcolor: "background.default",
        }}
      >
        {item.coverImageUrl ? (
          <Image
            src={item.coverImageUrl}
            alt={title}
            fill
            sizes="93px"
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
      </AppLink>

      {canEdit && (
        <Tooltip title={`Edit ${title}`}>
          <IconButton
            className="edit-action"
            size="small"
            onClick={() => onEdit(item)}
            sx={{
              position: "absolute",
              bottom: 4,
              right: 4,
              bgcolor: "background.paper",
              zIndex: 1,
              opacity: 0,
              pointerEvents: "none",
              transition: "opacity 0.15s ease",
            }}
            aria-label={`Edit ${title}`}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      <CardContent
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          py: 1.5,
          px: 2,
          "&:last-child": { pb: 1.5 },
          overflow: "hidden",
        }}
      >
        <Tooltip title={title} placement="top-start">
          <AppLink
            href={detailHref}
            sx={{ color: "inherit", textDecoration: "none" }}
          >
            <Typography
              variant="subtitle1"
              noWrap
              sx={{ fontWeight: 600, lineHeight: 1.3 }}
            >
              {title}
            </Typography>
          </AppLink>
        </Tooltip>

        {item.titleJp && item.titleJp !== title && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {item.titleJp}
          </Typography>
        )}

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mt: "auto",
            flexWrap: "wrap",
          }}
        >
          {entry && (
            <Chip
              label={
                entry.readStatus === "READING" && entry.rereading ? (
                  <Box
                    component="span"
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 0.25,
                    }}
                  >
                    Reading <ReplayIcon fontSize="small" />
                  </Box>
                ) : (
                  STATUS_LABELS[entry.readStatus]
                )
              }
              color={STATUS_COLORS[entry.readStatus]}
              size="small"
              sx={{ fontWeight: 500 }}
            />
          )}
          <Typography variant="body2" color="text.secondary">
            {chapterProgress}
          </Typography>
          {volumeProgress && (
            <Typography variant="body2" color="text.secondary">
              · {volumeProgress}
            </Typography>
          )}
          {(entry?.rereadCount ?? 0) > 0 && (
            <Typography variant="caption" color="text.disabled">
              ×{entry?.rereadCount}
            </Typography>
          )}
        </Box>

        {entry?.rating != null && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Rating
              value={entry.rating / 2}
              precision={0.5}
              size="small"
              readOnly
            />
            <Typography variant="caption" color="text.secondary">
              {entry.rating.toFixed(1)}
            </Typography>
          </Box>
        )}

        {entry?.notes && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
            }}
          >
            {entry.notes}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(MangaCard);
