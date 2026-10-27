"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { kitsuBrowserClient } from "@/lib/kitsu/browser-client";
import type { MediaDetailSnapshot } from "@/lib/media-detail-types";
import { anilistFuzzyDate, cleanString } from "@/lib/media-values";

type Props = {
  kitsuId: string | null;
  mediaType: "anime" | "manga";
  fallbackTitle: string;
  initialDetail: MediaDetailSnapshot | null;
  anilistId: number | null;
  extraChips?: ReactNode;
  onCountLoaded?: (count: number | null) => void;
};

type HeroData = {
  title: string;
  secondaryTitle: string | null;
  bannerImageUrl: string | null;
  coverImageUrl: string | null;
  startDate: string | null;
  season: string | null;
  subtype: string | null;
  episodeCount: number | null;
  ageRating: string | null;
};

function heroFromDetail(
  detail: MediaDetailSnapshot | null,
  fallbackTitle: string,
): HeroData {
  return {
    title: detail?.titleEn ?? detail?.titleRomaji ?? fallbackTitle,
    secondaryTitle: detail?.titleJp ?? null,
    bannerImageUrl: detail?.bannerImageUrl ?? null,
    coverImageUrl: detail?.coverImageUrl ?? null,
    startDate: detail?.startDate ?? null,
    season: null,
    subtype: null,
    episodeCount: detail?.episodeCount ?? detail?.chapterCount ?? null,
    ageRating: null,
  };
}

