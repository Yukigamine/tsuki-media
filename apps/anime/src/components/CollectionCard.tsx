"use client";

import { Box, Card, CardContent, CardMedia, Typography } from "@mui/material";
import AppLink from "@/components/Link";

type Chip = {
  label: string;
  color: string;
  icon?: React.ReactNode;
};

type Props = {
  image: string;
  imageAlt: string;
  title: string;
  href: string;
  actions: React.ReactNode;
  chips: Chip[];
};

export function CollectionCard({
  image,
  imageAlt,
  title,
  href,
  actions,
  chips,
}: Props) {
  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        "&:hover .collection-edit-action, &:focus-within .collection-edit-action":
          {
            opacity: 1,
            pointerEvents: "auto",
          },
      }}
    >
      <AppLink href={href} aria-label={`View ${title}`}>
        <CardMedia
          component="img"
          image={image}
          alt={imageAlt}
          sx={{
            height: 280,
            objectFit: "cover",
          }}
        />
      </AppLink>
      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        <Box sx={{ mb: 1 }}>
          <AppLink
            href={href}
            sx={{
              minWidth: 0,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {title}
            </Typography>
          </AppLink>
        </Box>
        <Box sx={{ position: "absolute", right: 4, bottom: 4, zIndex: 1 }}>
          {actions}
        </Box>
        <Box
          sx={{
            display: "flex",
            gap: 0.5,
            flexWrap: "wrap",
          }}
        >
          {chips.map((chip) => (
            <Box
              key={`${chip.label}-${chip.color}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.25,
                bgcolor: chip.color,
                borderRadius: 1,
              }}
            >
              {chip.icon && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    fontSize: "1.2em",
                  }}
                >
                  {chip.icon}
                </Box>
              )}
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: "#fff",
                }}
              >
                {chip.label}
              </Typography>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
