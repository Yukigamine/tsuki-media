import { Container } from "@mui/material";
import type { Metadata } from "next";
import { CollectionAddButton } from "@/components/CollectionAddButton";
import { CollectionViewWrapper } from "@/components/CollectionViewWrapper";
import { MangaCollectionGrid } from "@/components/MangaCollectionGrid";
import { MediaLibraryHeader } from "@/components/MediaLibraryHeader";
import { getLibrarySnapshot } from "@/lib/library";
import { getLibraryPageTitle } from "@/lib/library-page-title";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Manga Collection – Tsuki Anime" };
export const dynamic = "force-dynamic";

export default async function MangaCollectionPage() {
  const title = await getLibraryPageTitle("manga", "collection");
  const [items, session] = await Promise.all([
    getLibrarySnapshot().then((library) =>
      library.manga.flatMap(
        ({ collectionItems, listEntry: _listEntry, ...media }) =>
          [...collectionItems]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((item) => ({ ...item, manga: media })),
      ),
    ),
    getSession(),
  ]);
  const isAuthenticated = !!session;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <MediaLibraryHeader
        title={title}
        action={
          isAuthenticated ? <CollectionAddButton type="manga" /> : undefined
        }
      />

      <CollectionViewWrapper
        items={items}
        type="manga"
        gridComponent={MangaCollectionGrid}
        isAuthenticated={isAuthenticated}
      />
    </Container>
  );
}
