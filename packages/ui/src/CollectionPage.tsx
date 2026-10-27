"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  CircularProgress,
  Grid,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useMemo, useState } from "react";

export type CollectionMediaItem = {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  metadata?: string;
};

type Props = {
  mediaName: string;
  providerName: string;
  storageKey: string;
};

function MediaCard({
  item,
  inCollection,
  onToggle,
}: {
  item: CollectionMediaItem;
  inCollection: boolean;
  onToggle: () => void;
}) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {item.imageUrl ? (
          <CardMedia
            component="img"
            image={item.imageUrl}
            alt=""
            sx={{ height: 300, objectFit: "cover" }}
          />
        ) : (
          <Box
            sx={{
              height: 300,
              display: "grid",
              placeItems: "center",
              bgcolor: "action.hover",
            }}
          >
            No image
          </Box>
        )}
        <CardContent sx={{ flexGrow: 1 }}>
          <Typography variant="h6">{item.title}</Typography>
          {item.subtitle && (
            <Typography color="text.secondary">{item.subtitle}</Typography>
          )}
          {item.metadata && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {item.metadata}
            </Typography>
          )}
        </CardContent>
        <CardActions>
          <Button
            color={inCollection ? "error" : "primary"}
            startIcon={inCollection ? <DeleteIcon /> : <AddIcon />}
            onClick={onToggle}
          >
            {inCollection ? "Remove" : "Add to collection"}
          </Button>
        </CardActions>
      </Card>
    </Grid>
  );
}

export function CollectionPage({ mediaName, providerName, storageKey }: Props) {
  const [collection, setCollection] = useState<CollectionMediaItem[]>([]);
  const [results, setResults] = useState<CollectionMediaItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCollection(
            parsed.filter(
              (item): item is CollectionMediaItem =>
                typeof item === "object" &&
                item !== null &&
                typeof item.id === "string" &&
                typeof item.title === "string",
            ),
          );
        }
      }
    } catch (error) {
      console.warn("Ignoring invalid saved collection", error);
      localStorage.removeItem(storageKey);
    } finally {
      setLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (loaded) {
      localStorage.setItem(storageKey, JSON.stringify(collection));
    }
  }, [collection, loaded, storageKey]);

  const collectionIds = useMemo(
    () => new Set(collection.map((item) => item.id)),
    [collection],
  );

  function toggleItem(item: CollectionMediaItem) {
    setCollection((current) =>
      current.some(({ id }) => id === item.id)
        ? current.filter(({ id }) => id !== item.id)
        : [...current, item],
    );
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}`,
      );
      const payload = (await response.json()) as {
        results?: CollectionMediaItem[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Search failed");
      }
      setResults(payload.results || []);
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Search failed",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box>
      <Typography variant="h3" component="h1" gutterBottom>
        {mediaName} collection
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Search {providerName} and add titles to this browser&apos;s collection.
      </Typography>

      <Box component="form" onSubmit={search} sx={{ display: "flex", gap: 1 }}>
        <TextField
          fullWidth
          label={`Search ${mediaName.toLowerCase()}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            },
          }}
        />
        <Button type="submit" variant="contained" disabled={loading}>
          Search
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      {loading && (
        <CircularProgress sx={{ display: "block", my: 4, mx: "auto" }} />
      )}

      <Typography variant="h4" component="h2" sx={{ mt: 5, mb: 2 }}>
        My collection ({collection.length})
      </Typography>
      {loaded && collection.length === 0 ? (
        <Typography color="text.secondary">
          Your collection is empty. Search above to add your first title.
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {collection.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              inCollection
              onToggle={() => toggleItem(item)}
            />
          ))}
        </Grid>
      )}

      {results.length > 0 && (
        <>
          <Typography variant="h4" component="h2" sx={{ mt: 5, mb: 2 }}>
            Search results
          </Typography>
          <Grid container spacing={2}>
            {results.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                inCollection={collectionIds.has(item.id)}
                onToggle={() => toggleItem(item)}
              />
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
}
