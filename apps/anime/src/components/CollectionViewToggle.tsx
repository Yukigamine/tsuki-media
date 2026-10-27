"use client";

import GridViewIcon from "@mui/icons-material/GridView";
import TableChartIcon from "@mui/icons-material/TableChart";
import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";

export type ViewMode = "grid" | "table";

type Props = {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
};

export function CollectionViewToggle({ view, onViewChange }: Props) {
  return (
    <Box>
      <ToggleButtonGroup
        value={view}
        exclusive
        onChange={(_, newView) => {
          if (newView !== null) onViewChange(newView);
        }}
        size="small"
      >
        <ToggleButton value="grid" aria-label="grid view">
          <GridViewIcon />
        </ToggleButton>
        <ToggleButton value="table" aria-label="table view">
          <TableChartIcon />
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
