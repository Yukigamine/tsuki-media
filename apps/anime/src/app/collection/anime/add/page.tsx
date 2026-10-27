import { Box, Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { AnimeCollectionItemForm } from "@/components/AnimeCollectionItemForm";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Add to Anime Collection – Tsuki Anime",
};

export default async function AddAnimeCollectionItemPage() {
  await requireSession();
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Add anime to collection
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Search for a title and fill in the details for your item.
        </Typography>
      </Box>
      <AnimeCollectionItemForm />
    </Container>
  );
}
