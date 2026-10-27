import { createPwaMetadata, pwaViewport } from "@tsuki-media/ui/pwa";

const origin =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata = {
  ...createPwaMetadata("anime", origin),
  formatDetection: { telephone: false },
};
export const viewport = pwaViewport;
