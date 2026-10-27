# Tsuki Books

Tsuki Books searches Hardcover and stores the collection in browser storage.

## Configuration

```bash
cp apps/books/.env.example apps/books/.env
```

Set `HARDCOVER_API_TOKEN` to a
[Hardcover personal API token](https://hardcover.app/account/api).

## Development

```bash
pnpm dev:books
```

## Build

```bash
pnpm build:books
```

## Deploy

```bash
pnpm deploy:books
pnpm --filter @tsuki-media/books start
```

For platforms such as Vercel, set the project root directory to `apps/books`
and configure `HARDCOVER_API_TOKEN` as a server-side environment variable.
