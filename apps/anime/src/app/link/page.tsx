import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import KeyIcon from "@mui/icons-material/Key";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  Typography,
} from "@mui/material";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logoutAndRedirectAction } from "@/lib/actions/auth";
import { getAuthStatus } from "@/lib/provider-links";
import { getSession } from "@/lib/session";
import LinkFlashSnackbar from "./LinkFlashSnackbar";

export const metadata: Metadata = { title: "Login – Tsuki Anime" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!session) redirect("/login?next=/link");

  const auth = await getAuthStatus(session.user.id);
  const error = params.error;

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <LinkFlashSnackbar />
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Connect your accounts
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        Link Kitsu and/or AniList to enable two-way sync of your anime and manga
        lists.
      </Typography>

      {error && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            bgcolor: "error.dark",
            borderRadius: 2,
            color: "error.contrastText",
          }}
        >
          <Typography variant="body2">{decodeURIComponent(error)}</Typography>
        </Box>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}
          >
            <KeyIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Kitsu
            </Typography>
            {auth.KITSU.loggedIn && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  ml: "auto",
                }}
              >
                <CheckCircleIcon color="success" fontSize="small" />
                <Typography variant="caption" color="success.main">
                  {auth.KITSU.username}
                </Typography>
              </Box>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sign in with your Kitsu username and password. Credentials are sent
            directly from your browser to Kitsu, and only token data is sent
            back to this app.
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="contained"
              href="/link/kitsu"
              sx={{ textTransform: "none" }}
            >
              {auth.KITSU.loggedIn ? "Re-authenticate" : "Sign in with Kitsu"}
            </Button>
            {auth.KITSU.loggedIn && (
              <LogoutButton provider="KITSU" label="Disconnect" />
            )}
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}
          >
            <OpenInNewIcon color="secondary" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              AniList
            </Typography>
            {auth.ANILIST.loggedIn && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  ml: "auto",
                }}
              >
                <CheckCircleIcon color="success" fontSize="small" />
                <Typography variant="caption" color="success.main">
                  {auth.ANILIST.username}
                </Typography>
              </Box>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Authorize via AniList OAuth. You&apos;ll be redirected to AniList to
            approve access, then returned here.
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="contained"
              color="secondary"
              href="/link/anilist"
              sx={{ textTransform: "none" }}
            >
              {auth.ANILIST.loggedIn
                ? "Re-authorize AniList"
                : "Authorize AniList"}
            </Button>
            {auth.ANILIST.loggedIn && (
              <LogoutButton provider="ANILIST" label="Disconnect" />
            )}
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}

function LogoutButton({
  provider,
  label,
}: {
  provider: "KITSU" | "ANILIST";
  label: string;
}) {
  const action = logoutAndRedirectAction.bind(null, provider);
  return (
    <form action={action}>
      <Button
        type="submit"
        variant="outlined"
        color="error"
        size="small"
        sx={{ textTransform: "none" }}
      >
        {label}
      </Button>
    </form>
  );
}
