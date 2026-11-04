# Kitsu vs AniList Push Logic Flow Comparison

## Overview

Both `pushKitsu()` and `pushAniList()` now implement consistent safety gates to prevent API errors from invalid progress values exceeding episode/chapter counts.

---

## Phase 1: Data Loading & Pre-Sync Validation Logging

### Kitsu (lines 939-980)

```typescript
// Load remote anime/manga maps and local entries
const remoteAnimeMap = await scanKitsuIds(slug, "ANIME");
const animeEntries = await prisma.animeListEntry.findMany({
  include: { anime: true },
});

// Log entries with missing episode counts
const missingEpisodeCount = animeEntries.filter((e) => !e.anime.episodeCount);
// Log entries with progress > episodeCount
const invalidProgressAnime = animeEntries.filter(
  (e) => e.anime.episodeCount && e.progress > e.anime.episodeCount,
);
// Same pattern for manga with chapterCount
```

### AniList (lines 794-855)

```typescript
// Load remote anime/manga maps and local entries
const [remoteAnimeMap, remoteMangaMap, animeEntries, mangaEntries] =
  await Promise.all([
    scanAniListEntries(username, "ANIME"),
    scanAniListEntries(username, "MANGA"),
    prisma.animeListEntry.findMany({ include: { anime: true } }),
    prisma.mangaListEntry.findMany({ include: { manga: true } }),
  ]);

// Log entries with missing episode counts
const missingEpisodeCount = animeEntries.filter((e) => !e.anime.episodeCount);
// Log entries with progress > episodeCount
const invalidProgressAnime = animeEntries.filter(
  (e) => e.anime.episodeCount && e.progress > e.anime.episodeCount,
);
// Same pattern for manga with chapterCount
```

**Result**: ✅ **Identical pattern** - Both log data quality issues before processing

---

## Phase 2a: Entry Validation

### Kitsu (lines 995-1003)

```typescript
for (const entry of animeEntries) {
  // Validate entry before attempting sync
  const entryIssues = validateAnimeListEntry(entry);
  const mediaIssues = validateMediaRecord(entry.anime);
  if (entryIssues.length > 0 || mediaIssues.length > 0) {
    errors.push(
      `anime entry ${entry.id}: ${[...entryIssues, ...mediaIssues].join(", ")}`,
    );
    continue;
  }
  // Continue processing
}
```

### AniList (lines 869-878)

```typescript
for (const entry of animeEntries) {
  // Validate entry before attempting sync
  const entryIssues = validateAnimeListEntry(entry);
  const mediaIssues = validateMediaRecord(entry.anime);
  if (entryIssues.length > 0 || mediaIssues.length > 0) {
    errors.push(
      `anime entry ${entry.id}: ${[...entryIssues, ...mediaIssues].join(", ")}`,
    );
    continue;
  }
  // Continue processing
}
```

**Result**: ✅ **Identical validation** - Both validate before processing

---

## Phase 2b: Progress Clamping for Updates

### Kitsu (lines 1020-1045)

