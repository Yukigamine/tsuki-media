"use client";

import {
  Box,
  Container,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import Image from "next/image";
import { enqueueSnackbar } from "notistack";
import { useEffect } from "react";
import Link from "@/components/Link";
import ProfileSkeleton from "@/components/ProfileSkeleton";
import UserFavorites from "@/components/UserFavorites";
import { useKitsuProfile } from "@/lib/hooks/useKitsuProfile";
import {
  ageFromBirthday,
  formatProfileDate,
  formatWatchTime,
} from "@/lib/kitsu/user-types";
import type { ProfileSummary } from "@/lib/profile-summary";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell
        sx={{
          fontWeight: 600,
          color: "text.secondary",
          whiteSpace: "nowrap",
          width: 110,
          borderBottom: "none",
          py: 0.75,
          pl: 0,
        }}
      >
        {label}
      </TableCell>
      <TableCell
        sx={{
          borderBottom: "none",
          py: 0.75,
          pr: 0,
          textAlign: "right",
        }}
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

export default function UserProfileContent({
  username,
  linkedAccounts,
  profileSummary,
}: {
  username: string;
  linkedAccounts?: { kitsu: string | null; anilist: string | null };
  profileSummary?: ProfileSummary;
}) {
  const { data: profile, error, isLoading } = useKitsuProfile(username);

  useEffect(() => {
    if (error) {
      enqueueSnackbar(`Failed to load profile: ${error.message}`, {
        variant: "error",
      });
    }
  }, [error]);

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Unable to load profile
        </Typography>
        <Typography color="text.secondary">
          We could not load this Kitsu profile right now.
        </Typography>
      </Container>
    );
  }

  if (!profile) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Profile not found
        </Typography>
        <Typography color="text.secondary">
          The requested Kitsu user could not be found.
        </Typography>
      </Container>
    );
  }

  const birthdayFormatted = profile.birthday
    ? `${formatProfileDate(profile.birthday)} (age ${ageFromBirthday(profile.birthday)})`
    : null;
  const mangaOwnedParts = profileSummary
    ? [
        profileSummary.mangaVolumesOwned > 0
          ? `${profileSummary.mangaVolumesOwned.toLocaleString()} volumes`
          : null,
        profileSummary.mangaChaptersOwned > 0
          ? `${profileSummary.mangaChaptersOwned.toLocaleString()} chapters`
          : null,
      ].filter((part): part is string => part !== null)
    : [];

  const hasStats =
    profile.stats.animeCompleted != null ||
    profile.stats.mangaCompleted != null;
  const hasFavorites = Object.values(profile.favorites).some(
    (arr) => arr.length > 0,
  );

  return (
    <Box>
      {profile.bannerUrl && (
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: { xs: 120, md: 200 },
            bgcolor: "action.hover",
            overflow: "hidden",
          }}
        >
          <Image
            src={profile.bannerUrl}
            alt="Profile banner"
            fill
            style={{ objectFit: "cover" }}
            priority
            loading="eager"
          />
        </Box>
      )}

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 4,
            alignItems: "flex-start",
          }}
        >
          <Box sx={{ flexShrink: 0, width: { xs: "100%", md: 340 } }}>
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  gap: 2,
                  alignItems: "flex-start",
                  mb: profile.about ? 2 : 0,
                }}
              >
                {profile.avatarUrl && (
                  <Box
                    sx={{
                      position: "relative",
                      width: 80,
                      height: 80,
                      borderRadius: 2,
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    <Image
                      src={profile.avatarUrl}
                      alt={profile.name}
                      fill
                      sizes="80px"
                      style={{ objectFit: "cover" }}
                      unoptimized
                    />
                  </Box>
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 700, lineHeight: 1.2 }}
                  >
                    {profile.name}
                  </Typography>
                  <Box
                    sx={{ display: "flex", flexDirection: "column", mt: 0.75 }}
                  >
                    {linkedAccounts?.kitsu && (
                      <Link
                        href={`https://kitsu.app/users/${encodeURIComponent(linkedAccounts.kitsu)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        underline="hover"
                        variant="caption"
                        color="text.secondary"
                      >
                        Kitsu: @{linkedAccounts.kitsu}
                      </Link>
                    )}
                    {linkedAccounts?.anilist && (
                      <Link
                        href={`https://anilist.co/user/${encodeURIComponent(linkedAccounts.anilist)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        underline="hover"
                        variant="caption"
                        color="text.secondary"
                      >
                        AniList: @{linkedAccounts.anilist}
                      </Link>
                    )}
                  </Box>
                </Box>
              </Box>
              {profile.about && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ whiteSpace: "pre-wrap" }}
                >
                  {profile.about}
                </Typography>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableBody>
                  {birthdayFormatted && (
                    <DetailRow label="Birthday">{birthdayFormatted}</DetailRow>
                  )}
                  {profile.gender && (
                    <DetailRow label="Gender">{profile.gender}</DetailRow>
                  )}
                  {profile.location && (
                    <DetailRow label="Location">{profile.location}</DetailRow>
                  )}
                  {profileSummary && (
                    <>
                      {profileSummary.animeOwned > 0 && (
                        <DetailRow label="Anime Owned">
                          {profileSummary.animeOwned.toLocaleString()}
                        </DetailRow>
                      )}
                      {mangaOwnedParts.length > 0 && (
                        <DetailRow label="Manga Owned">
                          {mangaOwnedParts.join(" · ")}
                        </DetailRow>
                      )}
                    </>
                  )}
                  {profile.waifu && (
                    <DetailRow label={profile.waifu.label}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 1,
                        }}
                      >
                        {profile.waifu.imageUrl && (
                          <Box
                            sx={{
                              position: "relative",
                              width: 36,
                              height: 36,
                              borderRadius: 1,
                              overflow: "hidden",
                              flexShrink: 0,
                            }}
                          >
                            <Image
                              src={profile.waifu.imageUrl}
                              alt={profile.waifu.name}
                              fill
                              sizes="36px"
                              style={{ objectFit: "cover" }}
                              unoptimized
                            />
                          </Box>
                        )}
                        <Link
                          href={`https://kitsu.app/characters/${profile.waifu.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                          variant="body2"
                        >
                          {profile.waifu.name}
                        </Link>
                      </Box>
                    </DetailRow>
                  )}
                  {profileSummary?.favoriteGenres.length ? (
                    <DetailRow label="Favorite Genres">
                      {profileSummary.favoriteGenres.join(", ")}
                    </DetailRow>
                  ) : null}
                </TableBody>
              </Table>
            </Paper>

            {hasStats && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  User Stats
                </Typography>
                <Table
                  size="small"
                  sx={{ tableLayout: "fixed", width: "100%" }}
                >
                  <TableBody>
                    {profile.stats.animeTimeSecs != null && (
                      <DetailRow label="Time watching">
                        {formatWatchTime(profile.stats.animeTimeSecs)}
                      </DetailRow>
                    )}
                    {profile.stats.animeCompleted != null && (
                      <DetailRow label="Anime Completed">
                        {profile.stats.animeCompleted.toLocaleString()}
                      </DetailRow>
                    )}
                    {profile.stats.animeEpisodes != null && (
                      <DetailRow label="Episodes watched">
                        {profile.stats.animeEpisodes.toLocaleString()}
                      </DetailRow>
                    )}
                    {profile.stats.mangaCompleted != null && (
                      <DetailRow label="Manga Completed">
                        {profile.stats.mangaCompleted.toLocaleString()}
                      </DetailRow>
                    )}
                    {profile.stats.mangaChapters != null && (
                      <DetailRow label="Chapters read">
                        {profile.stats.mangaChapters.toLocaleString()}
                      </DetailRow>
                    )}
                  </TableBody>
                </Table>
              </Paper>
            )}
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              width: { xs: "100%", md: "auto" },
            }}
          >
            {hasFavorites ? (
              <>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
                  Favorites
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <UserFavorites favorites={profile.favorites} />
              </>
            ) : (
              <Typography variant="body1" color="text.secondary">
                No favorites listed.
              </Typography>
            )}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
