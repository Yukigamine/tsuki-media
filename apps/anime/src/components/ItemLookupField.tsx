"use client";

import SearchIcon from "@mui/icons-material/Search";
import {
  Autocomplete,
  Avatar,
  Box,
  CircularProgress,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type { KitsuSearchResult } from "@/lib/actions/collection/types";
import {
  searchAnimeByTitleClient,
  searchMangaByTitleClient,
} from "@/lib/kitsu/client-queries";

type Props = {
  type: "anime" | "manga";
  onSelect: (result: KitsuSearchResult | null) => void;
  disabled?: boolean;
  initialValue?: KitsuSearchResult | null;
};

export function ItemLookupField({
  type,
  onSelect,
  disabled = false,
  initialValue = null,
}: Props) {
  const [inputValue, setInputValue] = useState(
    initialValue?.titleTranslated ??
      initialValue?.titleEn ??
      initialValue?.titleRomaji ??
      "",
  );
  const [options, setOptions] = useState<KitsuSearchResult[]>(
    initialValue ? [initialValue] : [],
  );
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState<KitsuSearchResult | null>(initialValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disabled) return;
    if (
      !inputValue.trim() ||
      inputValue === value?.titleTranslated ||
      inputValue === value?.titleEn ||
      inputValue === value?.titleRomaji
    ) {
      if (!inputValue.trim()) setOptions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const items =
          type === "anime"
            ? await searchAnimeByTitleClient(inputValue)
            : await searchMangaByTitleClient(inputValue);
        setOptions(items);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    inputValue,
    type,
    disabled,
    value?.titleTranslated,
    value?.titleEn,
    value?.titleRomaji,
  ]);

  return (
    <Autocomplete<KitsuSearchResult>
      disabled={disabled}
      options={options}
      loading={loading}
      value={value}
      inputValue={inputValue}
      filterOptions={(x) => x}
      getOptionLabel={(o) =>
        o.titleTranslated ?? o.titleEn ?? o.titleRomaji ?? o.titleJp ?? ""
      }
      getOptionKey={(o) => o.kitsuId.toString()}
      isOptionEqualToValue={(o, v) => o.kitsuId === v.kitsuId}
      onChange={(_, newValue) => {
        setValue(newValue);
        onSelect(newValue);
      }}
      onInputChange={(_, newInput) => setInputValue(newInput)}
      renderOption={(props, option) => {
        const { key, ...rest } = props as { key: React.Key } & typeof props;
        return (
          <Box
            component="li"
            key={key}
            {...rest}
            sx={{ gap: 1, display: "flex", alignItems: "center" }}
          >
            {option.posterUrl ? (
              <Avatar
                src={option.posterUrl}
                alt={
                  option.titleTranslated ??
                  option.titleEn ??
                  option.titleRomaji ??
                  option.titleJp ??
                  ""
                }
                variant="rounded"
                sx={{ width: 36, height: 52, flexShrink: 0 }}
              />
            ) : (
              <Avatar
                variant="rounded"
                sx={{ width: 36, height: 52, flexShrink: 0 }}
              >
                ?
              </Avatar>
            )}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {option.titleTranslated ??
                  option.titleEn ??
                  option.titleRomaji ??
                  option.titleJp}
              </Typography>
              {(option.titleTranslated ?? option.titleEn) &&
                option.titleRomaji &&
                option.titleRomaji !==
                  (option.titleTranslated ?? option.titleEn) && (
                  <Typography variant="caption" color="text.secondary">
                    {option.titleRomaji}
                  </Typography>
                )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => {
        // In MUI v9, adornments live in params.slotProps.input
        type InputSlot = {
          startAdornment?: React.ReactNode;
          endAdornment?: React.ReactNode;
        };
        const inputSlot = (params.slotProps?.input ?? {}) as InputSlot;
        return (
          <TextField
            {...params}
            label={type === "anime" ? "Search anime" : "Search manga"}
            placeholder="Start typing a title…"
            slotProps={{
              ...params.slotProps,
              input: {
                ...(params.slotProps?.input ?? {}),
                startAdornment: (
                  <>
                    <SearchIcon sx={{ color: "text.disabled", mr: 0.5 }} />
                    {inputSlot.startAdornment}
                  </>
                ),
                endAdornment: (
                  <>
                    {loading ? <CircularProgress size={18} /> : null}
                    {inputSlot.endAdornment}
                  </>
                ),
              },
            }}
          />
        );
      }}
    />
  );
}
