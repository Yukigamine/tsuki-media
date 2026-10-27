"use client";

import { Box, Container, Paper, Stack, Typography } from "@mui/material";
import Image from "next/image";
import type { ReactNode } from "react";

type Props = {
  title: string;
  mediaType: "anime" | "manga";
  subtitle?: string | null;
  heroBanner: string | null;
  coverImage: string | null;
  heroOverlay?: ReactNode;
  heroContent?: ReactNode;
  heroChips: ReactNode;
  quickActions?: ReactNode;
  listStatus: ReactNode;
  collectionOwnership?: ReactNode;
  sidebarExtra?: ReactNode;
  seriesDetails: ReactNode;
};

export default function MediaDetailLayout({
  title,
  mediaType,
  subtitle,
  heroBanner,
  coverImage,
  heroOverlay,
  heroContent,
  heroChips,
  quickActions,
  listStatus,
  collectionOwnership,
  sidebarExtra,
  seriesDetails,
}: Props) {
  return (
    <Container maxWidth="lg" sx={{ py: 4, minWidth: 0, overflowX: "hidden" }}>
      <Paper sx={{ overflow: "hidden", borderRadius: 3, mb: 3 }}>
        <Box
          sx={{
            position: "relative",
            minHeight: { xs: 220, sm: 300 },
            bgcolor: "grey.900",
            color: "common.white",
            display: "flex",
            alignItems: "flex-end",
            px: { xs: 2, sm: 4 },
            py: { xs: 2, sm: 3 },
            backgroundImage: heroBanner
              ? `linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.3)), url(${heroBanner})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {heroContent ?? (
            <>
              {heroOverlay}
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{
                  alignItems: { xs: "flex-start", sm: "flex-end" },
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <Box
                  sx={{
                    width: 124,
                    height: 176,
                    borderRadius: 2,
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.2)",
                    position: "relative",
                    bgcolor: "grey.800",
                    flexShrink: 0,
                  }}
                >
                  {coverImage && (
                    <Image
                      src={coverImage}
                      alt={title}
                      fill
                      sizes="124px"
                      style={{ objectFit: "cover" }}
                      unoptimized
                    />
                  )}
                </Box>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    {title}
                  </Typography>
                  {subtitle && (
                    <Typography variant="subtitle1" sx={{ opacity: 0.9 }}>
                      {subtitle}
                    </Typography>
                  )}
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ mt: 1, flexWrap: "wrap" }}
                  >
                    {heroChips}
                  </Stack>
                </Box>
              </Stack>
            </>
          )}
        </Box>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            md: "320px minmax(0, 1fr)",
          },
          gap: 3,
          alignItems: { xs: "start", md: "start" },
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            display: { xs: "contents", md: "block" },
            width: "100%",
            alignSelf: "start",
            minWidth: 0,
            position: { md: "sticky" },
            top: { md: 92 },
            zIndex: 100,
          }}
        >
          <Stack
            spacing={2.5}
            sx={{
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              overflow: "hidden",
              alignSelf: "start",
              order: { xs: 1, md: "initial" },
            }}
          >
            {quickActions && <Paper sx={{ p: 2.5 }}>{quickActions}</Paper>}

            <Paper sx={{ p: 2.5 }}>
              <Typography variant="h6" sx={{ mb: 1.25 }}>
                {mediaType === "anime"
                  ? "Anime List Entry"
                  : "Manga List Entry"}
              </Typography>
              {listStatus}
            </Paper>

            {collectionOwnership && (
              <Paper sx={{ p: 2.5 }}>
                <Typography variant="h6" sx={{ mb: 1.25 }}>
                  Collection Details
                </Typography>
                {collectionOwnership}
              </Paper>
            )}
          </Stack>

          {sidebarExtra && (
            <Paper
              sx={{
                p: 2.5,
                mt: { xs: 0, md: 2.5 },
                order: { xs: 3, md: "initial" },
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                overflow: "hidden",
                "&:has(.related-media-empty)": { display: "none" },
              }}
            >
              {sidebarExtra}
            </Paper>
          )}
        </Box>

        <Paper
          sx={{
            p: 2.5,
            order: { xs: 2, md: "initial" },
            flex: 1,
            width: "100%",
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden",
          }}
        >
          {seriesDetails}
        </Paper>
      </Box>
    </Container>
  );
}
