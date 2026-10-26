import { createPwaMetadata, pwaViewport } from "@tsuki-media/ui/pwa";

const origin =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3001");

export const metadata = {
  ...createPwaMetadata("books", origin),
  formatDetection: { telephone: false },
};
export const viewport = pwaViewport;
