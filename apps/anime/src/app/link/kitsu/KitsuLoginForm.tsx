"use client";

import {
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { saveKitsuTokenAction } from "@/lib/actions/auth";

const KITSU_OAUTH_URL =
  process.env.NEXT_PUBLIC_KITSU_OAUTH_URL ??
  process.env.NEXT_PUBLIC_KITSU_API_OAUTH_URL ??
  "https://kitsu.app/api/oauth/token";

type KitsuTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export default function KitsuLoginForm({
  configuredUsername,
}: {
  configuredUsername: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(configuredUsername);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    try {
      const requiredUsername = configuredUsername.trim();
      if (
        requiredUsername &&
        username.trim().toLowerCase() !== requiredUsername.toLowerCase()
      ) {
        enqueueSnackbar(
          `This app is configured for "${requiredUsername}". Sign in with that account.`,
          { variant: "error" },
        );
        return;
      }

      const tokenRes = await fetch(KITSU_OAUTH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "password",
          username,
          password,
        }),
      });

      const tokenData = (await tokenRes.json()) as KitsuTokenResponse;

      if (!tokenRes.ok || !tokenData.access_token) {
        const message =
          tokenData.error_description ??
          tokenData.error ??
          `Kitsu login failed (${tokenRes.status})`;
        enqueueSnackbar(message, { variant: "error" });
        return;
      }

      const saveResult = await saveKitsuTokenAction({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        expiresIn: tokenData.expires_in,
        fallbackUsername: username.trim(),
      });

      if (!saveResult.ok) {
        enqueueSnackbar(saveResult.error, { variant: "error" });
        return;
      }

      enqueueSnackbar("Kitsu account linked successfully.", {
        variant: "success",
      });
      router.push("/link");
    } catch {
      enqueueSnackbar(
        "Unable to authenticate with Kitsu from the browser. Check CORS/network settings and try again.",
        { variant: "error" },
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container maxWidth="xs" sx={{ py: 8 }}>
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>
        Sign in with Kitsu
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Your credentials are sent directly from your browser to Kitsu. Only the
        returned token is sent to this app.
      </Typography>

      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        <TextField
          label="Kitsu username or email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          disabled={loading || !!configuredUsername}
          helperText={
            configuredUsername
              ? "Pre-filled from server configuration"
              : undefined
          }
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          disabled={loading}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={loading || !username || !password}
          sx={{ textTransform: "none" }}
        >
          {loading ? <CircularProgress size={22} color="inherit" /> : "Sign in"}
        </Button>
        <Link href="/link" underline="hover" sx={{ textAlign: "center" }}>
          ← Back to accounts
        </Link>
      </Box>
    </Container>
  );
}
