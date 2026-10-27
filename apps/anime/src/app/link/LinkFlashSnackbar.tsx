"use client";

import { enqueueSnackbar } from "notistack";
import { useEffect } from "react";

const MESSAGES: Record<string, string> = {
  anilist: "AniList account linked successfully.",
};

const SEEN_KEY = "link_success_seen";

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const pairs = document.cookie.split(";");

  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return null;
}

export default function LinkFlashSnackbar() {
  useEffect(() => {
    const success = readCookie("link_success");
    if (!success) return;

    const seen = sessionStorage.getItem(SEEN_KEY);
    if (seen === success) return;

    sessionStorage.setItem(SEEN_KEY, success);

    const message = MESSAGES[success.toLowerCase()];
    if (!message) return;

    enqueueSnackbar(message, { variant: "success" });
  }, []);

  return null;
}
