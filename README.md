# Tsuki Media


Tsuki Media is a pnpm monorepo for personal media collections.

## Let poor Neon sleep!

Redis (`REDIS_URL`) caches browsing data; Neon remains the durable source for
saved titles, lists, collections, authentication, and sync logs.

- `library:v1:all`: one 24-hour snapshot of saved anime/manga metadata, list
  entries, collection items, and provider-ID mappings. List, collection, detail,
  and profile-total pages share it. An absent title is not a browsing restriction.
- `library:v1:revision`: a small invalidation counter. A rebuild cannot publish
  its snapshot if a write changed the revision in the meantime.
- `provider:metadata:v1:<anime|manga>:<kitsuId>`: metadata for titles browsed
  outside the local database, fetched from Kitsu and cached for 24 hours. These
  visits do not create Neon records. Provider-confirmed 404s expire in 5 minutes;
  outages, rate limits, and invalid responses are not cached as missing titles.

List/collection edits, title resolution, and completed or failed syncs invalidate
the library snapshot. Local metadata is stored once in that snapshot rather than
duplicated under each ID. Previous `anime:list:*`, `manga:list:*`, and title cache
keys can expire naturally. Malformed detail IDs return not-found before loading
the library. Cached dates are restored to Date objects for existing consumers.

A cold or expired library cache still queries Neon; Redis failures fall back to
Neon and emit `[cache]` errors. Authentication and sync operations still access
Neon. Browser components continue to fetch supplemental provider information
(genres, streaming links, related titles). This change does not migrate or remove
database records.




## Applications

| App | Development URL | Documentation |
| --- | --- | --- |
| Anime and manga | http://localhost:3000 | [apps/anime](apps/anime/README.md) |
| Books | http://localhost:3001 | [apps/books](apps/books/README.md) |
| Movies | http://localhost:3002 | [apps/movies](apps/movies/README.md) |

Shared provider clients and UI components live in `packages/providers` and
`packages/ui`.

## Setup

```bash
pnpm install
cp .env.example .env
```

Each application has its own `.env.example`. Copy it to `.env` in that app's
directory and configure its credentials. App values take precedence over
shared root values.

## Workspace commands

```bash
pnpm dev:all
pnpm build
pnpm test
pnpm typecheck
pnpm lint-check
```

See each application README for individual development, build, and deployment
commands.
