"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CollectionDeleteButton } from "@/components/CollectionDeleteButton";
import { ItemLookupField } from "@/components/ItemLookupField";
import type {
  CollectionCondition,
  MangaLanguage,
} from "@/generated/prisma/enums";
import {
  addMangaCollectionItem,
  editMangaCollectionItem,
  resolveMangaId,
} from "@/lib/actions/collection";
import type {
  ActionResult,
  KitsuSearchResult,
  MangaCollectionItemInput,
} from "@/lib/actions/collection/types";
import {
  getMangaResolvePayloadBySlug,
  getMangaSeriesDetailBySlug,
  type KitsuMangaSeriesDetail,
} from "@/lib/kitsu/client-queries";

type ExistingItem = {
  id: string;
  mangaId: string;
  kitsuId: string | null;
  titleEn: string | null;
  condition: CollectionCondition;
  language: MangaLanguage;
  notes: string | null;
  containsSerialized: boolean;
  containsOmnibus: boolean;
  volumes: number[];
  chapters: number[];
};

type Props = {
  /** Present on edit; absent on add */
  initialData?: ExistingItem;
  /** Kitsu series detail for volume/chapter totals (may be null) */
  seriesDetail?: KitsuMangaSeriesDetail | null;
};

const CONDITION_OPTIONS: { value: CollectionCondition; label: string }[] = [
  { value: "MINT", label: "Mint" },
  { value: "NEAR_MINT", label: "Near Mint" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "POOR", label: "Poor" },
];

const LANGUAGE_OPTIONS: { value: MangaLanguage; label: string }[] = [
  { value: "ENGLISH", label: "English" },
  { value: "JAPANESE", label: "Japanese" },
  { value: "OTHER", label: "Other" },
];

function NumberMultiSelect({
  label,
  max,
  selected,
  onChange,
  locked,
  legacyOutOfRange,
}: {
  label: string;
  max: number | null;
  selected: number[];
  onChange: (next: number[]) => void;
  locked: boolean;
  /** Values that are out-of-range but still shown on edit */
  legacyOutOfRange: number[];
}) {
  const effective = max ?? 50; // fallback grid size when unknown

  function toggle(n: number) {
    if (selected.includes(n)) {
      onChange(selected.filter((v) => v !== n));
    } else {
      onChange([...selected, n].sort((a, b) => a - b));
    }
  }

  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
        {label}
        {locked && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            sx={{ ml: 1 }}
          >
            ({effective} from Kitsu)
          </Typography>
        )}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        <Chip
          label="All"
          size="small"
          onClick={() => {
            if (selected.length === effective) {
              onChange([]);
            } else {
              onChange(Array.from({ length: effective }, (_, i) => i + 1));
            }
          }}
          color={selected.length === effective ? "primary" : "default"}
          variant={selected.length === effective ? "filled" : "outlined"}
          sx={{
            cursor: "pointer",
            fontWeight: selected.length === effective ? 700 : 400,
          }}
        />
        {Array.from({ length: effective }, (_, i) => i + 1).map((n) => (
          <Chip
            key={n}
            label={n}
            size="small"
            onClick={() => toggle(n)}
            color={selected.includes(n) ? "primary" : "default"}
            variant={selected.includes(n) ? "filled" : "outlined"}
            sx={{
              cursor: "pointer",
              fontWeight: selected.includes(n) ? 700 : 400,
            }}
          />
        ))}
        {/* Legacy out-of-range values shown but not interactive until pruned on save */}
        {legacyOutOfRange.map((n) => (
          <Chip
            key={`legacy-${n}`}
            label={`${n}*`}
            size="small"
            color="warning"
            variant="outlined"
            title="Out of current range — will be removed on save"
          />
        ))}
      </Box>
      {legacyOutOfRange.length > 0 && (
        <FormHelperText>
          * Out-of-range values will be removed on save
        </FormHelperText>
      )}
      {selected.length === 0 && (
        <FormHelperText sx={{ color: "warning.main" }}>
          No {label.toLowerCase()} selected
        </FormHelperText>
      )}
    </Box>
  );
}

