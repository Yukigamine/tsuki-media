export type MediaDetailSnapshot = {
  id: string;
  kitsuId: string | null;
  anilistId: number | null;
  titleEn: string | null;
  titleJp: string | null;
  titleRomaji: string | null;
  synopsis: string | null;
  coverImageUrl: string | null;
  bannerImageUrl: string | null;
  episodeCount: number | null;
  chapterCount: number | null;
  volumeCount: number | null;
  showStatus: string;
  averageRating: number | null;
  startDate: string | null;
  endDate: string | null;
};
