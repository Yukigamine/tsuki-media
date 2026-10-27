# Tsuki Anime

The anime and manga application manages lists and collections using Kitsu and
AniList. It requires Postgres and Redis.

## Configuration

From the repository root:

```bash
cp .env.example .env
cp apps/anime/.env.example apps/anime/.env
```

Configure the shared database and Redis URLs in the root `.env`. Configure
authentication and provider credentials in `apps/anime/.env`.

## Development

```bash
pnpm dev:anime
```

## Build

```bash
pnpm build:anime
```

## Deploy

The deploy command generates Prisma Client, applies pending database
migrations, and builds the production application:

```bash
pnpm deploy:anime
pnpm --filter @tsuki-media/anime start
```

The root `Dockerfile` and `docker-compose.yml` also deploy this application:

```bash
docker compose up --build
```
