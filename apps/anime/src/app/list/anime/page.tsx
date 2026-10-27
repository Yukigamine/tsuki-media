import { Box, Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import AnimeListClient from "@/components/AnimeListClient";
import ListAddButton from "@/components/ListAddButton";
import { MediaLibraryHeader } from "@/components/MediaLibraryHeader";
import { getLibraryPageTitle } from "@/lib/library-page-title";
import { getAnimeListSnapshot } from "@/lib/list";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Anime List – Tsuki Anime" };
export const dynamic = "force-dynamic";

export default async function AnimeListPage() {
  const title = await getLibraryPageTitle("anime", "list");
  let items: Awaited<ReturnType<typeof getAnimeListSnapshot>>["items"] = [];
  let counts: Awaited<ReturnType<typeof getAnimeListSnapshot>>["counts"] = {};
  let isAuthenticated = false;

  try {
    const [snapshot, session] = await Promise.all([
      getAnimeListSnapshot(),
      getSession(),
    ]);
    items = snapshot.items;
    counts = snapshot.counts;
    isAuthenticated = !!session;
  } catch (e) {
    let err = "Unknown error";
    if (e instanceof Error) {
      err = e.message;
    } else if (e && typeof e === "object" && "message" in e) {
      err = String((e as { message: unknown }).message);
    } else if (typeof e === "string") {
      err = e;
    }
    console.error("Failed to load anime list:", err, e);
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
          {title}
        </Typography>
        <Box sx={{ textAlign: "center", py: 12 }}>
          <Typography variant="h5" color="error" gutterBottom>
            Error loading list
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {err}
          </Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <MediaLibraryHeader
        title={title}
        action={
          isAuthenticated ? (
            <ListAddButton
              type="anime"
              existingKitsuIds={items.flatMap((item) =>
                item.kitsuId ? [item.kitsuId] : [],
              )}
            />
          ) : undefined
        }
      />

      <AnimeListClient
        items={items}
        counts={counts}
        existingKitsuIds={items.flatMap((item) =>
          item.kitsuId ? [item.kitsuId] : [],
        )}
        isAuthenticated={isAuthenticated}
      />
    </Container>
  );
}
