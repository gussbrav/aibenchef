# ADR 002 — Auth provider: Better Auth self-hosted en Next.js

**Fecha:** 2026-05-21 (actualizado tras decision ADR 003 de single Next.js app)
**Estado:** Aceptado
**Decisor:** Gus (solo dev)

## Contexto

Necesitamos auth multi-tenant con organizaciones, roles, MFA opcional, sync a Postgres.

Gus ya paga Hetzner VPS (24 GB RAM) — quiere costo USD 0/mes hasta tener pagantes.
Esto descarta Clerk (USD 25/mes baseline) y Supabase Pro (USD 25/mes).

Tras ADR 003, el stack es Next.js todo-en-uno (sin FastAPI separado). Eso descarta
FastAPI-Users (que era para backend Python).

## Decision

**Better Auth** (https://www.better-auth.com/) corriendo dentro del mismo Next.js,
con adapter Drizzle contra el Postgres existente.

## Por que Better Auth y no Auth.js (NextAuth)

- **Orgs B2B nativas**: plugin `organization()` viene con teams, roles, invitations.
  Auth.js no tiene esto out-of-the-box.
- **Mas moderno**: arquitectura 2024+, tipos estrictos, edge-compatible.
- **Mejor DX**: API consistente, configuracion menos magica.
- **Mas adopcion** en el ecosistema TS desde 2025.

## Por que no las otras alternativas

- **Clerk** (USD 25/mes baseline tras 10k MAU): vendor lock + costo.
- **Supabase Auth** (DB free se pausa tras 7d inactividad): inaceptable para prod.
- **Lucia**: minimal pero requiere reimplementar orgs y MFA a mano.
- **Auth0 / Cognito**: caros y overkill.
- **FastAPI-Users**: descartado tras ADR 003 (no hay FastAPI).

## Features cubiertas

- Email + password con verification email (Resend cuando este integrado).
- OAuth Google + Microsoft.
- Sessions cookie + opcional JWT bearer para API.
- Plugin organization: orgs, members, roles (`owner`, `admin`, `member`, `viewer`), invitations.
- TOTP MFA disponible via plugin (activar en Fase 3+).
- Rate limiting built-in.

## Consecuencias

- Schemas Drizzle en `apps/web/lib/db/schema/auth.ts` mirror de Better Auth.
- Endpoint catch-all `/api/auth/[...all]/route.ts` maneja todos los flows.
- Cookie session firmada con `BETTER_AUTH_SECRET`.
- Multi-tenancy: el GUC `app.tenant_id` se setea en cada request via `withTenant()` helper
  en `lib/db/index.ts`, leyendo la org activa del usuario logueado.
- Backups de `auth.*` schema parte del backup general de Postgres.

## Cuando reconsiderar

Migrar a Clerk si:
- > 1000 orgs activas y necesitamos SSO/SCIM enterprise.
- El equipo crece y queremos delegar la complejidad de auth.
- Cliente Enterprise pide compliance SOC2 que cuesta mas certificar self-hosted.
