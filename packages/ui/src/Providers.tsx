"use client";

import { CssBaseline, ThemeProvider, useColorScheme } from "@mui/material";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { PropsWithChildren } from "react";
import theme from "./theme";

export function MediaProviders({ children }: PropsWithChildren) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}

export function ColorModeButton() {
  const { mode, setMode } = useColorScheme();
  return (
    <button
      type="button"
      onClick={() => setMode(mode === "dark" ? "light" : "dark")}
      style={{
        border: 0,
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      }}
    >
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
