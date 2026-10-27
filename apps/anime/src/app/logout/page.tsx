import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LogoutForm from "@/components/LogoutForm";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Log out – Tsuki Anime" };

export default async function LogoutPage() {
  const result = await getSession();

  if (!result?.user) {
    redirect("/login");
  }

  return <LogoutForm user={result.user} />;
}