function releaseLabel(
  value: string | null,
  mediaType: Props["mediaType"],
  season: string | null,
): string | null {
  if (mediaType === "anime") {
    if (!season) return null;
    if (!value) return season.toUpperCase();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return season.toUpperCase();
    return `${season.toUpperCase()} ${date.getUTCFullYear()}`;
  }

  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

export default function ProviderMediaHero({
  kitsuId,
  mediaType,
  fallbackTitle,
  initialDetail,
  anilistId,
  extraChips,
  onCountLoaded,
}: Props) {
  const initialHero = useMemo(
    () => heroFromDetail(initialDetail, fallbackTitle),
    [fallbackTitle, initialDetail],
  );
  const [data, setData] = useState<HeroData>(initialHero);

  useEffect(() => {
    setData(initialHero);
    onCountLoaded?.(initialHero.episodeCount);

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
            query: `query ($id: Int!, $type: MediaType!) { Media(id: $id, type: $type) { title { english romaji native } coverImage { extraLarge large } bannerImage startDate { year month day } episodes chapters } }`,
            variables: {
              id: anilistId,
              type: mediaType === "anime" ? "ANIME" : "MANGA",
            },
          }),
        });
        const payload = (await response.json()) as {
          data?: {
            Media?: {
              title?: { english?: unknown; romaji?: unknown; native?: unknown };
              coverImage?: { extraLarge?: unknown; large?: unknown };
              bannerImage?: unknown;
              startDate?: { year?: unknown; month?: unknown; day?: unknown };
              episodes?: unknown;
              chapters?: unknown;
            };
          };
        };
        const media = payload.data?.Media;
        if (!media || cancelled) return;
        const count =
          typeof media.episodes === "number"
            ? media.episodes
            : typeof media.chapters === "number"
              ? media.chapters
              : initialHero.episodeCount;
        onCountLoaded?.(count);
        setData({
          ...initialHero,
          title:
            cleanString(media.title?.english) ??
            cleanString(media.title?.romaji) ??
            initialHero.title,
          secondaryTitle:
            cleanString(media.title?.native) ?? initialHero.secondaryTitle,
          bannerImageUrl:
            cleanString(media.bannerImage) ?? initialHero.bannerImageUrl,
          coverImageUrl:
            cleanString(media.coverImage?.extraLarge) ??
            cleanString(media.coverImage?.large) ??
            initialHero.coverImageUrl,
          startDate: anilistFuzzyDate(media.startDate) ?? initialHero.startDate,
          episodeCount: count,
        });
      } catch {
        // The local snapshot remains the SSR fallback when AniList is unavailable.
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
                    titles: {
                      canonical: true,
                      romanized: true,
                      original: true,
                    },
                    startDate: true,
                    season: true,
                    subtype: true,
                    episodeCount: true,
                    ageRating: true,
                    bannerImage: { original: { url: true } },
                    posterImage: { original: { url: true } },
                  },
                ],
              })
            : await kitsuBrowserClient("query")({
                findMangaById: [
                  { id: kitsuId },
                  {
                    titles: {
                      canonical: true,
                      romanized: true,
                      original: true,
                    },
                    startDate: true,
                    chapterCount: true,
                    ageRating: true,
                    bannerImage: { original: { url: true } },
                    posterImage: { original: { url: true } },
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
              titles?: {
                canonical?: unknown;
                romanized?: unknown;
                original?: unknown;
              } | null;
              startDate?: unknown;
              season?: unknown;
              subtype?: unknown;
              episodeCount?: unknown;
              chapterCount?: unknown;
              ageRating?: unknown;
              bannerImage?: { original?: { url?: unknown } | null } | null;
              posterImage?: { original?: { url?: unknown } | null } | null;
            }
          | null
          | undefined;
        if (!media) {
          await loadAniListFallback();
          return;
        }
        if (cancelled) return;
        const count =
          typeof media?.episodeCount === "number"
            ? media.episodeCount
            : typeof media?.chapterCount === "number"
              ? media.chapterCount
              : null;
        onCountLoaded?.(count);
        setData({
          title:
            cleanString(media?.titles?.canonical) ??
            cleanString(media?.titles?.romanized) ??
            initialHero.title,
          secondaryTitle:
            cleanString(media.titles?.original) ?? initialHero.secondaryTitle,
          bannerImageUrl:
            cleanString(media.bannerImage?.original?.url) ??
            initialHero.bannerImageUrl,
          coverImageUrl:
            cleanString(media.posterImage?.original?.url) ??
            initialHero.coverImageUrl,
          startDate: cleanString(media.startDate) ?? initialHero.startDate,
          season: cleanString(media.season) ?? initialHero.season,
          subtype: cleanString(media.subtype) ?? initialHero.subtype,
          episodeCount: count,
          ageRating: cleanString(media.ageRating) ?? initialHero.ageRating,
        });
      } catch {
        if (!cancelled) {
          await loadAniListFallback();
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [anilistId, initialHero, kitsuId, mediaType, onCountLoaded]);

  const hero = data;
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        px: { xs: 2, sm: 4 },
        py: { xs: 2, sm: 3 },
        color: "common.white",
        backgroundImage: hero.bannerImageUrl
          ? `linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.32)), url(${hero.bannerImageUrl})`
          : "linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0.55))",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "flex-start", sm: "flex-end" },
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        <Box
          sx={{
            width: 124,
            height: 176,
            borderRadius: 2,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.2)",
            bgcolor: "grey.800",
            flexShrink: 0,
            display: { xs: "none", sm: "block" },
          }}
        >
          {hero.coverImageUrl && (
            <Box
              component="img"
              src={hero.coverImageUrl}
              alt={hero.title}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
        </Box>
        <Box sx={{ minWidth: 0, maxWidth: "100%" }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {hero.title}
          </Typography>
          {hero.secondaryTitle && hero.secondaryTitle !== hero.title && (
            <Typography variant="subtitle1" sx={{ opacity: 0.9 }}>
              {hero.secondaryTitle}
            </Typography>
          )}
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ mt: 1, flexWrap: "wrap" }}
          >
            <Chip
              label={mediaType === "anime" ? "ANIME" : "MANGA"}
              size="small"
              color="default"
            />
            {mediaType === "anime" && hero.subtype && (
              <Chip label={hero.subtype} size="small" color="default" />
            )}
            {releaseLabel(hero.startDate, mediaType, hero.season) && (
              <Chip
                label={releaseLabel(hero.startDate, mediaType, hero.season)}
                size="small"
                color="default"
              />
            )}
            {hero.episodeCount != null && (
              <Chip
                label={
                  mediaType === "anime"
                    ? `${hero.episodeCount} EPISODES`
                    : `${hero.episodeCount} CHAPTERS`
                }
                size="small"
                color="default"
              />
            )}
            {hero.ageRating && (
              <Chip label={hero.ageRating} size="small" color="default" />
            )}
            {extraChips}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
