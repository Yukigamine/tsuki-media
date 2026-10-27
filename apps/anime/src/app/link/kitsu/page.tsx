import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import KitsuLoginForm from "./KitsuLoginForm";

export const metadata: Metadata = { title: "Kitsu Login – Tsuki Anime" };

export default async function KitsuLoginPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { kitsuUsername: configuredUsername } = await getSettings();
  return <KitsuLoginForm configuredUsername={configuredUsername} />;
}
