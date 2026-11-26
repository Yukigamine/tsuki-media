"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { SETTINGS_ID } from "@/lib/settings";

const settingsSchema = z.object({
  displayName: z.string().trim().max(80),
  kitsuUsername: z.string().trim().max(80),
  anilistUsername: z.string().trim().max(80),
});

const welcomeSchema = settingsSchema.extend({
  authProvider: z.enum([
    "credentials",
    "google",
    "discord",
    "github",
    "twitter",
    "oauth",
  ]),
  masterEmail: z.string().trim().email().or(z.literal("")),
});

export type SettingsActionResult = { ok: true } | { ok: false; error: string };
export type WelcomeSettingsInput = z.infer<typeof welcomeSchema>;

export async function saveWelcomeSettingsAction(
  input: WelcomeSettingsInput,
): Promise<SettingsActionResult> {
  const parsed = welcomeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the setup fields and try again." };
  }

  const [settings, user] = await Promise.all([
    prisma.settings.findUnique({
      where: { id: SETTINGS_ID },
      select: { setupComplete: true },
    }),
    prisma.user.findFirst({ select: { id: true } }),
  ]);

  if (settings?.setupComplete || user) {
    return { ok: false, error: "Initial setup is no longer available." };
  }

  await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: parsed.data,
    create: { id: SETTINGS_ID, ...parsed.data },
  });
  return { ok: true };
}

export async function completeWelcomeAction(): Promise<SettingsActionResult> {
  const session = await requireSession();
  const user = await prisma.user.findFirst({
    select: { id: true, email: true },
  });

  if (!user || user.id !== session.user.id) {
    return { ok: false, error: "Only the master account can finish setup." };
  }

  await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: { setupComplete: true, masterEmail: user.email },
    create: {
      id: SETTINGS_ID,
      setupComplete: true,
      masterEmail: user.email,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateSettingsAction(
  input: z.infer<typeof settingsSchema>,
): Promise<SettingsActionResult> {
  await requireSession();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the settings fields and try again." };
  }

  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: parsed.data,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
