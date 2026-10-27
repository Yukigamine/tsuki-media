"use client";

import { Box, Tab, Tabs, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ViewMode } from "@/components/CollectionViewToggle";
import { CollectionViewToggle } from "@/components/CollectionViewToggle";
import ListSearchField from "@/components/ListSearchField";

type MediaLibraryTab<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

type Props<T extends string> = {
  tabs: MediaLibraryTab<T>[];
  activeTab: T;
  onTabChange: (value: T) => void;
  onSearchChange: (value: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  mobileAdd?: ReactNode;
};

export function MediaLibraryToolbar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  onSearchChange,
  view,
  onViewChange,
  mobileAdd,
}: Props<T>) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        alignItems: { md: "center" },
        gap: 2,
        mb: 3,
      }}
    >
      {tabs.length > 0 && (
        <Tabs
          value={activeTab}
          onChange={(_, value) => onTabChange(value as T)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flex: 1, minHeight: 40, maxWidth: "100%" }}
        >
          {tabs.map(({ value, label, count }) => (
            <Tab
              key={value}
              value={value}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {label}
                  {count != null && (
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{
                        bgcolor: "action.selected",
                        borderRadius: 1,
                        px: 0.6,
                        py: 0.1,
                        fontWeight: 600,
                      }}
                    >
                      {count}
                    </Typography>
                  )}
                </Box>
              }
              sx={{ minHeight: 40, textTransform: "none", fontWeight: 500 }}
            />
          ))}
        </Tabs>
      )}

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: { xs: "100%", md: "auto" },
        }}
      >
        <ListSearchField onSearchChange={onSearchChange} />
        <CollectionViewToggle view={view} onViewChange={onViewChange} />
        {mobileAdd}
      </Box>
    </Box>
  );
}
