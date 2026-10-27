"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  completeWelcomeAction,
  saveWelcomeSettingsAction,
} from "@/lib/actions/settings";
import { authClient } from "@/lib/betterauth-client";

type Provider = { id: string; label: string };

export default function WelcomeForm({
  providers,
  defaults,
  hasSession,
}: {
  providers: Provider[];
  defaults: {
    displayName: string;
    kitsuUsername: string;
    anilistUsername: string;
    authProvider: string;
    masterEmail: string;
  };
  hasSession: boolean;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(
    defaults.authProvider || providers[0]?.id || "credentials",
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function finish() {
    setPending(true);
    setError("");
    try {
      const result = await completeWelcomeAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Unable to finish setup.");
    } finally {
      setPending(false);
    }
  }

  async function submit(formData: FormData) {
    setPending(true);
    setError("");

    const masterEmail =
      provider === "credentials"
        ? String(formData.get("email") ?? "")
        : defaults.masterEmail;
    const result = await saveWelcomeSettingsAction({
      displayName: String(formData.get("displayName") ?? ""),
      kitsuUsername: String(formData.get("kitsuUsername") ?? ""),
      anilistUsername: String(formData.get("anilistUsername") ?? ""),
      authProvider: provider as
        | "credentials"
        | "google"
        | "discord"
        | "github"
        | "twitter"
        | "oauth",
      masterEmail,
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    if (provider === "credentials") {
      const username = String(formData.get("username") ?? "");
      const displayName = String(formData.get("displayName") ?? "").trim();
      const signUp = await authClient.signUp.email({
        name: displayName || username,
        username,
        email: masterEmail,
        password: String(formData.get("password") ?? ""),
      });
      if (signUp.error) {
        setError(
          signUp.error.message || "Unable to create the master account.",
        );
        setPending(false);
        return;
      }
      await finish();
      return;
    }

    if (provider === "oauth") {
      await authClient.signIn.oauth2({
        providerId: "oauth",
        callbackURL: "/welcome",
      });
    } else {
      await authClient.signIn.social({
        provider: provider as "google" | "discord" | "github" | "twitter",
        callbackURL: "/welcome",
      });
    }
  }

  if (hasSession) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Alert severity="success">
              Master account created. Finish setup to unlock the app.
            </Alert>
            {error && <Alert severity="error">{error}</Alert>}
            <Button variant="contained" disabled={pending} onClick={finish}>
              Finish setup
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card component="form" action={submit}>
      <CardContent>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            name="displayName"
            label="Display name"
            defaultValue={defaults.displayName}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <TextField
            name="kitsuUsername"
            label="Kitsu username"
            defaultValue={defaults.kitsuUsername}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <TextField
            name="anilistUsername"
            label="AniList username"
            defaultValue={defaults.anilistUsername}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <FormControl>
            <FormLabel>Master account login</FormLabel>
            <RadioGroup
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              {providers.map((item) => (
                <FormControlLabel
                  key={item.id}
                  value={item.id}
                  control={<Radio />}
                  label={item.label}
                />
              ))}
            </RadioGroup>
          </FormControl>
          {provider === "credentials" && (
            <>
              <TextField
                name="username"
                label="Username"
                required
                slotProps={{ htmlInput: { minLength: 3, maxLength: 30 } }}
              />
              <TextField
                name="email"
                label="Email"
                type="email"
                required
                defaultValue={defaults.masterEmail}
              />
              <TextField
                name="password"
                label="Password"
                type="password"
                required
                slotProps={{ htmlInput: { minLength: 8 } }}
              />
            </>
          )}
          <Button type="submit" variant="contained" disabled={pending}>
            {provider === "credentials"
              ? "Create master account"
              : "Continue with provider"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
