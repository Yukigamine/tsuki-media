import { Box, Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnimeCollectionItemForm } from "@/components/AnimeCollectionItemForm";
import prisma from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Edit Collection Item – Tsuki Anime",
};

type Props = { params: Promise<{ id: string }> };

export default async function EditAnimeCollectionItemPage({ params }: Props) {
  await requireSession();
  const { id } = await params;
  const item = await prisma.animeCollectionItem.findUnique({
    where: { id },
    include: { anime: true },
  });

  if (!item) notFound();

  const initialData = {
    id: item.id,
    animeId: item.animeId,
    kitsuId: item.anime.kitsuId,
    titleEn: item.anime.titleEn,
    rarity: item.rarity,
    format: item.format,
    condition: item.condition,
    notes: item.notes,
    purchasedAt: item.purchasedAt,
    pricePaid: item.pricePaid,
    barcode: item.barcode,
  };

  const title =
    item.anime.titleEn ??
    item.anime.titleRomaji ??
    item.anime.titleJp ??
    "Unknown";

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Edit collection item
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
      </Box>
      <AnimeCollectionItemForm initialData={initialData} />
    </Container>
  );
}
