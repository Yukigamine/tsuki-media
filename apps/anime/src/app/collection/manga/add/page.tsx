import { Box, Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { MangaCollectionItemForm } from "@/components/MangaCollectionItemForm";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Add to Manga Collection – Tsuki Anime",
};

export default async function AddMangaCollectionItemPage() {
  await requireSession();
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Add manga to collection
        </Typography>
      </Box>
      <MangaCollectionItemForm />
    </Container>
  );
}
