"use client";

import { Box, Card, CardActionArea, Stack, Typography } from "@mui/material";
import NextLink from "next/link";
import { useEffect, useState } from "react";
import { assertNoCloudflareChallenge, kitsuFetch } from "@/lib/kitsu/fetch";
import { slugifyTitle } from "@/lib/media-routing";
import { cleanString } from "@/lib/media-values";
import { Thunder } from "@/lib/zeus/kitsu";

const KITSU_GRAPHQL =
  process.env.NEXT_PUBLIC_KITSU_API_URL ?? "https://kitsu.app/api/graphql";

const RELATIONSHIP_LABELS = {
  ADAPTATION: "Adaptation",
  PREQUEL: "Prequel",
  SEQUEL: "Sequel",
} as const;

type Props = {
  kitsuId: string;
  mediaType: "anime" | "manga";
};

type RelatedMediaItem = {
  href: string;
  title: string;
  relationship: string;
  startDate: string | null;
  releaseYear: number | null;
  coverImageUrl: string | null;
};

function getBrowserKitsuClient() {
  return Thunder(async (query, variables) => {
    const response = await kitsuFetch(KITSU_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://kitsu.app",
        Origin: "https://kitsu.app",
      },
      body: JSON.stringify({ query, variables }),
    });

    assertNoCloudflareChallenge(response);

    const body = JSON.parse(response.body) as {
      data?: unknown;
      errors?: { message: string }[];
    };

    if (
      response.status < 200 ||
      response.status >= 300 ||
      body.errors?.length
    ) {
      throw new Error(
        body.errors?.[0]?.message ?? `Kitsu GraphQL ${response.status}`,
      );
    }

    if (!body.data) {
      throw new Error("Kitsu GraphQL returned no data");
    }

    return body.data;
  });
}

function relationshipLabel(
  kind: unknown,
  destinationType: unknown,
): string | null {
  if (typeof kind !== "string") return null;
  if (!(kind in RELATIONSHIP_LABELS)) return null;

  const label = RELATIONSHIP_LABELS[kind as keyof typeof RELATIONSHIP_LABELS];
  if (kind === "ADAPTATION") {
    const typeLabel = destinationType === "Manga" ? "Manga" : "Anime";
    return `${label} (${typeLabel})`;
  }

  return label;
}

function mediaTypeFromGraphqlType(type: unknown): "anime" | "manga" {
  return type === "Manga" ? "manga" : "anime";
}

function releaseYearFromDate(value: unknown): number | null {
  const date = new Date(
    typeof value === "string" || typeof value === "number" ? value : "",
  );
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

export default function RelatedMediaCards({ kitsuId, mediaType }: Props) {
  const [items, setItems] = useState<RelatedMediaItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadRelationships() {
      try {
        const client = getBrowserKitsuClient();
        const nodes =
          mediaType === "anime"
            ? ((
                await client("query")({
                  findAnimeById: [
                    { id: kitsuId },
                    {
                      relationships: [
                        { first: 12 },
                        {
                          nodes: {
                            kind: true,
                            destination: {
                              __typename: true,
                              id: true,
                              slug: true,
                              startDate: true,
                              titles: {
                                canonical: true,
                                romanized: true,
                                original: true,
                              },
                              posterImage: { original: { url: true } },
                            },
                          },
                        },
                      ],
                    },
                  ],
                })
              ).findAnimeById?.relationships?.nodes ?? [])
            : ((
                await client("query")({
                  findMangaById: [
                    { id: kitsuId },
                    {
                      relationships: [
                        { first: 12 },
                        {
                          nodes: {
                            kind: true,
                            destination: {
                              __typename: true,
                              id: true,
                              slug: true,
                              startDate: true,
                              titles: {
                                canonical: true,
                                romanized: true,
                                original: true,
                              },
                              posterImage: { original: { url: true } },
                            },
                          },
                        },
                      ],
                    },
                  ],
                })
              ).findMangaById?.relationships?.nodes ?? []);

        const nextItems = nodes
          .map((relationship) => {
            const destination = relationship?.destination;
            const destinationId = cleanString(destination?.id);
            const title =
              cleanString(destination?.titles?.canonical) ??
              cleanString(destination?.titles?.romanized) ??
              cleanString(destination?.titles?.original) ??
              cleanString(destination?.slug) ??
              destinationId;
            const relationshipText = relationshipLabel(
              relationship?.kind,
              destination?.__typename,
            );

            if (!destinationId || !title || !relationshipText) return null;

            const destinationMediaType = mediaTypeFromGraphqlType(
              destination?.__typename,
            );

            return {
              href: `/${destinationMediaType}/${slugifyTitle(title)}/${destinationId}`,
              title,
              relationship: relationshipText,
              startDate: cleanString(destination?.startDate),
              releaseYear: releaseYearFromDate(destination?.startDate),
              coverImageUrl: destination?.posterImage?.original?.url ?? null,
            };
          })
          .filter((item): item is RelatedMediaItem => item !== null)
          .map((item, index) => ({ item, index }))
          .sort((left, right) => {
            const leftTime = left.item.startDate
              ? Date.parse(left.item.startDate)
              : Number.NaN;
            const rightTime = right.item.startDate
              ? Date.parse(right.item.startDate)
              : Number.NaN;
            const leftHasDate = !Number.isNaN(leftTime);
            const rightHasDate = !Number.isNaN(rightTime);

            if (leftHasDate && rightHasDate) return leftTime - rightTime;
            if (leftHasDate) return -1;
            if (rightHasDate) return 1;
            return left.index - right.index;
          })
          .map(({ item }) => item);

        if (!cancelled) setItems(nextItems);
      } catch (error) {
        console.error("[related-media] Kitsu browser request failed", error);
      }
    }

    void loadRelationships();
    return () => {
      cancelled = true;
    };
  }, [kitsuId, mediaType]);

  if (items.length === 0)
    return <Box className="related-media-empty" aria-hidden="true" />;

  return (
    <>
      <Typography variant="h6" sx={{ mb: 1.25 }}>
        Related Media
      </Typography>
      <Stack spacing={1}>
        {items.map((item) => (
          <Card
            key={`${item.href}-${item.title}`}
            variant="outlined"
            sx={{ borderRadius: 2 }}
          >
            <CardActionArea
              component={NextLink}
              href={item.href}
              sx={{
                display: "flex",
                alignItems: "stretch",
                justifyContent: "flex-start",
              }}
            >
              <Box
                sx={{
                  width: 56,
                  minWidth: 56,
                  height: 84,
                  bgcolor: "action.hover",
                  overflow: "hidden",
                  borderRight: 1,
                  borderColor: "divider",
                }}
              >
                {item.coverImageUrl ? (
                  <Box
                    component="img"
                    src={item.coverImageUrl}
                    alt={item.title}
                    sx={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : null}
              </Box>
              <Box
                sx={{
                  p: 1.25,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.25,
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.relationship}
                  {item.releaseYear != null ? ` · ${item.releaseYear}` : ""}
                </Typography>
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </>
  );
}
