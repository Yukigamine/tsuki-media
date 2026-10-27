"use client";

import DeleteIcon from "@mui/icons-material/Delete";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Tooltip,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteAnimeCollectionItem,
  deleteMangaCollectionItem,
} from "@/lib/actions/collection";

type Props = {
  id: string;
  type: "anime" | "manga";
  title: string;
  disabled?: boolean;
};

export function CollectionDeleteButton({
  id,
  type,
  title,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const result =
        type === "anime"
          ? await deleteAnimeCollectionItem(id)
          : await deleteMangaCollectionItem(id);

      if (!result.ok) {
        setError(result.error);
        setDeleting(false);
        return;
      }

      await router.push(`/collection/${type}`);
    } catch {
      setError("An unexpected error occurred.");
      setDeleting(false);
    }
  }

  return (
    <>
      <Tooltip title={`Delete ${title}`}>
        <span>
          <IconButton
            color="error"
            onClick={() => setOpen(true)}
            disabled={disabled}
            aria-label={`Delete ${title}`}
          >
            <DeleteIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => !deleting && setOpen(false)}
        aria-labelledby="delete-dialog-title"
      >
        <DialogTitle id="delete-dialog-title">
          Remove from collection?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove <strong>{title}</strong> from your collection? This cannot be
            undone.
          </DialogContentText>
          {error && (
            <DialogContentText color="error" sx={{ mt: 1 }}>
              {error}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            onClick={handleDelete}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : undefined}
          >
            {deleting ? "Removing…" : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
