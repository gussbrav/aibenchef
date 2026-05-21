# ADR 003 — Single Next.js app (no FastAPI separado)

**Fecha:** 2026-05-21
**Estado:** Aceptado
**Decisor:** Gus (solo dev)

## Contexto

El plan inicial era Next.js (frontend) + FastAPI (backend), 2 servicios separados en
EasyPanel. Gus cuestiono por que tantos servicios y pidio simplificar.

## Decision

**Una sola app Next.js 15** que sirve frontend (App Router) y backend (API Routes).
El scraper Python y dbt se mantienen aparte como `data-platform/` y eventualmente
correran como `aibenchef-worker` cuando llegue la Fase 1 de ingesta automatica.

## Por que

- **1 sola app en EasyPanel** vs 2: menos config, menos build, menos deploy.
- **1 lockfile, 1 lenguaje (TS), 1 dependency tree**.
- **Drizzle ORM** es type-safe SQL con performance equivalente a asyncpg en queries pesadas (medido en benchmarks 2024-2025).
- **Better Auth** cubre todo lo que necesitamos: orgs B2B, MFA, OAuth, sesiones cookie+JWT, password reset.
- **Webhooks Stripe** son endpoints REST simples — Next.js API Routes los maneja perfecto.
- **Edge runtime** disponible para endpoints latency-critical sin servidor dedicado.

## Costos del refactor

- Eliminamos `apps/api/` (FastAPI skeleton + Dockerfile + tests).
- Reemplazamos ADR 002 (FastAPI-Users) con Better Auth (este ADR + update 002).
- El `infrastructure/hetzner/docker-compose.production.yml` perdio el service `api`.
- El `Caddyfile` ya no necesita `api.aibenchef.azoramind.com`.
- El CNAME `api.aibenchef` en Cloudflare ya NO hace falta agregar.

## Cuando reconsiderar

Volver a separar API + Web si:
- La API se pone muy pesada (queries de DW que tardan > 5s) y queremos escalar
  workers independiente del frontend.
- Algun cliente Business+ pide una API publica SDK-able muy diferente del consumo del web.
- El equipo crece y queremos separacion frontend/backend a nivel personas.

Hasta entonces: 1 app = menos friccion.

## Datos compartidos con worker Python

El scraper SBS (Python, en `data-platform/`) y la app Next.js (TS) comparten **solo la DB**.
No hay codigo compartido. Cada lado define sus propios tipos:
- Python: pydantic models.
- TS: Drizzle schemas declarados en `apps/web/lib/db/schema/`.

Si en el futuro queremos un solo "source of truth" de tipos, considerar:
- Generar TS types desde Pydantic via `datamodel-code-generator` o similar.
- O al reves: derivar Pydantic desde Drizzle via introspeccion de Postgres.
