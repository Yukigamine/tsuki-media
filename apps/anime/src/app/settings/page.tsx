import { Card, CardContent, Container, Stack, Typography } from "@mui/material";
import type { Metadata } from "next";
import SettingsForm from "@/components/SettingsForm";
import { requireSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings – Tsuki Anime" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [session, settings] = await Promise.all([
    requireSession(),
    getSettings(),
  ]);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Settings
        </Typography>
        <Card>
          <CardContent>
            <SettingsForm settings={settings} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h6">Master account</Typography>
            <Typography color="text.secondary">
              {session.user.email} · {settings.authProvider || "credentials"}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
