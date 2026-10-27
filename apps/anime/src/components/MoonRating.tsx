"use client";

import NightlightIcon from "@mui/icons-material/Nightlight";
import NightlightRoundIcon from "@mui/icons-material/NightlightRound";
import { Box, Typography } from "@mui/material";
import { formatHalfStepRatingOutOfTen } from "@/lib/media-display";

type Props = {
  rating: number | null;
};

export default function MoonRating({ rating }: Props) {
  if (rating == null) {
    return (
      <Typography variant="body2" color="text.secondary">
        Not rated
      </Typography>
    );
  }

  const fullMoons = Math.floor(rating);
  const hasHalfMoon = rating - fullMoons >= 0.5;

  return (
    <Box
      aria-hidden
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.25,
        color: "text.secondary",
      }}
    >
      {Array.from({ length: fullMoons }, (_, index) => index + 1).map(
        (moon) => (
          <NightlightIcon key={moon} sx={{ fontSize: 16 }} />
        ),
      )}
      {hasHalfMoon && <NightlightRoundIcon sx={{ fontSize: 16 }} />}
      <Typography
        variant="body2"
        component="span"
        sx={{ whiteSpace: "nowrap", ml: 0.25 }}
      >
        ({formatHalfStepRatingOutOfTen(rating)})
      </Typography>
    </Box>
  );
}
