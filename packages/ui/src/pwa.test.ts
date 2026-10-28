import { describe, expect, it } from "vitest";
import { createPwaManifest, createPwaMetadata, pwaViewport } from "./pwa";
import { appleDevices } from "./pwa-devices";

describe("shared install metadata contracts", () => {
  it.each(["anime"] as const)(
    "keeps %s manifest and Apple naming consistent",
    (app) => {
      const name = `Tsuki ${app[0].toUpperCase()}${app.slice(1)}`;
      const manifest = createPwaManifest(app),
        metadata = createPwaMetadata(app, "https://example.invalid");
      expect(manifest).toMatchObject({
        id: "/",
        name,
        short_name: name,
        start_url: "/",
        scope: "/",
        display: "standalone",
      });
      expect(metadata).toMatchObject({
        title: name,
        applicationName: name,
        manifest: "/manifest.webmanifest",
        metadataBase: new URL("https://example.invalid"),
        appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
        other: { "apple-mobile-web-app-capable": "yes" },
      });
      expect(metadata.openGraph).toMatchObject({
        title: name,
        siteName: name,
        images: [{ width: 1200, height: 630, alt: name }],
      });
      expect(metadata.twitter).toMatchObject({
        card: "summary_large_image",
        title: name,
        images: [{ alt: name }],
      });
      expect(manifest.icons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sizes: "192x192",
            purpose: "any",
            type: "image/png",
          }),
          expect.objectContaining({
            sizes: "512x512",
            purpose: "any",
            type: "image/png",
          }),
          expect.objectContaining({
            sizes: "512x512",
            purpose: "maskable",
            type: "image/png",
          }),
          expect.objectContaining({
            sizes: "1024x1024",
            purpose: "maskable",
            type: "image/png",
          }),
        ]),
      );
    },
  );

  it("declares startup PNG URLs for supported device sizes and orientations", () => {
    const metadata = createPwaMetadata("anime", "https://example.invalid");
    const images = (
      metadata.appleWebApp as { startupImage: { url: string; media: string }[] }
    ).startupImage;
    expect(images).toHaveLength(appleDevices.length * 2);
    // Independent device fixture: metadata declarations only, not native launch proof.
    expect(images).toContainEqual({
      url: "/icons/tsuki/startup/1290x2796.png",
      media:
        "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    });
    expect(images).toContainEqual({
      url: "/icons/tsuki/startup/2796x1290.png",
      media:
        "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
    });
    for (const [width, height, ratio] of appleDevices)
      for (const orientation of ["portrait", "landscape"]) {
        const match = images.filter(
          (image) =>
            image.media.includes(`(device-width: ${width}px)`) &&
            image.media.includes(`(device-height: ${height}px)`) &&
            image.media.includes(`(-webkit-device-pixel-ratio: ${ratio})`) &&
            image.media.includes(`(orientation: ${orientation})`),
        );
        expect(match).toHaveLength(1);
        expect(match[0].url).toBe(
          `/icons/tsuki/startup/${orientation === "portrait" ? width * ratio : height * ratio}x${orientation === "portrait" ? height * ratio : width * ratio}.png`,
        );
      }
    expect(
      images.find((image) => image.url.endsWith("1290x2796.png"))?.media,
    ).toContain("device-width: 430px");
    expect(pwaViewport).toMatchObject({
      width: "device-width",
      initialScale: 1,
    });
    expect(pwaViewport).not.toHaveProperty("viewportFit", "cover");
  });
});
