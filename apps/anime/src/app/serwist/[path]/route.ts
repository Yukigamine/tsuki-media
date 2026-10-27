import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

const buildRevision =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.GITHUB_SHA?.trim() ||
  process.env.COMMIT_SHA?.trim();

const gitRevision = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf-8",
}).stdout.trim();

const revision = buildRevision || gitRevision || "dev";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    // Apple selects one device-specific startup image; do not precache them all.
    globIgnores: ["**/icons/tsuki/startup/**"],
    useNativeEsbuild: true,
  });
