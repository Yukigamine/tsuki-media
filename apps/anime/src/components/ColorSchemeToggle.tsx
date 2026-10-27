"use client";

import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

export default function ColorSchemeToggle() {
  const { mode, setMode } = useColorScheme();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  let nextMode: "light" | "dark";
  if (mode === "system") {
    nextMode = prefersDark ? "light" : "dark";
  } else {
    nextMode = mode === "light" ? "dark" : "light";
  }

  return (
    <Tooltip title={`Switch to ${nextMode} mode`}>
      <IconButton
        aria-label={`Switch to ${nextMode} mode`}
        color="inherit"
        onClick={() => setMode(nextMode)}
      >
        {nextMode === "dark" ? (
          <DarkModeIcon fontSize="small" />
        ) : (
          <LightModeIcon fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
}
