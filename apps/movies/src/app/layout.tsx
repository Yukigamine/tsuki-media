import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { MediaAppShell, MediaProviders } from "@tsuki-media/ui";
import type { Metadata } from "next";
import { Fredoka, Noto_Sans, Open_Sans } from "next/font/google";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Tsuki Movies",
  description: "A personal movie collection powered by TMDB",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fredoka.variable} ${notoSans.variable} ${openSans.variable}`}
    >
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <MediaProviders>
          <MediaAppShell title="Tsuki Movies">{children}</MediaAppShell>
        </MediaProviders>
      </body>
    </html>
  );
}
