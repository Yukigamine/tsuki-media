import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProviderMediaDetailPage from "@/components/ProviderMediaDetailPage";
import { getLibrarySnapshot } from "@/lib/library";
import { getAnimeDetailSnapshot } from "@/lib/media-detail";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Anime Details – Tsuki Anime" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; kitsuId: string }> };

export default async function AnimeDetailPage({ params }: Props) {
  const { slug, kitsuId } = await params;
  const [session, detail] = await Promise.all([
    getSession(),
    getAnimeDetailSnapshot(kitsuId),
  ]);
  if (!detail) notFound();
  const anime =
    (await getLibrarySnapshot()).anime.find((item) => item.id === detail.id) ??
    null;

  return (
    <ProviderMediaDetailPage
      kitsuId={detail ? detail.kitsuId : kitsuId}
      fallbackTitle={detail?.titleEn ?? detail?.titleRomaji ?? slug}
      mediaType="anime"
      mediaId={anime?.id ?? null}
      anilistId={detail?.anilistId ?? null}
      initialDetail={detail}
      hasSession={Boolean(session)}
      listEntry={anime?.listEntry ?? null}
      collectionCount={anime?.collectionItems.length ?? 0}
      collectionFormats={
        anime?.collectionItems.map((item) => item.format) ?? []
      }
      collectionItems={anime?.collectionItems ?? []}
    />
  );
}
