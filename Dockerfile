# =========================================================================
# Dockerfile Next.js 15 todo-en-uno (frontend + API Routes + migrator)
# Multi-stage build:
#   - deps:    pnpm install (sin lockfile estricto)
#   - builder: pnpm build (Next standalone) + compila migrate.ts a CommonJS
#   - runtime: imagen minima, runs migrate.js + server.js
#
# Build context: raiz del repo (.)
# =========================================================================

FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

# Si existe pnpm-lock.yaml lo respeta; sino genera uno nuevo
COPY pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile


FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .

# Build Next.js
WORKDIR /repo/apps/web
RUN pnpm build

# Compilar el migrator a JS CommonJS standalone
RUN pnpm exec tsc scripts/migrate.ts \
    --module commonjs \
    --target es2022 \
    --moduleResolution node \
    --esModuleInterop \
    --skipLibCheck \
    --outDir scripts


FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV MIGRATIONS_DIR=/app/migrations

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache wget

WORKDIR /app

# Next.js standalone output (incluye node_modules necesarios)
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

# Migrator (compilado a CommonJS) + entrypoint
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/scripts/migrate.js ./scripts/migrate.js
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/scripts/start.sh ./scripts/start.sh

# Modulos node necesarios para el migrator (postgres-js)
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/node_modules/postgres ./scripts/node_modules/postgres

# Migraciones SQL embebidas en la imagen
COPY --chown=nextjs:nodejs infrastructure/postgres/migrations ./migrations

RUN chmod +x ./scripts/start.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

CMD ["./scripts/start.sh"]