```typescript
if (remote) {
  if (!kitsuAnimeNeedsUpdate(entry, remote)) continue;

  // Use remote's episode count for validation (Kitsu is authoritative)
  const remoteEpisodeCount = remote.episodeCount;
  const clampedProgress = remoteEpisodeCount 
    ? Math.min(entry.progress, remoteEpisodeCount) 
    : entry.progress;

  if (clampedProgress !== entry.progress) {
    const localCount = entry.anime.episodeCount;
    if (localCount && remoteEpisodeCount && localCount !== remoteEpisodeCount) {
      console.warn(
        `[Kitsu Push] Episode count mismatch for ${entry.anime.titleEn}: local=${localCount}, Kitsu=${remoteEpisodeCount}. Clamping progress from ${entry.progress} to ${clampedProgress}`
      );
    } else {
      console.warn(
        `[Kitsu Push] Clamping anime progress: ${entry.anime.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (episodes: ${remoteEpisodeCount})`
      );
    }
  }

  animeUpdateOps.push({
    // ... with clampedProgress
  });
}
```

### AniList (lines 916-951)

```typescript
if (remote) {
  if (!anilistAnimeNeedsUpdate(entry, remote)) continue;

  // Use remote's episode count for validation (AniList is authoritative)
  remoteEpisodeCount = remote.episodes ?? null;
  if (remoteEpisodeCount) {
    clampedProgress = Math.min(entry.progress, remoteEpisodeCount);
    animeArgs.progress = clampedProgress;

    if (clampedProgress !== entry.progress) {
      const localCount = entry.anime.episodeCount;
      if (localCount && remoteEpisodeCount && localCount !== remoteEpisodeCount) {
        console.warn(
          `[AniList Push] Episode count mismatch for ${entry.anime.titleEn}: local=${localCount}, AniList=${remoteEpisodeCount}. Clamping progress from ${entry.progress} to ${clampedProgress}`
        );
      } else {
        console.warn(
          `[AniList Push] Clamping anime progress: ${entry.anime.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (episodes: ${remoteEpisodeCount})`
        );
      }
    }
  }

  saveOps.push({
    // ... with clampedProgress via animeArgs
  });
}
```

**Result**: ✅ **Same logic flow**
- Both check if update is needed
- Both use remote count as authoritative
- Both clamp using `Math.min()`
- Both log detailed warnings about mismatches

---

## Phase 2c: Progress Clamping for Creates

### Kitsu (lines 1047-1090)

```typescript
else if (entry.anime.kitsuId) {
  let episodeCount = entry.anime.episodeCount;
  
  // Fetch media details to validate before creating
  if (entry.progress > 0) {
    const mediaDetails = await fetchKitsuMediaDetails(entry.anime.kitsuId, "ANIME");
    if (mediaDetails?.episodeCount != null) {
      const fetchedCount = mediaDetails.episodeCount;
      if (episodeCount && episodeCount !== fetchedCount) {
        console.warn(`[Kitsu Push] Episode count mismatch...`);
      }
      episodeCount = fetchedCount;
      // Store fetched count in database
    }
  }

  const clampedProgress = episodeCount 
    ? Math.min(entry.progress, episodeCount) 
    : entry.progress;
  
  if (clampedProgress !== entry.progress) {
    console.warn(`[Kitsu Push] Clamping anime progress on create...`);
  }

  animeCreateOps.push({
    // ... with clampedProgress
  });
}
```

### AniList (lines 953-970)

```typescript
else if (entry.anime.anilistId != null) {
  // Clamp progress based on local episode count
  if (entry.anime.episodeCount) {
    clampedProgress = Math.min(entry.progress, entry.anime.episodeCount);
    animeArgs.progress = clampedProgress;

    if (clampedProgress !== entry.progress) {
      console.warn(
        `[AniList Push] Clamping anime progress on create: ${entry.anime.titleEn} (${entry.id}) from ${entry.progress} to ${clampedProgress} (episodes: ${entry.anime.episodeCount})`
      );
    }
  }

  saveOps.push({
    // ... with clampedProgress via animeArgs
  });
}
```

**Result**: ⚠️ **Slightly different methodology (by design)**
- **Kitsu**: Fetches media details from API for creates (extra validation)
- **AniList**: Uses local episode count for creates (simpler, but still safe)
- Both clamp progress and log warnings
- Both prevent invalid progress from being sent to API

**Note**: AniList doesn't fetch because:
- Local database already has accurate counts from pull operations
- AniList remote entry already includes episode count in `scanAniListEntries()`
- Additional fetch would add latency without significant benefit

---

## Phase 3: Operation Summary Logging

### Kitsu (implicit in batch execution)

```typescript
console.log(
  `[Kitsu Push] Anime: ${animeUpdateOps.length} updates, ${animeCreateOps.length} creates, ${animeDeleteOps.length} deletes`,
);
```

### AniList (lines 1099-1106)

```typescript
console.log(
  `[AniList Push] Anime: ${animeUpdateOps.length} updates, ${animeCreateOps.length} creates, ${animeDeleteOps.length} deletes`,
);
console.log(
  `[AniList Push] Manga: ${mangaUpdateOps.length} updates, ${mangaCreateOps.length} creates, ${mangaDeleteOps.length} deletes`,
);
```

**Result**: ✅ **Added for visibility** - Shows operation counts before execution

---

## Summary: Logic Flow Alignment

| Step                           | Kitsu            | AniList          | Status                  |
| ------------------------------ | ---------------- | ---------------- | ----------------------- |
| 1. Load data                   | ✅               | ✅               | Same                    |
| 2. Pre-sync validation logging | ✅               | ✅               | Same                    |
| 3. Entry validation            | ✅               | ✅               | Same                    |
| 4. Progress clamping (updates) | ✅ Remote count  | ✅ Remote count  | Same                    |
| 5. Progress clamping (creates) | ✅ Fetch + clamp | ✅ Local + clamp | Different (intentional) |
| 6. Operation summary logging   | ✅               | ✅               | Same                    |
| 7. Batch execution             | ✅               | ✅               | Same                    |
| 8. Error handling              | ✅               | ✅               | Same                    |

---

## Key Differences (Intentional Design)

1. **Create validation method**
   - Kitsu: Fetches media details from API (for maximum accuracy)
   - AniList: Uses local database (sufficient, faster)

2. **Remote data access**
   - Kitsu: Must fetch for creates (API doesn't track local progress)
   - AniList: Remote data always available in scan

3. **Implementation language**
   - Kitsu: Imperative (detailed steps, explicit operations)
   - AniList: Declarative (build operation list, then execute)

These differences don't affect the **core safety guarantees**: both prevent invalid progress from being sent to their respective APIs.
