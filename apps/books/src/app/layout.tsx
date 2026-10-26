import { MediaAppShell, MediaProviders } from "@tsuki-media/ui";

export { metadata, viewport } from "./metadata";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <MediaProviders>
          <MediaAppShell title="Tsuki Books">{children}</MediaAppShell>
        </MediaProviders>
      </body>
    </html>
  );
}
