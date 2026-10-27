"use client";

import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
import { useEffect, useState } from "react";

type Props = {
  onSearchChange: (value: string) => void;
};

export default function ListSearchField({ onSearchChange }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!value) return;

    const timer = window.setTimeout(() => {
      onSearchChange(value);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [onSearchChange, value]);

  const handleChange = (nextValue: string) => {
    setValue(nextValue);
    if (!nextValue) onSearchChange("");
  };

  const handleClear = () => handleChange("");

  return (
    <TextField
      size="small"
      placeholder="Search..."
      value={value}
      onChange={(event) => handleChange(event.target.value)}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <Tooltip title="Clear search">
                <IconButton
                  aria-label="Clear search"
                  edge="end"
                  size="small"
                  onClick={handleClear}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
        },
      }}
      sx={{
        width: { xs: "auto", sm: 360 },
        flex: { xs: 1, sm: "initial" },
        maxWidth: "100%",
      }}
    />
  );
}
