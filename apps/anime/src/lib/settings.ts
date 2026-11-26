import "server-only";
import prisma from "@/lib/prisma";

export const SETTINGS_ID = "app";

export type AppSettings = {
  setupComplete: boolean;
  displayName: string;
  kitsuUsername: string;
  anilistUsername: string;
  authProvider: string;
  masterEmail: string;
};

export async function getSettings(): Promise<AppSettings> {
  const settings = await prisma.settings.findUnique({
    where: { id: SETTINGS_ID },
  });
  const useEnvironmentDefaults = !settings?.setupComplete;

  return {
    setupComplete: settings?.setupComplete ?? false,
    displayName:
      settings?.displayName ||
      (useEnvironmentDefaults
        ? process.env.NEXT_PUBLIC_LIST_DISPLAYNAME?.trim()
        : "") ||
      "",
    kitsuUsername:
      settings?.kitsuUsername ||
      (useEnvironmentDefaults
        ? process.env.NEXT_PUBLIC_KITSU_USERNAME?.trim()
        : "") ||
      "",
    anilistUsername:
      settings?.anilistUsername ||
      (useEnvironmentDefaults
        ? process.env.NEXT_PUBLIC_ANILIST_USERNAME?.trim()
        : "") ||
      "",
    authProvider: settings?.authProvider || "",
    masterEmail:
      settings?.masterEmail ||
      (useEnvironmentDefaults ? process.env.AUTHORIZED_EMAIL?.trim() : "") ||
      "",
  };
}

export async function isSetupComplete(): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { id: SETTINGS_ID },
    select: { setupComplete: true },
  });
  return settings?.setupComplete ?? false;
}
