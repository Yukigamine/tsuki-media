# Tsuki Movies

Tsuki Movies searches TMDB and stores the collection in browser storage.

## Configuration

```bash
cp apps/movies/.env.example apps/movies/.env
```

Set `TMDB_API_TOKEN` to a
[TMDB API Read Access Token](https://www.themoviedb.org/settings/api).

## Development

```bash
pnpm dev:movies
```

## Build

```bash
pnpm build:movies
```

## Deploy

```bash
pnpm deploy:movies
pnpm --filter @tsuki-media/movies start
```

For platforms such as Vercel, set the project root directory to `apps/movies`
and configure `TMDB_API_TOKEN` as a server-side environment variable.
