# Aibenchef

SaaS multi-tenant para data publica de la SBS Peru. Suscripcion mensual / anual para analistas financieros, gerencias de microfinanzas y consultoras.

**Dominio:** https://aibenchef.azoramind.com (proximamente)
**Arquitectura:** ver [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) (en la raiz del proyecto SBS).
**Stack:** Next.js 15 todo-en-uno (frontend + API Routes) + PostgreSQL 16 + Drizzle ORM + Better Auth + dbt + Stripe. Python (uv) solo en `data-platform/` para scrapers SBS.

---

## Setup local

### Requisitos
- Node.js 22+
- pnpm 10+
- Python 3.12+
- uv (`pip install uv` o `winget install astral-sh.uv`)
- Docker Desktop
- Postgres client (psql)

### Primer arranque

```bash
# 1. Instalar deps JS
pnpm install

# 2. Levantar infra local (postgres, redis, cube)
cd infrastructure/docker
docker compose up -d

# 3. Migrar DB
cd ../postgres
./apply-migrations.sh

# 4. Next.js (frontend + API Routes)
cd apps/web
pnpm dev
# abre http://localhost:3000

# 5. dbt (cuando haya datos crudos)
cd data-platform/dbt
uv run dbt deps
uv run dbt run
```

---

## Estructura del repo

```
aibenchef/
├── Dockerfile              Dockerfile principal (Next.js standalone + migrator)
├── apps/
│   └── web/                Next.js 15 todo-en-uno (frontend + API Routes + auth + billing)
├── packages/
│   ├── ui/                 Design system compartido
│   ├── types/              Types TS compartidos
│   └── tsconfig/           Configs TS base
├── data-platform/
│   ├── scrapers/sbs/       Playwright scraping SBS
│   ├── parsers/            .xls -> raw schema
│   ├── dbt/                Transformaciones SQL versionadas
│   └── cube/               Capa semantica
├── infrastructure/
│   ├── postgres/           Migrations y RLS policies
│   ├── docker/             docker-compose dev
│   └── github-actions/     Workflows CI/CD
└── docs/
    ├── adr/                Architecture Decision Records
    ├── runbooks/           Operacion
    └── data-dictionary/    Doc autogen de dbt
```

---

## Convenciones

- Codigo: ingles. Comentarios y UI: castellano peruano (tuteo).
- Python: snake_case, ruff + mypy strict.
- TypeScript: camelCase, biome + tsc strict.
- SQL: snake_case, schema-qualified (`dw.fact_observacion`).
- Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` + scope opcional.
- Sin `Co-Authored-By: Claude` en commits.
- Sin emojis en codigo a menos que sea UI text.

---

## Status

| Componente | Estado |
|---|---|
| Repo + CI base | listo |
| Next.js scaffold + API Routes (/api/health, /api/me, /api/auth) | listo |
| Drizzle schemas (auth, tenant, billing) | listo |
| Better Auth config | listo |
| Migraciones SQL | listo (V001+V002 listas, V003+V004 para Fase 1) |
| Scrapers SBS Playwright | pendiente — Fase 1 |
| dbt models | pendiente — Fase 1 |
| Dashboards UI | pendiente — Fase 4 |
| Stripe billing | pendiente — Fase 5 |
| Deploy EasyPanel | pendiente — siguiente paso |
