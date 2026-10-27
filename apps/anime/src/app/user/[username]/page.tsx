import type { Metadata } from "next";
import UserProfileContent from "@/components/UserProfileContent";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return { title: `${username} – Tsuki Anime` };
}

export const dynamic = "force-dynamic";

export default async function UserPage({ params }: Props) {
  const { username } = await params;
  return <UserProfileContent username={username} />;
}
