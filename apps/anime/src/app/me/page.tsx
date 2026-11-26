import type { Metadata } from "next";
import UserProfileContent from "@/components/UserProfileContent";
import { getProfileSummary } from "@/lib/profile-summary";
import { getAuthStatus } from "@/lib/provider-links";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "About" };

export const dynamic = "force-dynamic";

export default async function MePage() {
  const [linkedAccounts, settings] = await Promise.all([
    getAuthStatus(),
    getSettings(),
  ]);
  const profileSummary = await getProfileSummary(
    linkedAccounts.ANILIST.username,
  );

  return (
    <UserProfileContent
      username={settings.kitsuUsername}
      profileSummary={profileSummary}
      linkedAccounts={{
        kitsu: linkedAccounts.KITSU.username,
        anilist: linkedAccounts.ANILIST.username,
      }}
    />
  );
}
