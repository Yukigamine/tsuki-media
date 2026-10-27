"use client";

import EditIcon from "@mui/icons-material/Edit";
import {
  Box,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import type { AnimeWithEntry, MangaWithEntry } from "@/lib/list";
import { getAnimeDetailPath, getMangaDetailPath } from "@/lib/media-routing";

type Props =
  | {
      type: "anime";
      items: AnimeWithEntry[];
      onEdit: (item: AnimeWithEntry) => void;
      canEdit: boolean;
    }
  | {
      type: "manga";
      items: MangaWithEntry[];
      onEdit: (item: MangaWithEntry) => void;
      canEdit: boolean;
    };

export function MediaListTable(props: Props) {
  const rows = props.items.map((item) => {
    const title = item.titleEn ?? item.titleRomaji ?? item.titleJp ?? "Unknown";
    const isAnime = props.type === "anime";
    const entry = item.listEntry;

    return {
      item,
      title,
      href: isAnime
        ? getAnimeDetailPath(item as AnimeWithEntry)
        : getMangaDetailPath(item as MangaWithEntry),
      status: isAnime
        ? (entry as AnimeWithEntry["listEntry"])?.watchStatus
        : (entry as MangaWithEntry["listEntry"])?.readStatus,
      progress: isAnime
        ? `${(entry as AnimeWithEntry["listEntry"])?.progress ?? 0} / ${(item as AnimeWithEntry).episodeCount ?? "?"}`
        : `${(entry as MangaWithEntry["listEntry"])?.progress ?? 0} ch / ${(item as MangaWithEntry).chapterCount ?? "?"}`,
      repeatCount: isAnime
        ? (entry as AnimeWithEntry["listEntry"])?.rewatchCount
        : (entry as MangaWithEntry["listEntry"])?.rereadCount,
      rating: entry?.rating,
    };
  });

  return (
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
            <TableCell>Status</TableCell>
            <TableCell>Progress</TableCell>
            <TableCell align="center">
              {props.type === "anime" ? "Rewatches" : "Rereads"}
            </TableCell>
            <TableCell align="right">Rating</TableCell>
            {props.canEdit && <TableCell sx={{ width: 56 }} />}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(
            ({ item, title, href, status, progress, repeatCount, rating }) => (
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
                    src={item.coverImageUrl || "/placeholder.png"}
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
                    href={href}
                    sx={{ color: "inherit", textDecoration: "none" }}
                  >
                    {title}
                  </Box>
                </TableCell>
                <TableCell>{status?.replaceAll("_", " ") ?? "—"}</TableCell>
                <TableCell>{progress}</TableCell>
                <TableCell align="center">{repeatCount ?? 0}</TableCell>
                <TableCell align="right">{rating ?? "—"}</TableCell>
                {props.canEdit && (
                  <TableCell align="right">
                    <Tooltip title={`Edit ${title}`}>
                      <IconButton
                        aria-label={`Edit ${title}`}
                        size="small"
                        onClick={() => {
                          if (props.type === "anime") {
                            props.onEdit(item as AnimeWithEntry);
                          } else {
                            props.onEdit(item as MangaWithEntry);
                          }
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
