import { Box, Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MangaCollectionItemForm } from "@/components/MangaCollectionItemForm";
import prisma from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Edit Collection Item – Tsuki Anime",
};

type Props = { params: Promise<{ id: string }> };

export default async function EditMangaCollectionItemPage({ params }: Props) {
  await requireSession();
  const { id } = await params;
  const item = await prisma.mangaCollectionItem.findUnique({
    where: { id },
    include: { manga: true },
  });

  if (!item) notFound();

  const initialData = {
    id: item.id,
    mangaId: item.mangaId,
    kitsuId: item.manga.kitsuId,
    titleEn: item.manga.titleEn,
    condition: item.condition,
    language: item.language,
    notes: item.notes,
    containsSerialized: item.containsSerialized,
    containsOmnibus: item.containsOmnibus,
    volumes: item.volumes,
    chapters: item.chapters,
  };

  const title =
    item.manga.titleEn ??
    item.manga.titleRomaji ??
    item.manga.titleJp ??
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
      <MangaCollectionItemForm initialData={initialData} />
    </Container>
  );
}
