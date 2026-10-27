"use client";

import AnimationIcon from "@mui/icons-material/Animation";
import CameraRollIcon from "@mui/icons-material/CameraRoll";
import DateRangeIcon from "@mui/icons-material/DateRange";
import ThumbsUpDownIcon from "@mui/icons-material/ThumbsUpDown";
import {
  Box,
  Chip,
  Divider,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import ExternalLinkIcon from "@/components/ExternalLinkIcon";
import MoonRating from "@/components/MoonRating";
import {
  getGenreChipSx,
  resolveExternalLinkIcon,
  SocialIconKey,
} from "@/lib/enums/detail-page";
import { kitsuBrowserClient } from "@/lib/kitsu/browser-client";
import type { MediaDetailSnapshot } from "@/lib/media-detail-types";
import { anilistFuzzyDate, cleanString } from "@/lib/media-values";

type Props = {
  kitsuId: string | null;
  mediaType: "anime" | "manga";
  anilistId: number | null;
  initialDetail: MediaDetailSnapshot | null;
};

type Detail = {
  synopsis: string | null;
  startDate: string | null;
  endDate: string | null;
  productions: string[];
  externalLinks: Array<{ site: string; url: string }>;
  episodeCount: number | null;
  chapterCount: number | null;
  volumeCount: number | null;
  genres: string[];
  studios: string[];
  rating: number | null;
  trailer: { site: string | null; id: string | null } | null;
};

function descriptionText(value: unknown): string | null {
  if (typeof value === "string") return cleanString(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const descriptions = value as Record<string, unknown>;
  return (
    cleanString(descriptions.en) ??
    cleanString(descriptions.en_jp) ??
    Object.values(descriptions).map(cleanString).find(Boolean) ??
    null
  );
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function deduplicateExternalLinks(links: Array<{ site: string; url: string }>) {
  const seen = new Set<string>();
  const streamingIcons = new Set([
    SocialIconKey.CRUNCHYROLL,
    SocialIconKey.HULU,
    SocialIconKey.NETFLIX,
  ]);

  return links.filter((link) => {
    const icon = resolveExternalLinkIcon(link.site, link.url);
    const key = streamingIcons.has(icon) ? icon : link.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detailFromSnapshot(
  snapshot: MediaDetailSnapshot | null,
): Detail | null {
  if (!snapshot) return null;
  return {
    synopsis: snapshot.synopsis,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    productions: [],
    externalLinks: [],
    episodeCount: snapshot.episodeCount,
    chapterCount: snapshot.chapterCount,
    volumeCount: snapshot.volumeCount,
    genres: [],
    studios: [],
    rating: snapshot.averageRating == null ? null : snapshot.averageRating / 10,
    trailer: null,
  };
}

export default function ProviderSeriesDetails({
  kitsuId,
  mediaType,
  anilistId,
  initialDetail,
}: Props) {
  const [detail, setDetail] = useState<Detail | null>(() =>
    detailFromSnapshot(initialDetail),
  );

  useEffect(() => {
    setDetail(detailFromSnapshot(initialDetail));

    let cancelled = false;

    async function loadAniListFallback() {
      if (anilistId == null) return;
      try {
        const response = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: `query ($id: Int!, $type: MediaType!) { Media(id: $id, type: $type) { description(asHtml: false) startDate { year month day } endDate { year month day } episodes chapters volumes averageScore genres studios { nodes { name } } externalLinks { site url } trailer { site id } } }`,
            variables: {
              id: anilistId,
              type: mediaType === "anime" ? "ANIME" : "MANGA",
            },
          }),
        });
        const payload = (await response.json()) as {
          data?: {
            Media?: {
              description?: unknown;
              startDate?: { year?: unknown; month?: unknown; day?: unknown };
              endDate?: { year?: unknown; month?: unknown; day?: unknown };
              episodes?: unknown;
              chapters?: unknown;
              volumes?: unknown;
              averageScore?: unknown;
              genres?: unknown;
              studios?: { nodes?: Array<{ name?: unknown }> } | null;
              externalLinks?: Array<{ site?: unknown; url?: unknown }> | null;
              trailer?: { site?: unknown; id?: unknown } | null;
            };
          };
        };
        const media = payload.data?.Media;
        if (!media || cancelled) return;
        const local = detailFromSnapshot(initialDetail);
        const genres = Array.isArray(media.genres)
          ? media.genres.flatMap((genre) => {
              const value = cleanString(genre);
              return value ? [value] : [];
            })
          : [];
        const externalLinks =
          media.externalLinks?.flatMap((link) => {
            const url = cleanString(link.url);
            return url
              ? [{ site: cleanString(link.site) ?? "Website", url }]
              : [];
          }) ?? [];
        setDetail({
          synopsis:
            descriptionText(media.description) ?? local?.synopsis ?? null,
          startDate:
            anilistFuzzyDate(media.startDate) ?? local?.startDate ?? null,
          endDate: anilistFuzzyDate(media.endDate) ?? local?.endDate ?? null,
          productions: local?.productions ?? [],
          externalLinks: deduplicateExternalLinks(externalLinks),
          episodeCount:
            typeof media.episodes === "number"
              ? media.episodes
              : (local?.episodeCount ?? null),
          chapterCount:
            typeof media.chapters === "number"
              ? media.chapters
              : (local?.chapterCount ?? null),
          volumeCount:
            typeof media.volumes === "number"
              ? media.volumes
              : (local?.volumeCount ?? null),
          genres,
          studios:
            media.studios?.nodes?.flatMap((studio) => {
              const value = cleanString(studio.name);
              return value ? [value] : [];
            }) ?? [],
          rating:
            typeof media.averageScore === "number"
              ? media.averageScore / 10
              : (local?.rating ?? null),
          trailer: media.trailer?.id
            ? {
                site: cleanString(media.trailer.site),
                id: cleanString(media.trailer.id),
              }
            : null,
        });
      } catch (error) {
        console.error(
          "[provider-details] AniList browser request failed",
          error,
        );
      }
    }

    if (!kitsuId) {
      void loadAniListFallback();
      return () => {
        cancelled = true;
      };
    }

    async function load() {
      try {
        const result =
          mediaType === "anime"
            ? await kitsuBrowserClient("query")({
                findAnimeById: [
                  { id: kitsuId },
                  {
                    description: [{ locales: ["en", "en_jp"] }, true],
                    startDate: true,
                    endDate: true,
                    episodeCount: true,
                    averageRating: true,
                    productions: [
                      { first: 6 },
                      { nodes: { company: { name: true } } },
                    ],
                    streamingLinks: [
                      { first: 8 },
                      { nodes: { url: true, streamer: { siteName: true } } },
                    ],
                  },
                ],
              })
            : await kitsuBrowserClient("query")({
                findMangaById: [
                  { id: kitsuId },
                  {
                    description: [{ locales: ["en", "en_jp"] }, true],
                    startDate: true,
                    endDate: true,
                    chapterCount: true,
                    volumeCount: true,
                    averageRating: true,
                    productions: [
                      { first: 6 },
                      { nodes: { company: { name: true } } },
                    ],
                    streamingLinks: [
                      { first: 8 },
                      { nodes: { url: true, streamer: { siteName: true } } },
                    ],
                  },
                ],
              });

        const typedResult = result as unknown as {
          findAnimeById?: unknown;
          findMangaById?: unknown;
        };
        const media = (
          mediaType === "anime"
            ? typedResult.findAnimeById
            : typedResult.findMangaById
        ) as
          | {
              description?: unknown;
              startDate?: unknown;
              endDate?: unknown;
              episodeCount?: unknown;
              chapterCount?: unknown;
              volumeCount?: unknown;
              averageRating?: unknown;
              productions?: {
                nodes?: Array<{ company?: { name?: unknown } | null }>;
              } | null;
              streamingLinks?: {
                nodes?: Array<{
                  url?: unknown;
                  streamer?: { siteName?: unknown } | null;
                }>;
              } | null;
            }
          | null
          | undefined;
        if (!media) {
          await loadAniListFallback();
          return;
        }
        if (cancelled) return;

        const anilist =
          anilistId == null
            ? null
            : await fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  query: `query ($id: Int!, $type: MediaType!) { Media(id: $id, type: $type) { averageScore genres studios { nodes { name } } externalLinks { site url } trailer { site id } } }`,
                  variables: {
                    id: anilistId,
                    type: mediaType === "anime" ? "ANIME" : "MANGA",
                  },
                }),
              }).then(
                (response) =>
                  response.json() as Promise<{ data?: { Media?: unknown } }>,
              );
        const anilistMedia = anilist?.data?.Media as
          | {
              averageScore?: unknown;
              genres?: unknown;
              studios?: { nodes?: Array<{ name?: unknown }> } | null;
              externalLinks?: Array<{ site?: unknown; url?: unknown }> | null;
              trailer?: { site?: unknown; id?: unknown } | null;
            }
          | undefined;
        const kitsuLinks =
          media.streamingLinks?.nodes?.flatMap((node) => {
            const url = cleanString(node.url);
            return url
              ? [
                  {
                    site: cleanString(node.streamer?.siteName) ?? "Streaming",
                    url,
                  },
                ]
              : [];
          }) ?? [];
        const anilistLinks =
          anilistMedia?.externalLinks?.flatMap((link) => {
            const url = cleanString(link.url);
            return url
              ? [{ site: cleanString(link.site) ?? "Website", url }]
              : [];
          }) ?? [];
        const genres = Array.isArray(anilistMedia?.genres)
          ? anilistMedia.genres.flatMap((genre) => {
              const value = cleanString(genre);
              return value ? [value] : [];
            })
          : [];
        if (cancelled) return;
        setDetail({
          synopsis: descriptionText(media.description),
          startDate: cleanString(media.startDate),
          endDate: cleanString(media.endDate),
          productions:
            media.productions?.nodes?.flatMap((node) => {
              const value = cleanString(node.company?.name);
              return value ? [value] : [];
            }) ?? [],
          externalLinks: deduplicateExternalLinks([
            ...kitsuLinks,
            ...anilistLinks,
          ]),
          episodeCount:
            typeof media.episodeCount === "number" ? media.episodeCount : null,
          chapterCount:
            typeof media.chapterCount === "number" ? media.chapterCount : null,
          volumeCount:
            typeof media.volumeCount === "number" ? media.volumeCount : null,
          genres,
          studios:
            anilistMedia?.studios?.nodes?.flatMap((studio) => {
              const value = cleanString(studio.name);
              return value ? [value] : [];
            }) ?? [],
          rating:
            typeof anilistMedia?.averageScore === "number"
              ? anilistMedia.averageScore / 10
              : typeof media.averageRating === "number"
                ? media.averageRating / 10
                : null,
          trailer: anilistMedia?.trailer?.id
            ? {
                site: cleanString(anilistMedia.trailer.site),
                id: cleanString(anilistMedia.trailer.id),
              }
            : null,
        });
      } catch (error) {
        console.error("[provider-details] browser request failed", error);
        await loadAniListFallback();
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [anilistId, initialDetail, kitsuId, mediaType]);

  if (!detail && !kitsuId && !anilistId) {
    return (
      <Typography color="text.secondary">
        Details are unavailable until this title can be matched to Kitsu or
        AniList.
      </Typography>
    );
  }

  if (!detail) return null;
  const trailerUrl = detail.trailer?.id
    ? detail.trailer.site?.toLowerCase() === "dailymotion"
      ? `https://www.dailymotion.com/embed/video/${detail.trailer.id}`
      : `https://www.youtube.com/embed/${detail.trailer.id}`
    : null;

  return (
    <Stack spacing={2} sx={{ minWidth: 0, maxWidth: "100%" }}>
      {(detail.genres.length > 0 || detail.externalLinks.length > 0) && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: "center" }}
        >
          {detail.genres.map((genre) => (
            <Chip
              key={genre}
              label={genre}
              size="small"
              variant="outlined"
              sx={getGenreChipSx(genre)}
            />
          ))}
          {detail.externalLinks.map((link) => (
            <Tooltip key={`${link.site}-${link.url}`} title={link.site}>
              <IconButton
                component={Link}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                size="small"
                aria-label={link.site}
              >
                <ExternalLinkIcon site={link.site} url={link.url} />
              </IconButton>
            </Tooltip>
          ))}
        </Stack>
      )}
      {detail.studios.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <AnimationIcon fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2">
            <strong>Studios:</strong> {detail.studios.join(", ")}
          </Typography>
        </Stack>
      )}
      {detail.productions.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <CameraRollIcon fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2">
            <strong>Productions:</strong> {detail.productions.join(", ")}
          </Typography>
        </Stack>
      )}
      {(detail.startDate || detail.endDate) && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <DateRangeIcon fontSize="small" />
          <Typography variant="body2">
            <strong>Release:</strong>{" "}
            {formatDate(detail.startDate) ?? "Unknown"} to{" "}
            {formatDate(detail.endDate) ?? "Present"}
          </Typography>
        </Stack>
      )}
      {detail.rating != null && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <ThumbsUpDownIcon fontSize="small" />
          <Typography variant="body2">
            <strong>Rating:</strong>
          </Typography>
          <MoonRating rating={detail.rating} />
        </Stack>
      )}
      {detail.synopsis && (
        <>
          <Divider />
          <Typography
            variant="body1"
            sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}
          >
            {detail.synopsis}
          </Typography>
        </>
      )}
      {trailerUrl && (
        <>
          <Divider />
          <Box
            sx={{
              position: "relative",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              aspectRatio: "16 / 9",
              bgcolor: "grey.900",
            }}
          >
            <Box
              component="iframe"
              src={trailerUrl}
              title="Trailer"
              allowFullScreen
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
              }}
            />
          </Box>
        </>
      )}
    </Stack>
  );
}
