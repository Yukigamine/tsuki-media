import { Container, Stack, Typography } from "@mui/material";
import type { Metadata } from "next";
import WelcomeForm from "@/components/WelcomeForm";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Welcome – Tsuki Anime" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const [settings, session] = await Promise.all([getSettings(), getSession()]);
  const providers = [{ id: "credentials", label: "Username and password" }];

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push({ id: "google", label: "Google" });
  }
  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    providers.push({ id: "discord", label: "Discord" });
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.push({ id: "github", label: "GitHub" });
  }
  if (process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET) {
    providers.push({ id: "twitter", label: "Twitter / X" });
  }
  if (
    process.env.CUSTOM_OAUTH_CLIENT_ID &&
    process.env.CUSTOM_OAUTH_CLIENT_SECRET
  ) {
    providers.push({
      id: "oauth",
      label: process.env.CUSTOM_OAUTH_NAME || "OAuth",
    });
  }

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <div>
          <Typography variant="h3" component="h1" sx={{ fontWeight: 700 }}>
            Welcome to Tsuki Anime
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Configure this instance and create its single master account.
            Database connection details remain configured through environment
            variables.
          </Typography>
        </div>
        <WelcomeForm
          providers={providers}
          defaults={settings}
          hasSession={Boolean(session)}
        />
      </Stack>
    </Container>
  );
}
