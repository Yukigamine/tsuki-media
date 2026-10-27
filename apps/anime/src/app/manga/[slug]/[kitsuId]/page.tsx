import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProviderMediaDetailPage from "@/components/ProviderMediaDetailPage";
import { getLibrarySnapshot } from "@/lib/library";
import { getMangaDetailSnapshot } from "@/lib/media-detail";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Manga Details – Tsuki Anime" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; kitsuId: string }> };

export default async function MangaDetailPage({ params }: Props) {
  const { slug, kitsuId } = await params;
  const [session, detail] = await Promise.all([
    getSession(),
    getMangaDetailSnapshot(kitsuId),
  ]);
  if (!detail) notFound();
  const manga =
    (await getLibrarySnapshot()).manga.find((item) => item.id === detail.id) ??
    null;

  return (
    <ProviderMediaDetailPage
      kitsuId={detail ? detail.kitsuId : kitsuId}
      fallbackTitle={detail?.titleEn ?? detail?.titleRomaji ?? slug}
      mediaType="manga"
      mediaId={manga?.id ?? null}
      anilistId={detail?.anilistId ?? null}
      initialDetail={detail}
      hasSession={Boolean(session)}
      listEntry={manga?.listEntry ?? null}
      collectionCount={manga?.collectionItems.length ?? 0}
      collectionItems={manga?.collectionItems ?? []}
    />
  );
}
