import { Box, Card, CardContent, Skeleton } from "@mui/material";

export default function CardSkeleton() {
  return (
    <Card
      sx={{
        display: "flex",
        height: 140,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: 93,
          flexShrink: 0,
          bgcolor: "background.default",
        }}
      >
        <Skeleton variant="rectangular" width="100%" height="100%" />
      </Box>

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
          width: "100%",
        }}
      >
        <Skeleton variant="text" width="80%" height={24} />
        <Skeleton variant="text" width="60%" height={16} />
        <Box sx={{ mt: "auto" }}>
          <Skeleton variant="rounded" width={100} height={28} />
        </Box>
      </CardContent>
    </Card>
  );
}
