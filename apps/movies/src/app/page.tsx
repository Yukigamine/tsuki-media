import { CollectionPage } from "@tsuki-media/ui";

export default function MoviesPage() {
  return (
    <CollectionPage
      mediaName="Movies"
      providerName="The Movie Database (TMDB)"
      storageKey="tsuki-media:movies"
    />
  );
}
