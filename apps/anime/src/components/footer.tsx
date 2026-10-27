import { Box, Link, Stack, Typography } from "@mui/material";

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        px: 2,
        py: 1.5,
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 0.5, sm: 1.5 }}
        sx={{
          width: "100%",
          color: "text.secondary",
          textAlign: "center",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack
          direction="row"
          spacing={0.5}
          useFlexGap
          sx={{
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Typography variant="caption" color="inherit">
            © {new Date().getFullYear()}
          </Typography>
          <Link
            href="https://github.com/Yukigamine/tsuki-media"
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            color="inherit"
            variant="caption"
          >
            Yukigamine
          </Link>
        </Stack>

        <Stack
          direction="row"
          spacing={0.5}
          useFlexGap
          sx={{
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Typography variant="caption" color="inherit">
            API usage courtesy of
          </Typography>
          <Link
            href="https://kitsu.app"
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            color="inherit"
            variant="caption"
          >
            Kitsu.app
          </Link>
          <Typography variant="caption" color="inherit">
            and
          </Typography>
          <Link
            href="https://anilist.co"
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            color="inherit"
            variant="caption"
          >
            AniList.co
          </Link>
        </Stack>
      </Stack>
    </Box>
  );
}
