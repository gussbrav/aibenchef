# ADR 002 — Auth provider: FastAPI-Users self-hosted

**Fecha:** 2026-05-21
**Estado:** Aceptado
**Decisor:** Gus (solo dev)

## Contexto

Necesitamos auth multi-tenant con organizaciones, roles, MFA opcional, y sync a Postgres.

Gus ya paga Hetzner VPS (24 GB RAM) por otro proyecto (CRM Palma Rio). Quiere mantener
costos a USD 0/mes hasta tener clientes pagantes. Esto descarta servicios externos pagos
(Clerk USD 25/mes baseline, Supabase Pro USD 25/mes).

## Decision

**FastAPI-Users** (https://fastapi-users.github.io/fastapi-users/) en el backend FastAPI,
contra Postgres self-hosted en el mismo VPS.

## Por que

- **USD 0 forever** — solo es una libreria Python, sin SaaS externo.
- **Dominio Python** — Gus maneja Python/SQL, no querra debuggear webhooks de Clerk.
- **Self-hosted** — el JWT lo emite y firma nuestra propia API, no dependemos de uptime ajeno.
- **Postgres en mismo VPS** — sync de usuarios sin webhooks, queries directas.
- **Features cubiertas:** signup, login, password reset, email verification, JWT, OAuth (Google + Microsoft via `httpx-oauth`), backends multiples (cookie + bearer).
- **Multi-tenant** — orgs y memberships los modelamos directo en `tenant.organizations` y `tenant.memberships`, no son de FastAPI-Users.
- **MFA** — TOTP via `pyotp` cuando se necesite (Fase 3+).

## Alternativas descartadas

- **Clerk** (USD 25/mes baseline tras free 10k MAU): vendor lock, costos crecen rapido.
- **Supabase Auth** (Free pausa la DB tras 7d inactividad — inaceptable para produccion): ademas la DB free es 500 MB y nuestro DW son ~50 GB.
- **Better Auth** (TS): excelente pero el auth quedaria en el frontend Next.js, fragmentando responsabilidades. Si despues queremos auth en mobile o CLI, vuelve a complicar.
- **Auth0 / Cognito**: caros y overkill para B2B nicho de microfinanzas.

## Consecuencias

- Construir UI de login/signup/recovery en Next.js (no viene listo de un dashboard).
- Manejar templates de email transaccional con Resend.
- Configurar OAuth con Google/Microsoft manualmente (creando OAuth app en consoles respectivas).
- Backups de `auth.*` schema parte del backup general de Postgres.
- Responsabilidad de seguridad: rotar JWT secret, pen-test endpoints, rate limit signup.

## Cuando reconsiderar

Migrar a Clerk si:
- Llegamos a > 1000 orgs activas y necesitamos SSO/SCIM enterprise.
- El equipo crece y queremos delegar la complejidad de auth.
- Algun cliente Enterprise pide cumplimiento SOC2 que cuesta mas certificar self-hosted.
