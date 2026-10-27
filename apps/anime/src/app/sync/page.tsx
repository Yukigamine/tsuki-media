import { Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SyncDashboard from "@/components/SyncDashboard";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sync – Tsuki Anime" };

export default async function SyncPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/sync");

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Sync
      </Typography>
      <SyncDashboard />
    </Container>
  );
}
