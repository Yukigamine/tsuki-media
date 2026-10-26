import { Box } from "@mui/material";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { Geist, Geist_Mono } from "next/font/google";
import Footer from "@/components/footer";
import NavBar from "@/components/NavBar";
import Providers from "@/components/Providers";
import { metadata } from "./metadata";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export { viewport } from "./metadata";
export { metadata };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
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
