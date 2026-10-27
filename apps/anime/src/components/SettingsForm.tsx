"use client";

import { Alert, Button, Stack, TextField } from "@mui/material";
import { useState } from "react";
import { updateSettingsAction } from "@/lib/actions/settings";

export default function SettingsForm({
  settings,
}: {
  settings: {
    displayName: string;
    kitsuUsername: string;
    anilistUsername: string;
  };
}) {
  const [message, setMessage] = useState<{
    severity: "success" | "error";
    text: string;
  } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    const result = await updateSettingsAction({
      displayName: String(formData.get("displayName") ?? ""),
      kitsuUsername: String(formData.get("kitsuUsername") ?? ""),
      anilistUsername: String(formData.get("anilistUsername") ?? ""),
    });
    setMessage(
      result.ok
        ? { severity: "success", text: "Settings saved." }
        : { severity: "error", text: result.error },
    );
    setPending(false);
  }

  return (
    <Stack component="form" action={submit} spacing={2}>
      {message && <Alert severity={message.severity}>{message.text}</Alert>}
      <TextField
        name="displayName"
        label="Display name"
        defaultValue={settings.displayName}
        slotProps={{ htmlInput: { maxLength: 80 } }}
      />
      <TextField
        name="kitsuUsername"
        label="Kitsu username"
        defaultValue={settings.kitsuUsername}
        slotProps={{ htmlInput: { maxLength: 80 } }}
      />
      <TextField
        name="anilistUsername"
        label="AniList username"
        defaultValue={settings.anilistUsername}
        slotProps={{ htmlInput: { maxLength: 80 } }}
      />
      <Button type="submit" variant="contained" disabled={pending}>
        Save settings
      </Button>
    </Stack>
  );
}
