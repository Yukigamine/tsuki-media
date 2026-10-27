"use client";

import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import CollectionsBookmarkIcon from "@mui/icons-material/CollectionsBookmark";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LinkIcon from "@mui/icons-material/Link";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PersonIcon from "@mui/icons-material/Person";
import SyncIcon from "@mui/icons-material/Sync";
import VideoLibraryIcon from "@mui/icons-material/VideoLibrary";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ColorSchemeToggle from "@/components/ColorSchemeToggle";
import { logoutAppAction } from "@/lib/actions/auth";
import { authClient } from "@/lib/betterauth-client";

// Generate a Gravatar URL from email using SHA256 hash
async function generateGravatarUrl(email: string): Promise<string> {
  const encodedEmail = new TextEncoder().encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", encodedEmail);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `https://www.gravatar.com/avatar/${hashHex}?d=identicon&s=32`;
}

function ProfileButton({
  profileImageUrl,
  sessionUserName,
  hasSession,
}: {
  profileImageUrl: string | undefined;
  sessionUserName: string | undefined;
  hasSession: boolean;
}) {
  if (!hasSession) {
    return (
      <IconButton
        component={Link}
        href="/login"
        prefetch={false}
        title="Log in"
        sx={{ p: 0.5 }}
      >
        <AccountCircleIcon />
      </IconButton>
    );
  }

  return (
    <IconButton
      component={Link}
      href="/logout"
      prefetch={false}
      title={sessionUserName ? `${sessionUserName}` : "Account"}
      sx={{ p: 0.5 }}
    >
      {profileImageUrl ? (
        <Avatar
          src={profileImageUrl}
          alt={sessionUserName || "Profile"}
          sx={{ width: 32, height: 32 }}
        />
      ) : (
        <AccountCircleIcon />
      )}
    </IconButton>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { data: session } = authClient.useSession();

  const [collectionAnchor, setCollectionAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (session?.user?.image) {
      setProfileImageUrl(session.user.image);
    } else if (session?.user?.email) {
      generateGravatarUrl(session.user.email).then(setProfileImageUrl);
    } else {
      setProfileImageUrl(undefined);
    }
  }, [session?.user?.image, session?.user?.email]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ borderBottom: "1px solid", borderColor: "divider" }}
      >
        <Toolbar>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mr: 3 }}>
            <Image
              src="/icons/tsuki/squirlecon.svg"
              alt="Tsuki Anime"
              width={48}
              height={48}
            />
            <Typography
              variant="h6"
              component={Link}
              href="/list/anime"
              sx={{
                fontWeight: 700,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              Tsuki Anime
            </Typography>
          </Box>

          {isMobile ? (
            <>
              <Box sx={{ flex: 1 }} />
              <ColorSchemeToggle />
              <IconButton color="inherit" onClick={() => setDrawerOpen(true)}>
                <MenuIcon />
              </IconButton>
            </>
          ) : (
            <>
              {/* Anime List button */}
              <Button
                component={Link}
                href="/list/anime"
                prefetch={false}
                startIcon={<LiveTvIcon />}
                color={isActive("/list/anime") ? "primary" : "inherit"}
                sx={{
                  textTransform: "none",
                  fontWeight: isActive("/list/anime") ? 700 : 400,
                  mr: 0.5,
                  fontSize: "1.1rem",
                }}
              >
                Anime List
              </Button>

              {/* Manga List button */}
              <Button
                component={Link}
                href="/list/manga"
                prefetch={false}
                startIcon={<MenuBookIcon />}
                color={isActive("/list/manga") ? "primary" : "inherit"}
                sx={{
                  textTransform: "none",
                  fontWeight: isActive("/list/manga") ? 700 : 400,
                  mr: 0.5,
                  fontSize: "1.1rem",
                }}
              >
                Manga List
              </Button>

              {/* Collections dropdown */}
              <Button
                startIcon={<VideoLibraryIcon />}
                endIcon={<ExpandMoreIcon fontSize="small" />}
                onClick={(e) => setCollectionAnchor(e.currentTarget)}
                color={isActive("/collection") ? "primary" : "inherit"}
                sx={{
                  textTransform: "none",
                  fontWeight: isActive("/collection") ? 700 : 400,
                  mr: 0.5,
                  fontSize: "1.1rem",
                }}
              >
                Collections
              </Button>
              <Menu
                anchorEl={collectionAnchor}
                open={Boolean(collectionAnchor)}
                onClose={() => setCollectionAnchor(null)}
              >
                <MenuItem
                  component={Link}
                  href="/collection/anime"
                  prefetch={false}
                  onClick={() => setCollectionAnchor(null)}
                  selected={isActive("/collection/anime")}
                >
                  <ListItemIcon>
                    <VideoLibraryIcon fontSize="small" />
                  </ListItemIcon>
                  Anime
                </MenuItem>

                <MenuItem
                  component={Link}
                  href="/collection/manga"
                  prefetch={false}
                  onClick={() => setCollectionAnchor(null)}
                  selected={isActive("/collection/manga")}
                >
                  <ListItemIcon>
                    <CollectionsBookmarkIcon fontSize="small" />
                  </ListItemIcon>
                  Manga
                </MenuItem>
              </Menu>

              <Box sx={{ flex: 1 }} />

              <Button
                component={Link}
                href="/me"
                prefetch={false}
                startIcon={<PersonIcon fontSize="small" />}
                color={isActive("/me") ? "primary" : "inherit"}
                sx={{
                  textTransform: "none",
                  fontWeight: isActive("/me") ? 700 : 400,
                  mr: 0.5,
                }}
              >
                About
              </Button>

              {session && (
                <Button
                  component={Link}
                  href="/sync"
                  prefetch={false}
                  startIcon={<SyncIcon fontSize="small" />}
                  color={isActive("/sync") ? "primary" : "inherit"}
                  sx={{
                    textTransform: "none",
                    fontWeight: isActive("/sync") ? 700 : 400,
                    mr: 0.5,
                  }}
                >
                  Sync
                </Button>
              )}

              {session && (
                <Button
                  component={Link}
                  href="/link"
                  prefetch={false}
                  startIcon={<LinkIcon fontSize="small" />}
                  color={isActive("/link") ? "primary" : "inherit"}
                  sx={{
                    textTransform: "none",
                    fontWeight: isActive("/link") ? 700 : 400,
                    mr: 0.5,
                  }}
                >
                  Accounts
                </Button>
              )}

              <ColorSchemeToggle />

              <ProfileButton
                profileImageUrl={profileImageUrl}
                sessionUserName={session?.user?.name}
                hasSession={!!session}
              />
            </>
          )}
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: 260 } } }}
      >
        <Toolbar />
        <List dense>
          <ListItemButton
            component={Link}
            href="/list/anime"
            prefetch={false}
            selected={isActive("/list/anime")}
            onClick={() => setDrawerOpen(false)}
          >
            <ListItemIcon>
              <LiveTvIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Anime List" />
          </ListItemButton>

          <ListItemButton
            component={Link}
            href="/list/manga"
            prefetch={false}
            selected={isActive("/list/manga")}
            onClick={() => setDrawerOpen(false)}
          >
            <ListItemIcon>
              <MenuBookIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Manga List" />
          </ListItemButton>

          <Divider sx={{ my: 1 }} />

          <ListItemButton
            component={Link}
            href="/collection/anime"
            prefetch={false}
            selected={isActive("/collection/anime")}
            onClick={() => setDrawerOpen(false)}
          >
            <ListItemIcon>
              <VideoLibraryIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Anime Collection" />
          </ListItemButton>

          <ListItemButton
            component={Link}
            href="/collection/manga"
            prefetch={false}
            selected={isActive("/collection/manga")}
            onClick={() => setDrawerOpen(false)}
          >
            <ListItemIcon>
              <CollectionsBookmarkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Manga Collection" />
          </ListItemButton>

          <Divider sx={{ my: 1 }} />

          <ListItemButton
            component={Link}
            href="/me"
            prefetch={false}
            selected={isActive("/me")}
            onClick={() => setDrawerOpen(false)}
          >
            <ListItemIcon>
              <PersonIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="About" />
          </ListItemButton>

          {session && (
            <ListItemButton
              component={Link}
              href="/sync"
              prefetch={false}
              selected={isActive("/sync")}
              onClick={() => setDrawerOpen(false)}
            >
              <ListItemIcon>
                <SyncIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Sync" />
            </ListItemButton>
          )}

          {session && (
            <ListItemButton
              component={Link}
              href="/link"
              prefetch={false}
              selected={isActive("/link")}
              onClick={() => setDrawerOpen(false)}
            >
              <ListItemIcon>
                <AccountCircleIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Accounts" />
            </ListItemButton>
          )}

          <Divider sx={{ my: 1 }} />

          {session ? (
            <ListItemButton
              onClick={async () => {
                setDrawerOpen(false);
                await logoutAppAction();
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Log out" />
            </ListItemButton>
          ) : (
            <ListItemButton
              component={Link}
              href="/login"
              prefetch={false}
              onClick={() => setDrawerOpen(false)}
            >
              <ListItemIcon>
                <AccountCircleIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Log in" />
            </ListItemButton>
          )}
        </List>
      </Drawer>
    </>
  );
}
