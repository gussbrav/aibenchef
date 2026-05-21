# =========================================================================
# Dockerfile Next.js 15 todo-en-uno (frontend + API Routes + migrator)
#
# Estrategia: NO usamos Next.js standalone output porque el migrator necesita
# postgres-js disponible en runtime y standalone solo bundlea modulos usados
# por Next. Mejor copiar node_modules completo (imagen ~250MB) pero todo
# funciona seguro.
#
# Build context: raiz del repo
# Migraciones SQL: copiadas al image desde infrastructure/postgres/migrations
# Entry: corre migrator -> arranca Next.js (sin script externo, evita CRLF bugs)
# =========================================================================

FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY pnpm-lock.yaml* ./

RUN pnpm install --no-frozen-lockfile


FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .

WORKDIR /repo/apps/web
RUN pnpm build

# Compilar migrate.ts a CommonJS standalone
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
ENV HOSTNAME=0.0.0.0
ENV MIGRATIONS_DIR=/app/migrations

RUN apk add --no-cache wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

# Copiar la app entera con su node_modules
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/scripts/migrate.js ./apps/web/scripts/migrate.js
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /repo/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /repo/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Migraciones SQL embebidas
COPY --chown=nextjs:nodejs infrastructure/postgres/migrations ./migrations

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

# Entrypoint inline: migrator + Next.js start
# Si migrator falla, el container muere y EasyPanel reintenta
CMD ["sh", "-c", "node /app/apps/web/scripts/migrate.js && cd /app/apps/web && exec node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
