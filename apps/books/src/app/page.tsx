import { CollectionPage } from "@tsuki-media/ui";

export default function BooksPage() {
  return (
    <CollectionPage
      mediaName="Books"
      providerName="Hardcover"
      storageKey="tsuki-media:books"
    />
  );
}
