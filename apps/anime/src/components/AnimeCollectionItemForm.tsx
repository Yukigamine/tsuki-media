"use client";

import {
  Alert,
  Box,
  Button,
  FormControl,
  InputAdornment,
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
  CollectionRarity,
  MediaFormat,
} from "@/generated/prisma/enums";
import {
  addAnimeCollectionItem,
  editAnimeCollectionItem,
  resolveAnimeId,
} from "@/lib/actions/collection";
import type {
  AnimeCollectionItemInput,
  KitsuSearchResult,
} from "@/lib/actions/collection/types";
import {
  getAnimeResolvePayloadBySlug,
  getAnimeSeriesDetailBySlug,
  type KitsuAnimeSeriesDetail,
} from "@/lib/kitsu/client-queries";

type ExistingItem = {
  id: string;
  animeId: string;
  kitsuId: string | null;
  titleEn: string | null;
  rarity: CollectionRarity;
  format: MediaFormat;
  condition: CollectionCondition;
  notes: string | null;
  purchasedAt: Date | null;
  pricePaid: number | null;
  barcode: string | null;
};

type Props = {
  /** Present on edit; absent on add */
  initialData?: ExistingItem;
  /** Kitsu series detail (edit mode only) */
  seriesDetail?: KitsuAnimeSeriesDetail | null;
};

const FORMAT_OPTIONS: { value: MediaFormat; label: string }[] = [
  { value: "BLU_RAY", label: "Blu-ray" },
  { value: "DVD", label: "DVD" },
  { value: "VHS", label: "VHS" },
  { value: "DIGITAL", label: "Digital" },
  { value: "OTHER", label: "Other" },
];

const CONDITION_OPTIONS: { value: CollectionCondition; label: string }[] = [
  { value: "MINT", label: "Mint" },
  { value: "NEAR_MINT", label: "Near Mint" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "POOR", label: "Poor" },
];

const RARITY_OPTIONS: { value: CollectionRarity; label: string }[] = [
  { value: "STANDARD", label: "Standard" },
  { value: "COLLECTORS", label: "Collector's" },
  { value: "DELUXE", label: "Deluxe" },
  { value: "STEELBOOK", label: "Steelbook" },
];

export function AnimeCollectionItemForm({ initialData, seriesDetail }: Props) {
  const router = useRouter();
  const isEdit = Boolean(initialData);

  const [fetchedSeriesDetail, setFetchedSeriesDetail] =
    useState<KitsuAnimeSeriesDetail | null>(seriesDetail ?? null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!initialData?.kitsuId) return;
      const detail = await getAnimeSeriesDetailBySlug(initialData.kitsuId);
      if (active) {
        setFetchedSeriesDetail(detail);
      }
    }

    if (isEdit && initialData?.kitsuId) {
      void load();
    }

    return () => {
      active = false;
    };
  }, [initialData?.kitsuId, isEdit]);

  const activeSeriesDetail = fetchedSeriesDetail ?? seriesDetail ?? null;

  const [selectedAnime, setSelectedAnime] = useState<KitsuSearchResult | null>(
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

  const [rarity, setRarity] = useState<CollectionRarity>(
    initialData?.rarity ?? "STANDARD",
  );
  const [format, setFormat] = useState<MediaFormat>(
    initialData?.format ?? "BLU_RAY",
  );
  const [condition, setCondition] = useState<CollectionCondition>(
    initialData?.condition ?? "GOOD",
  );
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [purchasedAt, setPurchasedAt] = useState<string | null>(
    initialData?.purchasedAt
      ? initialData.purchasedAt.toISOString().slice(0, 10)
      : null,
  );
  const [pricePaid, setPricePaid] = useState(
    initialData?.pricePaid != null ? String(initialData.pricePaid) : "",
  );
  const [barcode, setBarcode] = useState(initialData?.barcode ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isEdit || selectedAnime !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      let animeId: string;

      if (isEdit && initialData) {
        animeId = initialData.animeId;
      } else {
        if (!selectedAnime) {
          setError("Please select an anime title.");
          setSubmitting(false);
          return;
        }
        const payload = await getAnimeResolvePayloadBySlug(
          selectedAnime.kitsuId,
        );
        if (!payload) {
          setError("Anime not found on Kitsu.");
          setSubmitting(false);
          return;
        }

        const resolved = await resolveAnimeId(payload);
        if (!resolved.ok) {
          setError(resolved.error);
          setSubmitting(false);
          return;
        }
        animeId = resolved.data;
      }

      const input: AnimeCollectionItemInput = {
        animeId,
        rarity,
        format,
        condition,
        notes: notes || undefined,
        purchasedAt: purchasedAt || undefined,
        pricePaid: pricePaid ? Number(pricePaid) : undefined,
        barcode: barcode || undefined,
      };

      let result: Awaited<
        ReturnType<
          typeof addAnimeCollectionItem | typeof editAnimeCollectionItem
        >
      >;
      if (isEdit && initialData) {
        result = await editAnimeCollectionItem(initialData.id, input);
      } else {
        result = await addAnimeCollectionItem(input);
      }

      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      await router.push("/collection/anime");
    } catch (err) {
      console.error("[animeForm] submit error:", err);
      setError("An unexpected error occurred");
      setSubmitting(false);
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={3}>
        {error && <Alert severity="error">{error}</Alert>}

        <ItemLookupField
          type="anime"
          onSelect={setSelectedAnime}
          disabled={isEdit}
          initialValue={selectedAnime}
        />
        {isEdit && activeSeriesDetail?.episodeCount != null && (
          <Typography variant="body2" color="text.secondary">
            {activeSeriesDetail.episodeCount} episode
            {activeSeriesDetail.episodeCount !== 1 ? "s" : ""} (Kitsu)
          </Typography>
        )}

        <FormControl fullWidth>
          <InputLabel>Rarity</InputLabel>
          <Select
            value={rarity}
            label="Rarity"
            onChange={(e) => setRarity(e.target.value as CollectionRarity)}
          >
            {RARITY_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth>
          <InputLabel>Format</InputLabel>
          <Select
            value={format}
            label="Format"
            onChange={(e) => setFormat(e.target.value as MediaFormat)}
          >
            {FORMAT_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

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

        <TextField
          label="Purchased date"
          type="date"
          value={purchasedAt ?? ""}
          onChange={(e) => setPurchasedAt(e.target.value || null)}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <TextField
          label="Price paid"
          type="number"
          value={pricePaid}
          onChange={(e) => setPricePaid(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">$</InputAdornment>
              ),
            },
          }}
        />

        <TextField
          label="Barcode"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 30 } }}
        />

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
              type="anime"
              title={selectedAnime?.titleEn ?? "this item"}
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
