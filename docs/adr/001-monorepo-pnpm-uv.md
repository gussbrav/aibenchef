# ADR 001 — Monorepo con pnpm + uv

**Fecha:** 2026-05-20
**Estado:** Aceptado
**Decisor:** Gus (solo dev)

## Contexto

Aibenchef tiene tres lenguajes en juego:
- TypeScript: frontend (Next.js) y packages compartidos.
- Python: backend (FastAPI), scrapers, dbt orchestration.
- SQL: migraciones, dbt models, Cube schemas.

Hay que decidir si va en repos separados o monorepo, y que package managers usar.

## Decision

**Un solo monorepo** en `aibenchef/` con:
- pnpm workspaces para `apps/web`, `packages/*`.
- uv (Astral) para `apps/api` y `data-platform/`, cada uno con `pyproject.toml` propio.
- Postgres migrations sin tool externo por ahora — bash + psql en `infrastructure/postgres/apply-migrations.sh`.

## Por que

- Single dev = single fuente de verdad, no perder tiempo coordinando releases entre repos.
- Tipos compartidos web<->API solo viven bien en monorepo.
- pnpm + uv son los mas rapidos hoy en sus ecosistemas, ambos con lockfile reproducible.
- Cuando crezca el equipo se puede split via Nx/Turborepo si hace falta — no es prematuro.

## Alternativas descartadas

- **Polyrepo** (3 repos): demasiada friccion para 1 dev. Versionado triplicado.
- **Nx/Turborepo desde dia 1**: overkill para 1 web + 1 api. Si se agregan apps movil o nuevos services, evaluar.
- **Poetry en lugar de uv**: mas lento, instalacion menos confiable en CI.

## Consecuencias

- CI corre 3 jobs paralelos (web, api, data-platform).
- Hay 2 lockfiles (`pnpm-lock.yaml`, varios `uv.lock`).
- Devs nuevos necesitan instalar tanto pnpm como uv.
