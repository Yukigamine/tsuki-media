import { Box } from "@mui/material";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { Fredoka, Geist_Mono, Noto_Sans, Open_Sans } from "next/font/google";
import Footer from "@/components/footer";
import NavBar from "@/components/NavBar";
import Providers from "@/components/Providers";
import { metadata } from "./metadata";

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
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export { metadata };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fredoka.variable} ${notoSans.variable} ${openSans.variable} ${geistMono.variable}`}
    >
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <Providers>
          <Box
            sx={{
              minHeight: "100dvh",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              overflowX: "hidden",
            }}
          >
            <NavBar />
            <Box
              component="main"
              sx={{ flex: 1, minWidth: 0, overflowX: "hidden" }}
            >
              {children}
            </Box>
            <Footer />
          </Box>
        </Providers>
      </body>
    </html>
  );
}
