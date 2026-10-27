"use client";

import DeleteIcon from "@mui/icons-material/Delete";
import {
  Alert,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
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
import type { AnimeListEntry, WatchStatus } from "@/generated/prisma/client";
import { removeAnimeListEntry, upsertAnimeListEntry } from "@/lib/actions/list";
import ConfirmButton from "./ConfirmButton";
import DialogContainer from "./DialogContainer";

const STATUS_OPTIONS: Array<{ value: WatchStatus; label: string }> = [
  { value: "PLAN_TO_WATCH", label: "Plan to Watch" },
  { value: "WATCHING", label: "Watching" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "DROPPED", label: "Dropped" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  animeId: string;
  title: string;
  episodeCount: number | null;
  entry: AnimeListEntry | null;
  onSaved?: (patch: {
    watchStatus: WatchStatus;
    progress: number;
    rating: number | null;
    notes: string | null;
    rewatchCount: number;
    rewatching: boolean;
  }) => void;
  onRemoved?: () => void;
};

export default function AnimeListEntryEditModal({
  open,
  onClose,
  animeId,
  title,
  episodeCount,
  entry,
  onSaved,
  onRemoved,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [watchStatus, setWatchStatus] = useState<WatchStatus>(
    entry?.watchStatus ?? "PLAN_TO_WATCH",
  );
  const [progress, setProgress] = useState<number>(entry?.progress ?? 0);
  const [rating, setRating] = useState<number>(
    entry?.rating != null ? entry.rating / 2 : 0,
  );
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [rewatchCount, setRewatchCount] = useState(entry?.rewatchCount ?? 0);
  const [rewatching, setRewatching] = useState(entry?.rewatching ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setWatchStatus(entry?.watchStatus ?? "PLAN_TO_WATCH");
    setProgress(entry?.progress ?? 0);
    setRating(entry?.rating != null ? entry.rating / 2 : 0);
    setNotes(entry?.notes ?? "");
    setRewatchCount(entry?.rewatchCount ?? 0);
    setRewatching(entry?.rewatching ?? false);
  }, [entry, open]);

  const canDelete = entry != null;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await upsertAnimeListEntry({
        animeId,
        watchStatus,
        progress,
        rating: rating > 0 ? rating * 2 : null,
        notes: notes.trim() || null,
        rewatchCount,
        rewatching,
      });

      if (!result.ok) {
        setError(result.error);
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }

      onSaved?.({
        watchStatus,
        progress,
        rating: rating > 0 ? rating * 2 : null,
        notes: notes.trim() || null,
        rewatchCount,
        rewatching,
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
      const result = await removeAnimeListEntry(animeId);
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
              value={watchStatus}
              label="Status"
              onChange={(event) =>
                setWatchStatus(event.target.value as WatchStatus)
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
              episodeCount != null
                ? `Progress (max ${episodeCount})`
                : "Progress"
            }
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value) || 0)}
            slotProps={{
              htmlInput: { min: 0, max: episodeCount ?? undefined },
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

          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <TextField
              type="number"
              label="Rewatch Count"
              value={rewatchCount}
              onChange={(event) =>
                setRewatchCount(Number(event.target.value) || 0)
              }
              slotProps={{ htmlInput: { min: 0 } }}
              disabled={isPending}
              sx={{ flex: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={rewatching}
                  onChange={(event) => setRewatching(event.target.checked)}
                  disabled={isPending}
                />
              }
              label="Rewatching"
            />
          </Stack>
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
