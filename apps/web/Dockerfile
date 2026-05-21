# =========================================================================
# Dockerfile Next.js 15 todo-en-uno (frontend + API Routes + migrator)
# Multi-stage build:
#   - deps: pnpm install
#   - builder: pnpm build (Next standalone output) + compila migrate.ts
#   - runtime: imagen minima con node, runs migrate.js + server.js
# =========================================================================

FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages

RUN pnpm install --frozen-lockfile


FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .

WORKDIR /repo/apps/web
RUN pnpm build

# Compilar el migrator a JS standalone (no necesita Next runtime)
RUN pnpm exec tsc scripts/migrate.ts --module nodenext --target es2022 --outDir scripts \
    --moduleResolution nodenext --esModuleInterop --skipLibCheck


FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV MIGRATIONS_DIR=/app/migrations

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

# Next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

# Migrator (compilado) + sus deps (postgres ya esta en node_modules de standalone)
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/scripts/migrate.js ./scripts/migrate.js
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/scripts/start.sh ./scripts/start.sh

# Migraciones SQL
COPY --chown=nextjs:nodejs infrastructure/postgres/migrations ./migrations

RUN chmod +x ./scripts/start.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

CMD ["./scripts/start.sh"]
