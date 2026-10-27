"use client";

import DeleteIcon from "@mui/icons-material/Delete";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { enqueueSnackbar } from "notistack";
import { useEffect, useState, useTransition } from "react";
import type { MangaListEntry, ReadStatus } from "@/generated/prisma/client";
import { removeMangaListEntry, upsertMangaListEntry } from "@/lib/actions/list";
import ConfirmButton from "./ConfirmButton";
import DialogContainer from "./DialogContainer";

const STATUS_OPTIONS: Array<{ value: ReadStatus; label: string }> = [
  { value: "PLAN_TO_READ", label: "Want to Read" },
  { value: "READING", label: "Reading" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  mangaId: string;
  title: string;
  chapterCount: number | null;
  volumeCount: number | null;
  entry: MangaListEntry | null;
  onSaved?: (patch: {
    readStatus: ReadStatus;
    progress: number;
    progressVolumes: number;
    rating: number | null;
    notes: string | null;
    rereadCount: number;
    rereading: boolean;
  }) => void;
  onRemoved?: () => void;
};

export default function MangaListEntryEditModal({
  open,
  onClose,
  mangaId,
  title,
  chapterCount,
  volumeCount,
  entry,
  onSaved,
  onRemoved,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [readStatus, setReadStatus] = useState<ReadStatus>(
    entry?.readStatus ?? "PLAN_TO_READ",
  );
  const [progress, setProgress] = useState<number>(entry?.progress ?? 0);
  const [progressVolumes, setProgressVolumes] = useState<number>(
    entry?.progressVolumes ?? 0,
  );
  const [rating, setRating] = useState<number>(
    entry?.rating != null ? entry.rating / 2 : 0,
  );
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [rereadCount, setRereadCount] = useState(entry?.rereadCount ?? 0);
  const [rereading, setRereading] = useState(entry?.rereading ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setReadStatus(entry?.readStatus ?? "PLAN_TO_READ");
    setProgress(entry?.progress ?? 0);
    setProgressVolumes(entry?.progressVolumes ?? 0);
    setRating(entry?.rating != null ? entry.rating / 2 : 0);
    setNotes(entry?.notes ?? "");
    setRereadCount(entry?.rereadCount ?? 0);
    setRereading(entry?.rereading ?? false);
  }, [entry, open]);

  const canDelete = entry != null;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await upsertMangaListEntry({
        mangaId,
        readStatus,
        progress,
        progressVolumes,
        rating: rating > 0 ? rating * 2 : null,
        notes: notes.trim() || null,
        rereadCount,
        rereading,
      });

      if (!result.ok) {
        setError(result.error);
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }

      onSaved?.({
        readStatus,
        progress,
        progressVolumes,
        rating: rating > 0 ? rating * 2 : null,
        notes: notes.trim() || null,
        rereadCount,
        rereading,
      });

      enqueueSnackbar("List entry saved.", { variant: "success" });
      onClose();
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!canDelete) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMangaListEntry(mangaId);
      if (!result.ok) {
        setError(result.error);
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }

      onRemoved?.();
      enqueueSnackbar("Removed from list.", { variant: "success" });
      onClose();
      router.refresh();
    });
  };

  return (
    <DialogContainer
      open={open}
      onClose={onClose}
      disableClose={isPending}
      title={`Edit ${title}`}
      fullWidth
      maxWidth="sm"
    >
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl fullWidth>
            <InputLabel>Status</InputLabel>
            <Select
              value={readStatus}
              label="Status"
              onChange={(event) =>
                setReadStatus(event.target.value as ReadStatus)
              }
              disabled={isPending}
            >
              {STATUS_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            type="number"
            label={
              chapterCount != null
                ? `Chapter Progress (max ${chapterCount})`
                : "Chapter Progress"
            }
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value) || 0)}
            slotProps={{
              htmlInput: { min: 0, max: chapterCount ?? undefined },
            }}
            disabled={isPending}
          />

          <TextField
            type="number"
            label={
              volumeCount != null
                ? `Volume Progress (max ${volumeCount})`
                : "Volume Progress"
            }
            value={progressVolumes}
            onChange={(event) =>
              setProgressVolumes(Number(event.target.value) || 0)
            }
            slotProps={{
              htmlInput: { min: 0, max: volumeCount ?? undefined },
            }}
            disabled={isPending}
          />

          <Stack spacing={0.5}>
            <Typography variant="body2">
              Rating: {rating > 0 ? `${rating}/10` : "Not rated"}
            </Typography>
            <Slider
              value={rating}
              min={0}
              max={10}
              step={0.5}
              marks
              valueLabelDisplay="auto"
              onChange={(_, value) => setRating(value as number)}
              disabled={isPending}
              aria-label="Rating"
            />
          </Stack>

          <TextField
            label="Notes"
            multiline
            minRows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={isPending}
          />

          <TextField
            type="number"
            label="Reread Count"
            value={rereadCount}
            onChange={(event) =>
              setRereadCount(Number(event.target.value) || 0)
            }
            slotProps={{ htmlInput: { min: 0 } }}
            disabled={isPending}
          />

          <FormControl fullWidth>
            <InputLabel>Rereading</InputLabel>
            <Select
              value={rereading ? "yes" : "no"}
              label="Rereading"
              onChange={(event) => setRereading(event.target.value === "yes")}
              disabled={isPending}
            >
              <MenuItem value="no">No</MenuItem>
              <MenuItem value="yes">Yes</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          pb: 2.5,
          flexDirection: { xs: "column-reverse", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          gap: 1,
        }}
      >
        <Button onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={isPending}>
          Save
        </Button>
        {canDelete && (
          <ConfirmButton
            title="Remove from list"
            icon={<DeleteIcon />}
            defaultColor="error"
            confirmColor="error"
            disabled={isPending}
            loading={isPending}
            onConfirm={handleDelete}
          />
        )}
      </DialogActions>
    </DialogContainer>
  );
}
