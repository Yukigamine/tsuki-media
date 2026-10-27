import { Container } from "@mui/material";
import type { Metadata } from "next";
import { AnimeCollectionGrid } from "@/components/AnimeCollectionGrid";
import { CollectionAddButton } from "@/components/CollectionAddButton";
import { CollectionViewWrapper } from "@/components/CollectionViewWrapper";
import { MediaLibraryHeader } from "@/components/MediaLibraryHeader";
import { getLibrarySnapshot } from "@/lib/library";
import { getLibraryPageTitle } from "@/lib/library-page-title";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Anime Collection – Tsuki Anime" };
export const dynamic = "force-dynamic";

export default async function AnimeCollectionPage() {
  const title = await getLibraryPageTitle("anime", "collection");
  const [items, session] = await Promise.all([
    getLibrarySnapshot().then((library) =>
      library.anime.flatMap(
        ({ collectionItems, listEntry: _listEntry, ...media }) =>
          [...collectionItems]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((item) => ({ ...item, anime: media })),
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
          isAuthenticated ? <CollectionAddButton type="anime" /> : undefined
        }
      />

      <CollectionViewWrapper
        items={items}
        type="anime"
        gridComponent={AnimeCollectionGrid}
        isAuthenticated={isAuthenticated}
      />
    </Container>
  );
}