export function MangaCollectionItemForm({
  initialData,
  seriesDetail: initialSeriesDetail,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(initialData);

  const [selectedManga, setSelectedManga] = useState<KitsuSearchResult | null>(
    initialData?.kitsuId
      ? {
          kitsuId: initialData.kitsuId,
          rawId: "",
          titleTranslated: initialData.titleEn ?? initialData.kitsuId,
          titleEn: initialData.titleEn ?? initialData.kitsuId,
          titleRomaji: null,
          titleJp: null,
          posterUrl: null,
        }
      : null,
  );

  const [fetchedSeriesDetail, setFetchedSeriesDetail] = useState<
    typeof initialSeriesDetail | null
  >(initialSeriesDetail ?? null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!initialData?.kitsuId) return;
      const detail = await getMangaSeriesDetailBySlug(initialData.kitsuId);
      if (!active) return;
      setFetchedSeriesDetail(detail);
      if (detail && detail.totalVolumes !== null) {
        setCustomTotalVolumes(String(detail.totalVolumes));
      }
      if (detail && detail.totalChapters !== null) {
        setCustomTotalChapters(String(detail.totalChapters));
      }
    }

    if (isEdit && initialData?.kitsuId) {
      void load();
    }

    return () => {
      active = false;
    };
  }, [initialData?.kitsuId, isEdit]);

  // Use fetched detail when available, otherwise fall back to initial
  const seriesDetail = fetchedSeriesDetail || initialSeriesDetail;

  const handleTitleSelect = async (manga: KitsuSearchResult | null) => {
    setSelectedManga(manga);
    // Fetch series detail when a new title is selected (add mode)
    if (!isEdit && manga) {
      const detail = await getMangaSeriesDetailBySlug(manga.kitsuId);
      setFetchedSeriesDetail(detail);
      if (detail && detail.totalVolumes !== null) {
        setCustomTotalVolumes(String(detail.totalVolumes));
      }
      if (detail && detail.totalChapters !== null) {
        setCustomTotalChapters(String(detail.totalChapters));
      }
    }
  };

  const [condition, setCondition] = useState<CollectionCondition>(
    initialData?.condition ?? "GOOD",
  );
  const [language, setLanguage] = useState<MangaLanguage>(
    initialData?.language ?? "ENGLISH",
  );
  const [notes, setNotes] = useState(initialData?.notes ?? "");

  const [containsSerialized, setContainsSerialized] = useState(
    initialData?.containsSerialized ?? false,
  );
  const [containsOmnibus, setContainsOmnibus] = useState(
    initialData?.containsOmnibus ?? false,
  );
  const [selectedVolumes, setSelectedVolumes] = useState<number[]>(
    initialData?.volumes ?? [],
  );
  const [selectedChapters, setSelectedChapters] = useState<number[]>(
    initialData?.chapters ?? [],
  );

  // Override totals from Kitsu or user-supplied fallback
  const [customTotalVolumes, setCustomTotalVolumes] = useState<string>(
    seriesDetail?.totalVolumes != null ? String(seriesDetail.totalVolumes) : "",
  );
  const [customTotalChapters, setCustomTotalChapters] = useState<string>(
    seriesDetail?.totalChapters != null
      ? String(seriesDetail.totalChapters)
      : "",
  );

  const volumesLocked =
    seriesDetail?.totalsFromKitsu && seriesDetail.totalVolumes !== null;
  const chaptersLocked =
    seriesDetail?.totalsFromKitsu && seriesDetail.totalChapters !== null;

  const effectiveTotalVolumes = volumesLocked
    ? seriesDetail?.totalVolumes
    : customTotalVolumes
      ? Number(customTotalVolumes)
      : null;
  const effectiveTotalChapters = chaptersLocked
    ? seriesDetail?.totalChapters
    : customTotalChapters
      ? Number(customTotalChapters)
      : null;

  // Legacy out-of-range (only relevant on edit)
  const legacyOutOfRangeVolumes = isEdit
    ? selectedVolumes.filter(
        (v) => effectiveTotalVolumes !== null && v > effectiveTotalVolumes,
      )
    : [];
  const legacyOutOfRangeChapters = isEdit
    ? selectedChapters.filter(
        (c) => effectiveTotalChapters !== null && c > effectiveTotalChapters,
      )
    : [];

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isEdit || selectedManga !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      let mangaId: string;

      if (isEdit && initialData) {
        mangaId = initialData.mangaId;
      } else {
        if (!selectedManga) {
          setError("Please select a manga title.");
          setSubmitting(false);
          return;
        }
        const payload = await getMangaResolvePayloadBySlug(
          selectedManga.kitsuId,
        );
        if (!payload) {
          setError("Manga not found on Kitsu.");
          setSubmitting(false);
          return;
        }

        const resolved = await resolveMangaId(payload);
        if (!resolved.ok) {
          setError(resolved.error);
          setSubmitting(false);
          return;
        }
        mangaId = resolved.data;
      }

      const input: MangaCollectionItemInput = {
        mangaId,
        condition,
        language,
        notes: notes || undefined,
        containsSerialized,
        containsOmnibus,
        volumes: selectedVolumes,
        chapters: selectedChapters,
      };

      let result: ActionResult | ActionResult<{ id: string }>;
      if (isEdit && initialData) {
        result = await editMangaCollectionItem(
          initialData.id,
          input,
          effectiveTotalVolumes,
          effectiveTotalChapters,
        );
      } else {
        result = await addMangaCollectionItem(input);
      }

      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      await router.push("/collection/manga");
    } catch (err) {
      console.error("[mangaForm] submit error:", err);
      setError("An unexpected error occurred");
      setSubmitting(false);
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={3}>
        {error && <Alert severity="error">{error}</Alert>}

        <ItemLookupField
          type="manga"
          onSelect={handleTitleSelect}
          disabled={isEdit}
          initialValue={selectedManga}
        />

        <FormControl fullWidth>
          <InputLabel>Condition</InputLabel>
          <Select
            value={condition}
            label="Condition"
            onChange={(e) =>
              setCondition(e.target.value as CollectionCondition)
            }
          >
            {CONDITION_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth>
          <InputLabel>Language</InputLabel>
          <Select
            value={language}
            label="Language"
            onChange={(e) => setLanguage(e.target.value as MangaLanguage)}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormGroup row>
          <FormControlLabel
            control={
              <Checkbox
                checked={containsSerialized}
                onChange={(e) => setContainsSerialized(e.target.checked)}
              />
            }
            label="Contains serialized issues"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={containsOmnibus}
                onChange={(e) => setContainsOmnibus(e.target.checked)}
              />
            }
            label="Omnibus edition"
          />
        </FormGroup>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Total volumes override — shown when not locked by Kitsu */}
          {!volumesLocked && (
            <TextField
              label="Total volumes (optional)"
              type="number"
              value={customTotalVolumes}
              onChange={(e) => setCustomTotalVolumes(e.target.value)}
              helperText="Sets the volume grid size. Leave blank to use a default of 50."
              slotProps={{ htmlInput: { min: 1, max: 9999 } }}
            />
          )}

          {effectiveTotalVolumes !== null && (
            <NumberMultiSelect
              label="Volumes owned"
              max={effectiveTotalVolumes}
              selected={selectedVolumes.filter(
                (v) =>
                  effectiveTotalVolumes === null || v <= effectiveTotalVolumes,
              )}
              onChange={setSelectedVolumes}
              locked={Boolean(volumesLocked)}
              legacyOutOfRange={legacyOutOfRangeVolumes}
            />
          )}

          {/* Total chapters override */}
          {containsSerialized && !chaptersLocked && (
            <TextField
              label="Total chapters (optional)"
              type="number"
              value={customTotalChapters}
              onChange={(e) => setCustomTotalChapters(e.target.value)}
              helperText="Sets the chapter grid size. Leave blank to use a default of 50."
              slotProps={{ htmlInput: { min: 1, max: 9999 } }}
            />
          )}

          {containsSerialized && effectiveTotalChapters !== null && (
            <NumberMultiSelect
              label="Chapters owned"
              max={effectiveTotalChapters}
              selected={selectedChapters.filter(
                (c) =>
                  effectiveTotalChapters === null ||
                  c <= effectiveTotalChapters,
              )}
              onChange={setSelectedChapters}
              locked={Boolean(chaptersLocked)}
              legacyOutOfRange={legacyOutOfRangeChapters}
            />
          )}
        </Box>

        <TextField
          label="Notes"
          multiline
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <Box
          sx={{
            display: "flex",
            gap: 2,
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {isEdit && initialData && (
            <CollectionDeleteButton
              id={initialData.id}
              type="manga"
              title={selectedManga?.titleEn ?? "this item"}
              disabled={submitting}
            />
          )}
          <Box sx={{ display: "flex", gap: 2, ml: "auto" }}>
            <Button
              variant="outlined"
              onClick={() => router.back()}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={submitting || !canSubmit}
            >
              {submitting
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Add to collection"}
            </Button>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
