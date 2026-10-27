import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

type Props = {
  title: string;
  action?: ReactNode;
};

export function MediaLibraryHeader({ title, action }: Props) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        mb: 4,
      }}
    >
      <Typography variant="h4" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {action && (
        <Box sx={{ display: { xs: "none", md: "block" } }}>{action}</Box>
      )}
    </Box>
  );
}
