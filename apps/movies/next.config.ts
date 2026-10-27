import path from "node:path";
import dotenv from "dotenv";
import type { NextConfig } from "next";

dotenv.config({
  path: [
    path.join(import.meta.dirname, ".env.local"),
    path.join(import.meta.dirname, ".env"),
    path.join(import.meta.dirname, "../../.env.local"),
    path.join(import.meta.dirname, "../../.env"),
  ],
  quiet: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tsuki-media/providers", "@tsuki-media/ui"],
};

export default nextConfig;
