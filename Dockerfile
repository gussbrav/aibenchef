# =========================================================================
# Dockerfile Next.js 15 todo-en-uno (frontend + API Routes + migrator)
#
# Build context: raiz del repo
# Migraciones SQL: copiadas al image desde infrastructure/postgres/migrations
# Entry: CMD inline que corre migrator -> arranca Next.js (sin script .sh)
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

# Build args -> env vars para que Next build no warne y prerender funcione.
# Estos vienen de EasyPanel (--build-arg). En docker-compose local pasarlos
# tambien si querias el mismo build.
ARG DATABASE_URL=""
ARG BETTER_AUTH_SECRET=""
ARG BETTER_AUTH_URL=""
ARG NEXT_PUBLIC_APP_URL=""
ARG GIT_SHA=""
ENV DATABASE_URL=$DATABASE_URL
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV GIT_SHA=$GIT_SHA

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
ARG GIT_SHA=""
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV MIGRATIONS_DIR=/app/migrations
ENV GIT_SHA=$GIT_SHA

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
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/scripts/warmup.sh ./apps/web/scripts/warmup.sh
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

# Entrypoint inline: migrator + Next.js start + warmup async.
#
# Notas de diseno:
#   - Migrator usa '||' (no '&&') a proposito. Si falla, se imprime el
#     error y Next.js arranca IGUAL. Con '&&' un migrator roto mataba el
#     contenedor -> EasyPanel hacia rollback silencioso al ultimo container
#     sano -> el deploy 'exitoso' seguia sirviendo codigo viejo. Fail-forward
#     con visibility en /api/health?deep=1 es mejor.
#
#   - warmup.sh corre en background (& al final del comando) para pre-compilar
#     rutas SSR criticas del dashboard sin bloquear el arranque. El primer
#     usuario post-deploy ya no ve 'Cargando...' por 15+ segundos porque
#     la ruta ya fue compilada por el warmup script.
CMD ["sh", "-c", "node /app/apps/web/scripts/migrate.js || echo '[BOOT] MIGRATOR FAILED — check /api/health?deep=1' >&2; (sleep 3 && sh /app/apps/web/scripts/warmup.sh) & cd /app/apps/web && exec node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
