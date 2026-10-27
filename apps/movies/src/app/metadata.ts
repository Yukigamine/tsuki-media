import { createPwaMetadata, pwaViewport } from "@tsuki-media/ui/pwa";

const origin =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3002");

export const metadata = {
  ...createPwaMetadata("movies", origin),
  formatDetection: { telephone: false },
};
export const viewport = pwaViewport;
