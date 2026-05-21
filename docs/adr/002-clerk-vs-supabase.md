# ADR 002 — Auth provider: Clerk vs Supabase Auth (decision pendiente)

**Fecha:** 2026-05-20
**Estado:** Pendiente — decidir en sem 1
**Decisor:** Gus

## Contexto

Necesitamos auth multi-tenant con organizaciones, roles, MFA opcional, y sync a Postgres.

## Opciones

### A) Clerk
- Pros: orgs B2B nativas, MFA elegante, UI lista, SDK Next.js maduro, free 10k MAU.
- Contras: vendor lock, USD 25/mes baseline post-free, lock-in mediano si quiero migrar.

### B) Supabase Auth + Postgres + Storage (todo en uno)
- Pros: combina auth + DB + storage = ahorra Clerk + Railway Postgres + R2. Open source, autohosteable como fallback.
- Contras: orgs/teams hay que construirlas, menos pulido que Clerk, RLS via JWT claims requiere trabajo.

### C) Better Auth (TS, OSS)
- Pros: control total, gratis, va creciendo.
- Contras: mas codigo que mantener, sin UI ready-made.

## Recomendacion preliminar

**B) Supabase** para arrancar — minimiza servicios externos y costos iniciales. Si despues necesitamos features avanzadas de B2B (SSO, SCIM, audit fino), migramos a Clerk.

## Por confirmar

Gus decide en sem 1 tras revisar Supabase Auth UI y compatibilidad con Next.js 15 App Router.
