import { Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildAniListAuthUrl } from "@/lib/anilist/auth";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "AniList Login – Tsuki Anime" };

export default async function AniListLoginPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const authUrl = buildAniListAuthUrl();

  if (!process.env.ANILIST_CLIENT_ID) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>
          AniList not configured
        </Typography>
        <Typography color="text.secondary">
          Set <code>ANILIST_CLIENT_ID</code>, <code>ANILIST_CLIENT_SECRET</code>
          , and <code>ANILIST_REDIRECT_URI</code> in your environment to enable
          AniList OAuth.
        </Typography>
      </Container>
    );
  }

  redirect(authUrl);
}
