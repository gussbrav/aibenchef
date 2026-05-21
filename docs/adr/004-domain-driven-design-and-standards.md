# ADR 004 — Domain-Driven Design + estandares tecnicos no negociables

**Fecha:** 2026-05-21
**Estado:** Aceptado (regla de oro)
**Decisor:** Gus

## Contexto

Aibenchef es un SaaS premium (USD 49-499/mes). Cualquier deuda tecnica acumulada
ahora explota a los 6 meses y mata el roadmap. Ademas Gus quiere que el codigo
sea inmediatamente legible y profesional cuando contrate o lo muestre.

## Decision

**TODO codigo nuevo debe cumplir simultaneamente:**

1. **Ultima tecnologia** — Next 15+, React 19+, TS 5.7+ strict, Node 22+, Postgres 16+, Drizzle, Better Auth, pnpm 10+, Biome, Vitest, Playwright, uv (Python).
2. **Domain-Driven Design** — bounded contexts en `lib/domains/`.
3. **Codigo limpio** — funciones cortas, nombres descriptivos, cero comentarios obvios, DRY sin sobre-abstraer.
4. **SOLID** — especialmente SRP y DIP (depender de interfaces, no de Drizzle directo).
5. **Alta cohesion + bajo acoplamiento** — dependencias explicitas (constructor injection).
6. **Escalabilidad** — stateless, idempotencia, cursor-based pagination, cache con TTL.
7. **Seguridad** — OWASP, CSP, rate limit, zod en toda entrada, audit log, RLS, MFA, no PII en logs.

## Estructura de carpetas (target)

```
apps/web/
├── app/                          # Next App Router (UI + routes)
│   ├── (marketing)/              # Landing publica
│   │   ├── page.tsx
│   │   └── waitlist/
│   ├── (app)/                    # Dashboards post-login
│   │   ├── layout.tsx
│   │   └── dashboard/
│   ├── (auth)/                   # signin, signup, recovery
│   └── api/
│       └── v1/                   # versionado de la API
│           ├── auth/[...all]/
│           ├── me/
│           ├── waitlist/
│           ├── entidades/
│           ├── dashboards/
│           ├── exports/
│           └── webhooks/
│               └── stripe/
│
├── lib/
│   ├── domains/                  # Bounded contexts (DDD)
│   │   ├── auth/
│   │   │   ├── entities/         # User, Session
│   │   │   ├── value-objects/    # Email, PasswordHash
│   │   │   ├── schemas/          # Drizzle + zod
│   │   │   ├── repositories/     # interfaces + impl
│   │   │   ├── services/         # SignInService, etc.
│   │   │   ├── types.ts
│   │   │   └── index.ts          # barrel — solo lo publico
│   │   ├── tenant/               # Organizations, memberships, branding
│   │   ├── billing/              # Subscriptions, entitlements, Stripe
│   │   ├── catalog/              # Entidades SBS, topicos, dim catalogos
│   │   ├── analytics/            # Queries DW, dashboards, ratios
│   │   ├── exports/              # PDF/Excel generators
│   │   ├── alerts/               # Triggers, notificaciones
│   │   ├── waitlist/             # Captura leads
│   │   └── shared/               # logger, errors, primitivos base
│   │
│   ├── infrastructure/
│   │   ├── db/                   # Cliente Postgres + Drizzle + RLS helpers
│   │   ├── cache/                # Redis client (cuando aplique)
│   │   ├── storage/              # MinIO/R2 client (cuando aplique)
│   │   ├── email/                # Resend client
│   │   ├── telemetry/            # Sentry, logs estructurados
│   │   └── stripe/               # Stripe client
│   │
│   ├── auth/                     # Better Auth config (delgado, llama domain/auth)
│   └── env.ts                    # Validacion zod de env vars
│
├── components/
│   ├── ui/                       # Shadcn-style primitives (Button, Card, etc.)
│   ├── marketing/                # Hero, Pricing, Footer
│   └── app/                      # Sidebar, Topbar, DashboardLayout
│
├── tests/
│   ├── unit/                     # Vitest
│   ├── integration/              # Vitest + testcontainers Postgres
│   └── e2e/                      # Playwright
│
├── scripts/
│   └── migrate.ts                # Migrator SQL
│
└── public/
```

## Comunicacion cross-domain

Solo via interfaces publicas (`domains/X/index.ts`). Nunca importar internals
de otro dominio. Si dos dominios necesitan compartir mucho, eso es señal de
que existe un tercer dominio sin extraer.

## Dependency Injection

Funciones de servicio reciben repositorios como parametros, no los instancian:

```ts
// MAL
export async function signIn(email: string, password: string) {
  const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
  ...
}

// BIEN
export function makeSignInService(deps: { userRepo: UserRepository }) {
  return async function signIn(email: Email, password: string) {
    const user = await deps.userRepo.findByEmail(email);
    ...
  };
}
```

En tests, inyectamos un fake repo. En producccion, el Drizzle repo real.

## Migracion desde el estado actual

El codigo actual (`lib/db`, `lib/auth`) NO sigue esta estructura. Plan de
refactor incremental (sin romper el deploy):

1. Crear `lib/domains/shared/` con logger, errors base, primitivos.
2. Crear `lib/infrastructure/db/` (mover lo de `lib/db` ahi).
3. Crear `lib/env.ts` con validacion zod de env vars.
4. Crear `lib/domains/auth/` con entities, repos, services, schemas.
5. Refactor `lib/auth/index.ts` para delegar al dominio auth.
6. Crear `lib/domains/tenant/`, `lib/domains/billing/` cuando empiece Fase 5.
7. Crear `lib/domains/catalog/`, `lib/domains/analytics/` en Fase 1.
8. Crear `lib/domains/exports/`, `lib/domains/alerts/` en Fase 4.

Cada paso es un commit chico que pasa CI. No big bang.

## Consecuencias

**Pros:**
- Codigo legible y profesional desde dia 1.
- Refactors localizados (cambiar implementacion sin tocar consumidores).
- Tests faciles (mockeo a nivel de repositorio).
- Onboarding rapido de futuros devs.

**Contras:**
- Mas archivos y carpetas. Boilerplate de barrels.
- Friccion inicial para single dev acostumbrado a "todo en lib/".
- Disciplina permanente requerida.

## Cuando NO aplicar (excepciones)

- Stubs absolutamente triviales (ej. `/api/health`) pueden quedar inline.
- Codigo de scripts una-vez (migraciones manuales, seeds) no necesita DDD.
- POCs de < 1 dia que sabemos vamos a tirar.

Pero el codigo de produccion del producto SI cumple. Sin excepcion.

## Versionado de tecnologia

Cada 6 meses revisar deps:
- Bump a versiones LTS nuevas (Node, Postgres, Next).
- Cambiar de lib si emerge alternativa significativamente mejor (lo evaluamos juntos).

## Pen test y compliance

- Antes de salir de beta: pen test interno con OWASP ZAP.
- Cuando llegue primer cliente Enterprise: SOC2 Type I roadmap.
- Cada anio: review de Ley 29733 (Peru) compliance.
