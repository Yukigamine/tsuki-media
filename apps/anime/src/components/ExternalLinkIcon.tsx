import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import MusicNoteRoundedIcon from "@mui/icons-material/MusicNoteRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import RedditIcon from "@mui/icons-material/Reddit";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import SportsEsportsRoundedIcon from "@mui/icons-material/SportsEsportsRounded";
import TwitterIcon from "@mui/icons-material/Twitter";
import { Box } from "@mui/material";
import {
  resolveExternalLinkIcon,
  SocialIconKey,
} from "@/lib/enums/detail-page";

type Props = {
  site: string;
  url: string;
};

export default function ExternalLinkIcon({ site, url }: Props) {
  const iconKey = resolveExternalLinkIcon(site, url);

  switch (iconKey) {
    case SocialIconKey.YOUTUBE:
      return <SmartDisplayRoundedIcon fontSize="small" />;
    case SocialIconKey.TWITTER_X:
      return <TwitterIcon fontSize="small" sx={{ color: "#1DA1F2" }} />;
    case SocialIconKey.INSTAGRAM:
      return <InstagramIcon fontSize="small" />;
    case SocialIconKey.FACEBOOK:
      return <FacebookIcon fontSize="small" />;
    case SocialIconKey.REDDIT:
      return <RedditIcon fontSize="small" />;
    case SocialIconKey.TWITCH:
      return <SportsEsportsRoundedIcon fontSize="small" />;
    case SocialIconKey.TIKTOK:
      return <MusicNoteRoundedIcon fontSize="small" />;
    case SocialIconKey.CRUNCHYROLL:
      return (
        <Box
          component="img"
          src="/crunchyroll.svg"
          alt=""
          aria-hidden
          sx={{ width: 22, height: 22, display: "block" }}
        />
      );
    case SocialIconKey.HULU:
      return (
        <Box
          component="img"
          src="/hulu.svg"
          alt=""
          aria-hidden
          sx={{ width: 22, height: 22, display: "block" }}
        />
      );
    case SocialIconKey.NETFLIX:
      return (
        <Box
          component="img"
          src="/netflix.svg"
          alt=""
          aria-hidden
          sx={{ width: 22, height: 22, display: "block" }}
        />
      );
    case SocialIconKey.WEBSITE:
      return <LanguageRoundedIcon fontSize="small" />;
    default:
      return <PublicRoundedIcon fontSize="small" />;
  }
}
