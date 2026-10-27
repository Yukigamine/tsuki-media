"use client";

import AddIcon from "@mui/icons-material/Add";
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  IconButton,
  Tooltip,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AnimeListEntryEditModal from "@/components/AnimeListEntryEditModal";
import DialogContainer from "@/components/DialogContainer";
import { ItemLookupField } from "@/components/ItemLookupField";
import MangaListEntryEditModal from "@/components/MangaListEntryEditModal";
import { resolveAnimeId, resolveMangaId } from "@/lib/actions/collection";
import type { KitsuSearchResult } from "@/lib/actions/collection/types";
import {
  getAnimeResolvePayloadBySlug,
  getMangaResolvePayloadBySlug,
} from "@/lib/kitsu/client-queries";

type Props = {
  type: "anime" | "manga";
  existingKitsuIds: string[];
  iconOnly?: boolean;
};

export default function ListAddButton({
  type,
  existingKitsuIds,
  iconOnly = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<KitsuSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{
    id: string;
    title: string;
    episodeCount: number | null;
    chapterCount: number | null;
    volumeCount: number | null;
  } | null>(null);

  function handleClose() {
    if (resolving) return;
    setOpen(false);
    setSelected(null);
    setError(null);
  }

  async function handleSelect(value: KitsuSearchResult | null) {
    setSelected(value);
    setResolved(null);
    setError(null);
    if (!value) return;

    if (existingKitsuIds.includes(value.kitsuId)) {
      setError("That title is already on your list.");
      return;
    }

    setResolving(true);
    try {
      if (type === "anime") {
        const payload = await getAnimeResolvePayloadBySlug(value.kitsuId);
        if (!payload) {
          setError("Anime not found on Kitsu.");
          return;
        }
        const result = await resolveAnimeId(payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResolved({
          id: result.data,
          title:
            value.titleTranslated ??
            payload.titleEn ??
            payload.titleRomaji ??
            payload.titleJp ??
            value.titleEn ??
            value.titleRomaji ??
            value.titleJp ??
            "Unknown",
          episodeCount: payload.episodeCount ?? null,
          chapterCount: null,
          volumeCount: null,
        });
      } else {
        const payload = await getMangaResolvePayloadBySlug(value.kitsuId);
        if (!payload) {
          setError("Manga not found on Kitsu.");
          return;
        }
        const result = await resolveMangaId(payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResolved({
          id: result.data,
          title:
            value.titleTranslated ??
            payload.titleEn ??
            payload.titleRomaji ??
            payload.titleJp ??
            value.titleEn ??
            value.titleRomaji ??
            value.titleJp ??
            "Unknown",
          episodeCount: null,
          chapterCount: payload.chapterCount ?? null,
          volumeCount: payload.volumeCount ?? null,
        });
      }
    } catch {
      setError("Failed to load the selected title.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <>
      {iconOnly ? (
        <Tooltip title={`Add ${type} to list`}>
          <IconButton
            aria-label={`Add ${type} to list`}
            onClick={() => setOpen(true)}
            sx={{
              width: 40,
              height: 40,
              borderRadius: "10px",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              "&:hover": { bgcolor: "primary.dark" },
            }}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setOpen(true)}
          aria-label={`Add ${type} to list`}
          sx={{ width: "fit-content", whiteSpace: "nowrap" }}
        >
          Add
        </Button>
      )}

      <DialogContainer
        open={open && resolved === null}
        onClose={handleClose}
        disableClose={resolving}
        title={`Add ${type} to list`}
        fullWidth
        maxWidth="sm"
      >
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <ItemLookupField
            type={type}
            onSelect={handleSelect}
            disabled={resolving}
            initialValue={selected}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={handleClose} disabled={resolving}>
            Cancel
          </Button>
          {resolving && <CircularProgress size={24} />}
        </DialogActions>
      </DialogContainer>

      {resolved && type === "anime" && (
        <AnimeListEntryEditModal
          open
          onClose={() => {
            setResolved(null);
            setOpen(false);
          }}
          animeId={resolved.id}
          title={resolved.title}
          episodeCount={resolved.episodeCount}
          entry={null}
          onSaved={() => router.refresh()}
        />
      )}

      {resolved && type === "manga" && (
        <MangaListEntryEditModal
          open
          onClose={() => {
            setResolved(null);
            setOpen(false);
          }}
          mangaId={resolved.id}
          title={resolved.title}
          chapterCount={resolved.chapterCount}
          volumeCount={resolved.volumeCount}
          entry={null}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
