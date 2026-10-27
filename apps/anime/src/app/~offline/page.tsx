import { Box, Typography } from "@mui/material";

export default function OfflinePage() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 2,
        px: 3,
        textAlign: "center",
      }}
    >
      <Typography variant="h5" component="h1">
        You&apos;re offline
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Check your internet connection and try again.
      </Typography>
    </Box>
  );
}
