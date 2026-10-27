import { createTheme } from "@mui/material/styles";

// Reuse the self-hosted Noto Sans already loaded by each app for quieter headings.
const headingTypography = {
  fontFamily:
    'var(--font-noto-sans, "Noto Sans"), var(--font-open-sans, "Open Sans"), Helvetica, sans-serif',
  fontWeight: 400,
};

const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: "class",
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#7c6af7" },
        secondary: { main: "#e879a0" },
        background: { default: "#f6f5ff", paper: "#ffffff" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#9d8fff" },
        secondary: { main: "#f48fb1" },
        background: { default: "#0f0f1a", paper: "#1a1a2e" },
      },
    },
  },
  typography: {
    fontFamily:
      'var(--font-fredoka, "Fredoka"), "Arial Rounded MT Bold", var(--font-noto-sans, "Noto Sans"), var(--font-open-sans, "Open Sans"), Helvetica, sans-serif',
    h1: headingTypography,
    h2: headingTypography,
    h3: headingTypography,
    h4: headingTypography,
    h5: headingTypography,
    h6: headingTypography,
    button: { fontWeight: 500, textTransform: "none" },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "button, input, select, textarea": { fontFamily: "inherit" },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
        "html, body": {
          maxWidth: "100vw",
          overflowX: "hidden",
        },
      },
    },
  },
});

export default theme;
