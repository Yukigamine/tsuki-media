"use client";

import LanguageIcon from "@mui/icons-material/Language";
import LoginIcon from "@mui/icons-material/Login";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/betterauth-client";

export type LoginProvider = {
  id: string;
  label: string;
  color: string;
  /** Inline SVG string or null – fallback to initial avatar */
  svg: string | null;
  iconUrl: string | null | undefined;
};

const _PROVIDER_COLORS: Record<string, string> = {
  google: "#4285F4",
  discord: "#5865F2",
  github: "#24292e",
  twitter: "#000000",
  custom: "#607d8b",
};

// Minimal inline SVGs for known providers
const PROVIDER_SVGS: Record<string, string> = {
  google: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
  github: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
  discord: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#5865F2" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
};

function ProviderIcon({ provider }: { provider: LoginProvider }) {
  if (provider.iconUrl) {
    return (
      <Box
        component="img"
        src={provider.iconUrl}
        alt=""
        sx={{
          width: 20,
          height: 20,
          display: "block",
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
    );
  }
  const svg = PROVIDER_SVGS[provider.id];
  if (svg) {
    return (
      <Box
        sx={{ width: 20, height: 20, flexShrink: 0, color: "inherit" }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVGs are hardcoded, not user input
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return <LanguageIcon sx={{ fontSize: 20 }} />;
}

function LoginContent({
  providers,
  credentials,
}: {
  providers: LoginProvider[];
  credentials: boolean;
}) {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  async function signIn(provider: LoginProvider) {
    setLoading(provider.id);
    try {
      if (provider.id === "oauth") {
        // Custom OAuth uses the generic OAuth plugin
        await authClient.signIn.oauth2({
          providerId: "oauth",
          callbackURL: "/",
        });
      } else {
        // Standard social providers
        await authClient.signIn.social({
          provider: provider.id as Parameters<
            typeof authClient.signIn.social
          >[0]["provider"],
          callbackURL: "/",
        });
      }
    } catch {
      setLoading(null);
    }
  }

  async function signInWithCredentials(formData: FormData) {
    setLoading("credentials");
    setAuthError("");
    const result = await authClient.signIn.username({
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      callbackURL: "/",
    });
    if (result.error) {
      setAuthError("Invalid username or password.");
      setLoading(null);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3} sx={{ alignItems: "center" }}>
            <LoginIcon sx={{ fontSize: 48, color: "primary.main" }} />
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Sign in
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", mt: 0.5 }}
              >
                Access is restricted to authorized users only.
              </Typography>
            </Box>

            {error === "unauthorized" && (
              <Alert severity="error" sx={{ width: "100%" }}>
                Your account is not authorized to access this app.
              </Alert>
            )}
            {authError && (
              <Alert severity="error" sx={{ width: "100%" }}>
                {authError}
              </Alert>
            )}

            {credentials ? (
              <Stack
                component="form"
                action={signInWithCredentials}
                spacing={1.5}
                sx={{ width: "100%" }}
              >
                <TextField name="username" label="Username" required />
                <TextField
                  name="password"
                  label="Password"
                  type="password"
                  required
                />
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading !== null}
                  startIcon={
                    loading === "credentials" ? (
                      <CircularProgress size={18} />
                    ) : (
                      <LoginIcon />
                    )
                  }
                >
                  Sign in
                </Button>
              </Stack>
            ) : providers.length === 0 ? (
              <Alert severity="warning" sx={{ width: "100%" }}>
                No OAuth providers are configured. Set provider env vars and
                restart.
              </Alert>
            ) : (
              <Stack spacing={1.5} sx={{ width: "100%" }}>
                {providers.map((provider) => (
                  <Button
                    key={provider.id}
                    fullWidth
                    variant="outlined"
                    size="large"
                    disabled={loading !== null}
                    onClick={() => signIn(provider)}
                    startIcon={
                      loading === provider.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <ProviderIcon provider={provider} />
                      )
                    }
                    sx={{
                      borderColor: "divider",
                      color: "text.primary",
                      justifyContent: "flex-start",
                      px: 2.5,
                      py: 1.25,
                      gap: 1,
                      "&:hover": {
                        borderColor: provider.color,
                        color: provider.color,
                        bgcolor: "transparent",
                      },
                    }}
                  >
                    Continue with {provider.label}
                  </Button>
                ))}
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function LoginForm({
  providers,
  credentials,
}: {
  providers: LoginProvider[];
  credentials: boolean;
}) {
  return (
    <Suspense>
      <LoginContent providers={providers} credentials={credentials} />
    </Suspense>
  );
}
