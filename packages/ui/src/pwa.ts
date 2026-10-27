import type { Metadata, MetadataRoute, Viewport } from "next";
import { appleDevices } from "./pwa-devices";

type App = "anime" | "books" | "movies";
const descriptions: Record<App, string> = {
  anime: "Personal anime and manga tracking",
  books: "A personal book collection powered by Hardcover",
  movies: "A personal movie collection powered by TMDB",
};
const asset = "/icons/tsuki";
const appName = (app: App) => `Tsuki ${app[0].toUpperCase()}${app.slice(1)}`;

export function createPwaMetadata(app: App, origin: string): Metadata {
  const title = appName(app);
  return {
    metadataBase: new URL(origin),
    title,
    applicationName: title,
    description: descriptions[app],
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: `${asset}/pwa-192.png`, type: "image/png", sizes: "192x192" },
        { url: `${asset}/pwa-512.png`, type: "image/png", sizes: "512x512" },
        { url: `${asset}/favicon.svg`, type: "image/svg+xml", sizes: "any" },
      ],
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
    appleWebApp: {
      capable: true,
      title,
      statusBarStyle: "default",
      startupImage: appleDevices.flatMap(([width, height, ratio]) =>
        (["portrait", "landscape"] as const).map((orientation) => ({
          url: `${asset}/startup/${orientation === "portrait" ? width * ratio : height * ratio}x${orientation === "portrait" ? height * ratio : width * ratio}.png`,
          media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
        })),
      ),
    },
    // Retain Apple's legacy opt-in: startup images still depend on it on older iOS.
    other: { "apple-mobile-web-app-capable": "yes" },
    openGraph: {
      type: "website",
      title,
      description: descriptions[app],
      siteName: title,
      images: [
        {
          url: `${asset}/open-graph.png`,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: descriptions[app],
      images: [{ url: `${asset}/twitter.png`, alt: title }],
    },
  };
}

export function createPwaManifest(app: App): MetadataRoute.Manifest {
  return {
    id: "/",
    name: appName(app),
    short_name: appName(app),
    description: descriptions[app],
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#100629",
    theme_color: "#100629",
    icons: [
      {
        src: `${asset}/pwa-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${asset}/pwa-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${asset}/maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: `${asset}/maskable-1024.png`,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

export const pwaViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#100629",
};
