# Build the existing anime/manga app from the Tsuki Media workspace.
FROM node:24-alpine AS builder

WORKDIR /app
RUN npm install -g pnpm

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tsuki-media/anime deploy

FROM node:24-alpine

WORKDIR /app
RUN npm install -g pnpm

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/anime ./apps/anime
COPY --from=builder /app/packages/ui ./packages/ui

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["pnpm", "--filter", "@tsuki-media/anime", "start"]
