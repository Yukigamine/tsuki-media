import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const projects = [
  {
    name: "anime",
    directory: "apps/anime",
    include: ["apps/anime/src/**/*.test.{ts,tsx}"],
  },
  {
    name: "anime-shared",
    directory: "packages/ui",
    include: ["packages/ui/src/pwa.test.ts"],
  },
];

export default defineConfig({
  root,
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        settings: {
          enableImageFileLoading: false,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
          },
        },
      },
    },
    setupFiles: [path.join(root, "vitest.setup.ts")],
    fileParallelism: false,
    testTimeout: 15000,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: projects.map(({ name, directory, include }) => ({
      extends: true,
      resolve: {
        alias: {
          "@": path.join(root, directory, "src"),
          "server-only": path.join(root, "test/server-only.ts"),
        },
      },
      test: {
        name,
        include,
      },
    })),
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "json-summary", "lcov"],
      include: [
        "apps/anime/src/**/*.{ts,tsx}",
        "packages/ui/src/pwa.ts",
        "packages/ui/src/pwa-devices.ts",
        "packages/ui/src/theme.ts",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "apps/anime/src/lib/zeus/**",
        "**/src/generated/**",
      ],
    },
  },
});
