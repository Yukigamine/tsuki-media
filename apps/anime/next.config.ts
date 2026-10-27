import path from "node:path";
import { withSerwist } from "@serwist/turbopack";
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

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  reactStrictMode: true,
  transpilePackages: ["@tsuki-media/ui"],
  trailingSlash: false,
  images: {
    remotePatterns: [
      { hostname: "media.kitsu.app" },
      { hostname: "img.anili.st" },
      { hostname: "www.gravatar.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSerwist(nextConfig);
