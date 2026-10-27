import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { LoginProvider } from "@/components/LoginForm";
import LoginForm from "@/components/LoginForm";
import { getSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Sign in– Tsuki Anime" };

const PROVIDER_COLORS: Record<string, string> = {
  google: "#4285F4",
  discord: "#5865F2",
  github: "#24292e",
  twitter: "#000000",
};

export default async function LoginPage() {
  const session = await getSession();

  if (session) {
    redirect("/logout");
  }

  const settings = await getSettings();
  const providers: LoginProvider[] = [];

  if (
    settings.authProvider === "google" &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    providers.push({
      id: "google",
      label: "Google",
      color: PROVIDER_COLORS.google,
      svg: null,
      iconUrl: null,
    });
  }
  if (
    settings.authProvider === "discord" &&
    process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET
  ) {
    providers.push({
      id: "discord",
      label: "Discord",
      color: PROVIDER_COLORS.discord,
      svg: null,
      iconUrl: null,
    });
  }
  if (
    settings.authProvider === "github" &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET
  ) {
    providers.push({
      id: "github",
      label: "GitHub",
      color: PROVIDER_COLORS.github,
      svg: null,
      iconUrl: null,
    });
  }
  if (
    settings.authProvider === "twitter" &&
    process.env.TWITTER_CLIENT_ID &&
    process.env.TWITTER_CLIENT_SECRET
  ) {
    providers.push({
      id: "twitter",
      label: "Twitter / X",
      color: PROVIDER_COLORS.twitter,
      svg: null,
      iconUrl: null,
    });
  }
  if (
    settings.authProvider === "oauth" &&
    process.env.CUSTOM_OAUTH_CLIENT_ID &&
    process.env.CUSTOM_OAUTH_CLIENT_SECRET
  ) {
    providers.push({
      id: "oauth",
      label: process.env.CUSTOM_OAUTH_NAME ?? "Custom",
      color: "#607d8b",
      svg: null,
      iconUrl: process.env.CUSTOM_OAUTH_ICON ?? null,
    });
  }

  return (
    <LoginForm
      providers={providers}
      credentials={settings.authProvider === "credentials"}
    />
  );
}
