# Arquitectura — SBS Insights Platform

> Nombre comercial: **TBD** (sugerencias: SBSight, MicroData PE, Banca360, Pulso SBS, Regulator IO).
> Documento vivo. Cualquier cambio significativo va con un ADR en `docs/adr/`.

---

## 0. Resumen ejecutivo

**Que vamos a construir:** SaaS B2B multi-tenant que disponibiliza toda la data publica de la SBS Peru (Banca Multiple + Empresas Financieras + Cajas Municipales + Cajas Rurales + EDPYMEs, los 10 topicos) limpia, comparada y visualizada, con suscripcion mensual / anual.

**Por que tiene sentido ahora:** demanda validada por usuarios que ya preguntaron precio. Competidores nicho (Equilibrium, Class) trabajan a la medida o son agencias de rating. La SBS publica gratis pero usar la data toma dias por mes. El producto vende tiempo + comparabilidad + UX premium, no la data en si.

**Decisiones estructurales tomadas:**
- Rebuild limpio. No reusar Pentaho ni MySQL legacy.
- Stack: **Next.js 15 + FastAPI + PostgreSQL 16 + dbt + Cube.dev + Stripe + Clerk**.
- Multi-tenant con RLS (Row-Level Security) en Postgres desde el dia 1.
- Scope MVP: 5 grupos de entidades x 10 topicos completo (~200 entidades x 10 topicos x 180 meses historicos).

**Estimaciones de orden de magnitud:**
- Volumen: ~200M filas en facts (con esquema skinny-long). Postgres + particionado lo aguanta tranquilo.
- Costo infra primeros 100 usuarios: USD 80-150 / mes.
- Costo cuando llegue a 1000 usuarios: USD 400-800 / mes.
- Tiempo a MVP funcional: 14-18 semanas full-time una persona (con scope full).

---

## 1. Stack y justificacion (resumen tabular)

| Capa | Tecnologia | Por que esta y no otra |
|---|---|---|
| Frontend | Next.js 15 (App Router) + React Server Components | Premium SEO para landing + SSR para dashboards rapidos. Ecosistema mas maduro 2026 |
| Estilos | Tailwind v4 + shadcn/ui + Tremor para graficos premium | Look profesional con baja friccion. Tremor son charts pensados para SaaS BI |
| Charts avanzados | Recharts (basico) + ECharts (drilldown) | Recharts simple; ECharts cuando se necesita heatmap, sankey, treemap |
| State | TanStack Query + Zustand (UI state) | Query maneja cache, refetch, optimistic; Zustand para UI puro (sidebar, filtros) |
| Backend API | FastAPI + Pydantic v2 + SQLAlchemy 2.0 async + asyncpg | Gus tiene comodidad Python/SQL. Async para concurrencia. Pydantic v2 schema-first |
| Worker / jobs | Prefect 2 (preferido) o Celery + Redis | Prefect mas moderno y observable que Celery. UI nativa |
| Scraping | Playwright (Python) + httpx para descargas | SBS website es JS-rendered en partes. Playwright headless mas robusto que requests |
| ETL / modelado | dbt-postgres + dbt-expectations | Reemplaza .ktr con SQL versionado, testeable, documentado |
| DW | PostgreSQL 16 + pg_partman + pgvector (futuro IA) | Open source serio. Particion mensual por fact. pgvector para "preguntale a la data" |
| Semantic layer | Cube.dev (OSS) | Reemplazo moderno de Mondrian. Cache automatico, multi-tenant, API REST/SQL/GraphQL |
| Auth | Clerk (preferido) o Supabase Auth | Clerk = onboarding mas rapido, MFA, orgs B2B nativas. Costo ~ USD 25/mes hasta 10k MAU |
| Billing | Stripe Billing | Tiers, trials, proration, dunning, facturas. Soporta USD + PEN |
| Facturacion electronica Peru | Nubefact API | SUNAT-compliant. Gus pidio facturacion local |
| Email transaccional | Resend o Postmark | Resend mas barato; Postmark mas confiable para invoices |
| Email marketing | Loops o Customer.io | Onboarding drip, alerta de fin de trial |
| File storage | Cloudflare R2 (S3-compatible) | Exports PDF/Excel, raw .xls de SBS. R2 sin egress fees vs S3 |
| Observabilidad | Sentry + PostHog + Better Stack (logs) | Sentry errores, PostHog producto + analytics + flags, Better Stack tail de logs |
| Search / autocomplete entidades | Postgres trigram (pg_trgm) | No necesita Elastic. trigram alcanza para 200 entidades |
| Hosting frontend | Vercel | Edge functions, ISR, deploy preview por PR |
| Hosting backend | Railway o Fly.io | Postgres managed + workers en containers. Mas barato que AWS |
| CI/CD | GitHub Actions | Standard. Caches, matrix de tests, deploy automatico |
| Secrets | Doppler o Infisical | Versionado, ambientes, audit log |

---

## 2. Estructura del repo (monorepo modular)

```
sbs-insights/
├── apps/
│   ├── web/                      # Next.js 15 (frontend + landing)
│   │   ├── app/
│   │   │   ├── (marketing)/      # landing publica, pricing, blog
│   │   │   ├── (app)/            # dashboards, post-login
│   │   │   ├── api/              # route handlers (auth callbacks, webhooks)
│   │   ├── components/
│   │   ├── lib/
│   │   └── package.json
│   └── api/                      # FastAPI backend
│       ├── app/
│       │   ├── routers/          # endpoints por bounded context
│       │   ├── domain/           # logica de negocio pura
│       │   ├── infrastructure/   # repos SQLAlchemy, clients externos
│       │   ├── middleware/       # auth, RLS context, rate limit
│       │   └── main.py
│       ├── tests/
│       └── pyproject.toml
│
├── packages/
│   ├── ui/                       # design system compartido (shadcn extensions)
│   ├── types/                    # tipos TS compartidos web <-> API
│   └── tsconfig/
│
├── data-platform/
│   ├── scrapers/                 # Python + Playwright
│   │   ├── sbs/
│   │   │   ├── browser.py        # init playwright headless
│   │   │   ├── catalogos.py      # lista entidades, topicos, meses disponibles
│   │   │   ├── descarga.py       # descarga .xls a R2
│   │   │   ├── validacion.py     # checksums, schema check
│   │   │   └── flows.py          # Prefect flows
│   ├── parsers/                  # .xls -> filas tipadas (pandas + pydantic)
│   │   ├── eeff.py
│   │   ├── colocaciones.py
│   │   ├── depositos.py
│   │   ├── ... (uno por topico)
│   │   └── base.py               # interfaz comun
│   ├── dbt/                      # transformaciones
│   │   ├── models/
│   │   │   ├── staging/          # crudo a tipado
│   │   │   ├── intermediate/     # joins, dedup
│   │   │   ├── marts/            # facts y dims finales por topico
│   │   │   └── metrics/          # ratios calculados (ROA, ROE, mora, etc)
│   │   ├── tests/                # dbt-expectations
│   │   ├── seeds/                # tablas de mapeo (cuentas, regiones, etc)
│   │   └── dbt_project.yml
│   └── cube/                     # semantic layer
│       ├── model/                # *.yml por cubo
│       │   ├── eeff.yml
│       │   ├── colocaciones.yml
│       │   ├── depositos.yml
│       │   └── ... 
│       └── cube.py               # data sources, security context
│
├── infrastructure/
│   ├── postgres/
│   │   ├── migrations/           # numeradas V001_, V002_, idempotentes
│   │   └── rls/                  # policies RLS por tabla
│   ├── prefect/                  # despliegue de deployments + schedules
│   └── docker/                   # Dockerfiles por servicio
│
├── docs/
│   ├── ARCHITECTURE.md           # este archivo
│   ├── adr/                      # decisiones arquitectonicas
│   ├── runbooks/                 # operacion (que hacer si X falla)
│   ├── data-dictionary/          # cuenta x cuenta SBS
│   └── api/                      # OpenAPI generado
│
├── .github/workflows/            # CI/CD
├── package.json                  # workspace root (pnpm)
├── pnpm-workspace.yaml
└── README.md
```

**Convencion de monorepo:** pnpm workspaces para apps/packages TS. Python (api, data-platform) usa uv como package manager (rapido, lockfile reproducible).

---

## 3. Modelo de datos (PostgreSQL)

### 3.1 Esquemas

```sql
CREATE SCHEMA auth;          -- usuarios, orgs, sesiones (manejado por Clerk webhook sync)
CREATE SCHEMA billing;       -- subs, facturas, invoices (sync desde Stripe)
CREATE SCHEMA tenant;        -- config por tenant, branding white-label
CREATE SCHEMA raw;           -- datos crudos del scraping (staging)
CREATE SCHEMA dw;            -- dimensiones y facts del DW (star schema)
CREATE SCHEMA marts;         -- vistas materializadas por dashboard
CREATE SCHEMA api;           -- views read-only que expone la API
CREATE SCHEMA audit;         -- audit log multi-tenant
```

### 3.2 Multi-tenancy: pattern

**Decision:** RLS pooled multi-tenant (no schema-per-tenant).
- Mas barato (1 DB), mas escalable (100, 1000, 10000 tenants).
- Cada tabla con tenant-scope tiene `tenant_id UUID NOT NULL`.
- RLS policies activan filtro automatico segun `current_setting('app.tenant_id')`.
- FastAPI middleware setea ese GUC al inicio de cada request post-auth.

```sql
-- ejemplo de tabla tenant-scoped (auditoria de descargas):
CREATE TABLE audit.event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit.event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit.event_log
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Importante:** el DW (`dw.*`) es **compartido entre todos los tenants** porque la data SBS es publica. RLS no aplica ahi. La diferenciacion por plan se hace en la **API layer** (que entidades / que profundidad historica / si puede exportar).

### 3.3 Star schema DW (dw.*)

**Dimensiones comunes:**
- `dw.dim_tiempo` — un row por mes. Atributos: anio, mes, trimestre, semestre, mes_nombre, periodo_iso (YYYY-MM).
- `dw.dim_entidad` — un row por institucion SBS. Atributos: codigo_sbs, nombre, nombre_corto, grupo (banca_multiple, financiera, cmac, crac, edpyme), subgrupo (microfinanciera_si/no), activa, fecha_inicio, fecha_fin.
- `dw.dim_moneda` — PEN, USD, total (consolidado).
- `dw.dim_cuenta` — catalogo regulatorio: codigo (A1_DISPONIBLE, A1_1_CAJA, ...), nombre, jerarquia (parent_codigo para tree), tipo_estado (BG | ER | NOTAS), nivel.
- `dw.dim_geografia` — departamento, provincia, distrito, region (norte/centro/sur), zona urbano/rural.
- `dw.dim_tipo_credito` — corporativo, gran_empresa, mediana_empresa, pequena_empresa, microempresa, consumo_revolvente, consumo_no_revolvente, hipotecario.
- `dw.dim_tipo_deposito` — vista, ahorro, plazo, cts.

**Facts (skinny-long, particionadas por anio):**

```sql
-- fact universal: cubre todos los topicos via dim_cuenta
CREATE TABLE dw.fact_observacion (
  id BIGSERIAL,
  periodo_id INT NOT NULL REFERENCES dw.dim_tiempo(id),
  entidad_id INT NOT NULL REFERENCES dw.dim_entidad(id),
  cuenta_id INT NOT NULL REFERENCES dw.dim_cuenta(id),
  moneda_id SMALLINT NOT NULL REFERENCES dw.dim_moneda(id),
  geografia_id INT REFERENCES dw.dim_geografia(id),   -- nullable
  tipo_credito_id SMALLINT REFERENCES dw.dim_tipo_credito(id),
  tipo_deposito_id SMALLINT REFERENCES dw.dim_tipo_deposito(id),
  valor NUMERIC(20, 2) NOT NULL,
  PRIMARY KEY (id, periodo_id)
) PARTITION BY RANGE (periodo_id);

-- pg_partman crea particiones por anio:
-- dw.fact_observacion_2010, ..., dw.fact_observacion_2026

CREATE INDEX idx_fact_obs_entidad_periodo ON dw.fact_observacion (entidad_id, periodo_id);
CREATE INDEX idx_fact_obs_cuenta ON dw.fact_observacion (cuenta_id);
```

**Por que skinny-long y no una fact-por-topico:**
- Un solo cubo en Cube.dev simplifica el modelo semantico.
- Permite ratios cross-topico (ej: ROE = utilidad / patrimonio) sin joins enormes.
- Postgres con buenos indexes y particion lo soporta.
- La unica complicacion es la pivot para vistas tipo "estado de resultados ancho" — se resuelve con vistas materializadas en `marts.*`.

**Marts (vistas materializadas refrescadas tras cada carga mensual):**
- `marts.mv_eeff_ancho` — pivot por cuenta para mostrar BG/ER como tabla clasica.
- `marts.mv_ratios_mensuales` — ROE, ROA, mora, eficiencia, liquidez por entidad x mes.
- `marts.mv_ranking_grupo` — top 10 por colocaciones / depositos / etc por mes.
- `marts.mv_evolucion_anual` — comparativa anio vs anio.

### 3.4 Tablas de aplicacion (tenant + auth + billing)

```sql
-- sync desde Clerk
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,                    -- mismo id que Clerk
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant.organizations (
  id UUID PRIMARY KEY,                    -- mismo id que Clerk org
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',     -- trial | starter | pro | business | enterprise
  trial_ends_at TIMESTAMPTZ,
  branding JSONB,                         -- logo, colores, dominio custom
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant.memberships (
  org_id UUID NOT NULL REFERENCES tenant.organizations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  PRIMARY KEY (org_id, user_id)
);

-- sync desde Stripe webhooks
CREATE TABLE billing.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES tenant.organizations(id),
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,                   -- active, past_due, canceled, trialing
  plan TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing.entitlements (
  org_id UUID PRIMARY KEY REFERENCES tenant.organizations(id),
  grupos_acceso TEXT[] NOT NULL,          -- ['cmac', 'crac', ...]
  topicos_acceso TEXT[] NOT NULL,
  meses_historico INT NOT NULL,            -- 6, 24, 60, -1 (todo)
  max_users INT NOT NULL,
  export_pdf BOOLEAN NOT NULL,
  export_excel BOOLEAN NOT NULL,
  api_enabled BOOLEAN NOT NULL,
  api_quota_monthly INT
);

-- saved views, alertas, exports
CREATE TABLE tenant.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES tenant.organizations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL,                    -- 'private' | 'org'
  filters JSONB NOT NULL,
  visualization JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES tenant.organizations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,             -- 'ratio_changes', 'new_data', 'anomaly'
  config JSONB NOT NULL,
  channels TEXT[] NOT NULL,               -- ['email', 'webhook']
  active BOOLEAN NOT NULL DEFAULT true
);
```

Todas las tablas en `tenant.*` y `audit.*` y `billing.*` tienen RLS habilitado.

---

## 4. Pipeline de ingesta

### 4.1 Flujo mensual orquestado por Prefect

```
[cron mensual dia 5]
    |
    v
[discover_meses_pendientes]  --> compara catalogo SBS vs ultimo cargado
    |
    v
[scrape_metadata]            --> lista exacta de .xls a bajar
    |
    v
[fan_out: descarga paralela]  --> N workers Playwright (concurrency 10)
    |   |
    |   +-- valida: tamano, no-vacio, columnas esperadas
    |   +-- sube a R2: raw/sbs/{grupo}/{topico}/{anio}/{mes}/{archivo}.xls
    |
    v
[parse_a_postgres]           --> pandas + pydantic, carga a raw.* schema
    |
    v
[dbt_run --target prod]      --> staging -> intermediate -> marts
    |
    v
[dbt_test]                   --> validaciones (totales cuadran, sin nulls, etc)
    |
    v
[refresh_materialized_views] --> CONCURRENTLY para no bloquear
    |
    v
[cube_warm_cache]            --> pre-agregar dashboards principales
    |
    v
[notify: success]            --> Slack/email "carga marzo 2026 ok"
                              |
                              +--> trigger alertas activas tenants
```

### 4.2 Politica de reintentos y observabilidad

- Cada step Prefect: max 3 retries con backoff exponencial (60s, 300s, 900s).
- Si una entidad falla pero el resto pasa, no abortamos el job — registramos en `audit.ingestion_failures` y notificamos.
- Slack channel `#sbs-ingestion-alerts` recibe resumen de cada corrida (cuanto se cargo, cuanto fallo).
- Sentry captura excepciones inesperadas.
- Cada fila parseada lleva `_raw_file`, `_loaded_at`, `_loaded_by_run_id` para trazabilidad.

### 4.3 Idempotencia

- DDL `raw.*` con `(periodo, entidad_codigo_sbs, fila_archivo) UNIQUE`. Re-correr una carga upserta, no duplica.
- Marts con `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- dbt usa `incremental` materialization donde hace sentido (facts grandes), `table` para dims.

---

## 5. Capa semantica (Cube.dev)

### 5.1 Por que Cube.dev y no SQL directo desde la API

- Define metricas una vez (`ROA`, `mora`, `ratio_liquidez`), las consume web + API + futuro Excel plugin.
- Cache automatico con invalidacion al refresh de marts.
- Security context permite filtrar por entidades autorizadas segun plan (lee `billing.entitlements`).
- API REST + GraphQL + SQL — la web usa REST, los clientes Business+ usan API SQL como si fuera una DB.

### 5.2 Esquema ejemplo

```yaml
# data-platform/cube/model/eeff.yml
cubes:
  - name: Eeff
    sql_table: marts.mv_eeff_ancho
    
    joins:
      - name: Entidad
        sql: "{CUBE}.entidad_id = {Entidad}.id"
        relationship: many_to_one
      - name: Tiempo
        sql: "{CUBE}.periodo_id = {Tiempo}.id"
        relationship: many_to_one

    measures:
      - name: total_activos
        sql: total_activos
        type: sum
        format: currency
      - name: utilidad_neta
        sql: utilidad_neta
        type: sum
        format: currency
      - name: roa
        sql: "100 * SUM(utilidad_neta) / NULLIF(SUM(total_activos), 0)"
        type: number
        format: percent
        meta: {description: "Retorno sobre activos"}
      - name: roe
        sql: "100 * SUM(utilidad_neta) / NULLIF(SUM(patrimonio), 0)"
        type: number
        format: percent

    dimensions:
      - name: entidad_id
        sql: entidad_id
        type: number
        primary_key: true
      - name: periodo_id
        sql: periodo_id
        type: number

    pre_aggregations:
      - name: por_entidad_mes
        measures: [total_activos, utilidad_neta, roa, roe]
        dimensions: [Entidad.grupo, Entidad.nombre, Tiempo.anio, Tiempo.mes]
        time_dimension: Tiempo.fecha
        granularity: month
        refresh_key:
          every: 1 hour
```

### 5.3 Multi-tenant en Cube

```python
# cube.py
def query_rewrite(query, security_context):
    org_id = security_context['org_id']
    ent = get_entitlements(org_id)
    
    if 'Entidad.grupo' in query['dimensions'] or any(...):
        query['filters'].append({
            'dimension': 'Entidad.grupo',
            'operator': 'in',
            'values': ent['grupos_acceso']
        })
    
    cutoff = months_ago(ent['meses_historico'])
    query['filters'].append({
        'dimension': 'Tiempo.fecha',
        'operator': 'afterDate',
        'values': [cutoff.isoformat()]
    })
    
    return query
```

---

## 6. Backend API (FastAPI)

### 6.1 Capas (clean architecture)

```
app/
├── domain/               # entidades, value objects, dominio puro (sin imports de infra)
│   ├── entidad.py
│   ├── topico.py
│   ├── periodo.py
│   └── plan_entitlements.py
├── application/          # use cases, orquestan dominio
│   ├── consultar_dashboard.py
│   ├── exportar_pdf.py
│   ├── crear_alerta.py
│   └── ...
├── infrastructure/       # adapters (impl de interfaces de dominio)
│   ├── repositories/     # SQLAlchemy
│   ├── cube_client.py
│   ├── stripe_client.py
│   ├── clerk_webhook.py
│   ├── nubefact_client.py
│   └── r2_storage.py
├── routers/              # FastAPI endpoints, solo orquestan use cases
│   ├── dashboards.py
│   ├── entidades.py
│   ├── exports.py
│   ├── alerts.py
│   ├── billing.py
│   └── webhooks.py
└── middleware/
    ├── auth.py           # valida JWT Clerk, setea contexto
    ├── rls.py            # SET LOCAL app.tenant_id = ...
    ├── rate_limit.py
    └── entitlements.py   # bloquea acceso a recurso no autorizado por plan
```

### 6.2 Endpoints clave

```
GET  /v1/health
GET  /v1/me                                  # perfil + org + plan
GET  /v1/entidades?grupo=cmac&q=arequipa     # buscar entidades autorizadas
GET  /v1/dashboards/eeff?entidad=...&desde=...&hasta=...
GET  /v1/dashboards/colocaciones?...
GET  /v1/comparador?entidades=1,2,3&metrica=roe
POST /v1/exports/pdf                         # genera PDF async, devuelve job_id
GET  /v1/exports/{job_id}                    # polling status
GET  /v1/exports/{job_id}/download           # signed URL R2
POST /v1/alerts
GET  /v1/alerts
DELETE /v1/alerts/{id}
GET  /v1/data/raw?cubo=eeff&...              # solo plan Business+, query metered

POST /v1/webhooks/stripe                     # subscription created/updated/deleted
POST /v1/webhooks/clerk                      # user.created, org.created, etc
```

### 6.3 Convenciones API

- Respuesta JSON con `{ data, meta, errors }` consistente.
- Paginacion cursor-based para listas grandes.
- Versionado en el path (`/v1/`) — bump cuando haya breaking change.
- OpenAPI auto-generado, expuesto en `/docs` (prod: solo para admins).
- Rate limiting por org_id + endpoint via Redis.
- Idempotency-Key header en POSTs que crean recursos cobrables.

---

## 7. Frontend (Next.js 15)

### 7.1 Estructura

```
apps/web/app/
├── (marketing)/
│   ├── page.tsx                  # landing
│   ├── pricing/
│   ├── blog/                     # SEO content
│   ├── docs/                     # publica para crawler
│   └── sobre/
├── (auth)/
│   ├── sign-in/[[...rest]]/
│   └── sign-up/[[...rest]]/
├── (app)/
│   ├── layout.tsx                # sidebar, topbar, org switcher
│   ├── page.tsx                  # home dashboard
│   ├── eeff/
│   ├── colocaciones/
│   ├── depositos/
│   ├── castigos/
│   ├── clientes/
│   ├── oficinas/
│   ├── personal/
│   ├── indicadores/
│   ├── comparador/
│   ├── reportes/
│   ├── alertas/
│   ├── exports/
│   └── settings/
└── api/                          # solo callbacks: stripe webhook proxy si hace falta
```

### 7.2 Dashboards canonicos (MVP)

Cada uno con la misma "espina":
1. **Filtros sticky** arriba: rango de fecha, entidad(es), moneda, grupo.
2. **Hero KPIs** (4 cards): valores mes vs mes anterior + variacion + sparkline.
3. **Grafico principal** (evolucion temporal o ranking).
4. **Tabla detallada** con drill-down a cuenta hijo.
5. **Boton "exportar"** (PDF / Excel / Imagen) si plan lo permite.
6. **Boton "explicame"** (futuro, IA): genera narrativa.

Lista MVP:
- **Estados Financieros** — Balance + GyP por entidad / grupo / consolidado.
- **Colocaciones** — saldo por tipo de credito + variacion + ranking + por moneda.
- **Depositos** — captaciones por tipo + costo de fondeo implicito.
- **Castigos** — write-offs vs cartera vencida, evolucion.
- **Clientes** — # clientes credito vs ahorro, ticket promedio.
- **Oficinas / Geografia** — heatmap Peru por colocaciones / depositos.
- **Personal** — # empleados vs colocaciones (productividad).
- **Indicadores regulatorios** — liquidez, solvencia, calidad, rentabilidad con semaforos vs limites SBS.
- **Comparador** — multi-entidad multi-metrica, hasta 5 a la vez.
- **Reportes mensuales** — PDF auto-generado del cierre, branded.

### 7.3 Design system

- Paleta: dos opciones de tematica (claro/oscuro), no dictar todavia. Acentos sobrios: azul corporativo + neutros + verde/rojo para variaciones.
- Tipografia: Inter o Geist (variable, gratis, optimizada para SaaS).
- Componentes base: shadcn/ui (Button, Card, Sheet, Dialog, Select, Combobox, Table, Tabs, etc).
- Componentes domain: `EntidadPicker`, `PeriodoRangoPicker`, `MetricaKpiCard`, `GraficoEvolucion`, `TablaCuentasJerarquica`, `MonedaToggle`, `ExportButton`.
- Loading states: skeletons, nunca spinners pelados.
- Empty states: ilustracion + CTA contextual (no "no data" pelado).

### 7.4 Performance budget

- LCP landing < 1.8s mobile, < 1.2s desktop.
- Dashboard primer paint < 1.5s, interactivo < 2.5s.
- Bundle JS inicial < 200kb gzip.
- Imagenes via `next/image` con AVIF + WebP fallback.
- Charts client-side solo donde haya interactividad; sino server-rendered.

---

## 8. Auth y multi-tenancy

### 8.1 Auth con Clerk

- Sign-up: email/password + Google + Microsoft (corporativos B2B).
- MFA opcional en Pro, obligatorio en Business+.
- Organizaciones nativas (1 user puede pertenecer a N orgs).
- Roles dentro de org: owner, admin, member, viewer.
- Invitacion por email con limite segun plan.

### 8.2 Sync Clerk -> Postgres via webhooks

- `user.created` -> upsert `auth.users`
- `organization.created` -> insert `tenant.organizations` con plan='trial', trial_ends_at = +14d
- `organizationMembership.created` -> insert `tenant.memberships`
- Webhook handler idempotente y firma verificada.

### 8.3 Request lifecycle

```
1. Browser request con Clerk session token
2. Next.js middleware valida session, propaga a backend
3. FastAPI middleware:
   a. Verifica JWT (jose lib)
   b. Resuelve org_id activa (del token)
   c. Pull entitlements (cache Redis 60s)
   d. Set GUC: SET LOCAL app.tenant_id = '<org_id>'
   e. Set GUC: SET LOCAL app.user_id = '<user_id>'
4. Endpoint corre. RLS filtra automatico para tablas tenant-scoped.
5. Para queries de DW: la API antes de llamar Cube valida que entidad/periodo solicitado este dentro de entitlements.
```

---

## 9. Billing (Stripe + Nubefact)

### 9.1 Productos Stripe (Catalog)

| Plan | Precio mes | Anual (-20%) | Grupos | Historico | Usuarios | Export | API |
|---|---|---|---|---|---|---|---|
| Free / Trial 14d | USD 0 | - | 1 grupo | 6 meses | 1 | No | No |
| Starter | 49 | 470/anio | 1 grupo | 24 meses | 1 | PDF | No |
| Pro | 149 | 1430/anio | 3 grupos | 60 meses | 5 | PDF+Excel | No |
| Business | 399 | 3830/anio | Todos | Todo | 15 | + API 10k req/mes | Si |
| Enterprise | Custom | Custom | Todos + white-label | Todo | Ilimitado | + API ilimitada + SLA | Si |

**Trial:** Free incluido automatico en signup, no requiere tarjeta. Convierte a Starter al fin del trial si carga tarjeta.

### 9.2 Webhooks Stripe -> sincronizan `billing.subscriptions` y `billing.entitlements`

- `customer.subscription.created` / `updated` / `deleted`
- `invoice.paid` / `invoice.payment_failed`
- Si falla pago: org pasa a `past_due`, mantenemos acceso 7d con banner, despues bloqueo a read-only.

### 9.3 Facturacion electronica Peru

- Cuando customer paga, generar comprobante via Nubefact API.
- Tipo: factura (RUC) o boleta (DNI).
- Almacenar PDF + XML en R2, accesible desde `/settings/facturas`.

---

## 10. Deployment

### 10.1 Ambientes

- `dev`: local con docker-compose (postgres, redis, cube, prefect).
- `staging`: rama `staging` -> auto-deploy. URL `staging.sbsinsights.com`.
- `prod`: rama `main` -> auto-deploy con approval manual.

### 10.2 Infra inicial (costo bajo)

- **Vercel**: web (free hasta 100GB bw, despues USD 20/mes Pro).
- **Railway**: api + worker + cube + prefect + postgres + redis. ~USD 30-60/mes con todo.
- **Cloudflare R2**: storage. ~USD 5/mes los primeros 100GB.
- **Clerk**: free hasta 10k MAU, despues USD 25/mes base.
- **Sentry**: free dev plan.
- **PostHog**: free hasta 1M events/mes.
- **Resend**: 3000 emails/mes gratis.
- **Doppler**: free hasta 5 personas.
- **Domain**: USD 12/anio.

**Total estimado mes 1-6:** ~USD 80-100/mes.

### 10.3 Cuando escalar

| Trigger | Accion |
|---|---|
| >50 orgs activas | Postgres dedicado en RDS o Neon, no Railway shared |
| >500 dashboard requests/min | Replica read + cache Redis layer |
| >5k MAU | Clerk Pro |
| Tenant Enterprise pide SLA | Multi-AZ Postgres + uptime monitor + on-call |
| Latencia LATAM > 200ms | Edge cache via Cloudflare en front de API |

---

## 11. Observabilidad y operacion

- **Sentry**: errores backend + frontend, source maps, alertas Slack para errores nuevos.
- **PostHog**: funnel signup, retencion, feature flags (rollout gradual), session replay para soporte.
- **Better Stack**: logs centralizados, dashboards de uptime.
- **Prefect UI**: estado de jobs ETL, logs por run.
- **Cube.dev Cloud (opcional)**: dashboards de cache hit rate.
- **Runbooks** en `docs/runbooks/`: que hacer si...
  - el scraping falla 3 meses seguidos
  - se cae el Cube y dashboards no cargan
  - un cliente reporta data incorrecta (proceso de reproceso)
  - Stripe webhook deja de llegar

---

## 12. Seguridad y compliance

- **Secrets**: Doppler/Infisical, nunca en repo. Rotacion trimestral de keys API.
- **Backups**: Postgres daily PITR (Railway o managed). Retention 30d. Test restore mensual.
- **Encriptacion**: TLS 1.3 en transito, AES-256 at rest (provider default).
- **Audit log**: cada accion sensible (export, cambio de plan, invitacion) en `audit.event_log`.
- **Ley 29733 (Peru, proteccion datos personales)**:
  - Politicas de privacidad y terminos visibles.
  - Consentimiento explicito en signup.
  - Boton "exportar mis datos" + "eliminar mi cuenta" en `/settings`.
  - No PII en logs INFO/DEBUG.
  - Registro de bases de datos ante ANPD si aplica.
- **GDPR-like patterns** por si entran clientes EU/Espana.
- **Rate limiting** en signup y endpoints publicos para frenar abuso.
- **CSP headers** estrictos en Next.js.

---

## 13. Fases de implementacion (14-18 semanas full-time)

### Fase 0 — Setup (semana 1)
- [ ] Repo monorepo con estructura definida.
- [ ] CI/CD basico (lint, test, build).
- [ ] Postgres dev en docker-compose.
- [ ] Clerk + Stripe en modo test.
- [ ] Skeleton Next.js + FastAPI hablandose ("hola mundo" auth).

### Fase 1 — Ingestion engine (semanas 2-4)
- [ ] Scraper Playwright SBS funcional para los 5 grupos.
- [ ] Parser generico .xls -> raw schema para los 10 topicos.
- [ ] dbt project con staging models y 1 mart end-to-end (EEFF).
- [ ] Prefect deployment con cron mensual + alertas.
- [ ] Carga historica completa 2010-2026 (one-shot, dejar corriendo).

### Fase 2 — Modelado DW completo (semanas 5-7)
- [ ] dbt models para los 10 topicos.
- [ ] Marts: eeff_ancho, ratios_mensuales, ranking_grupo, evolucion_anual.
- [ ] Validaciones dbt-expectations.
- [ ] Diccionario de datos en `docs/data-dictionary/` (autogenerado de dbt docs).

### Fase 3 — Semantic layer + API (semanas 8-9)
- [ ] Cube.dev con cubos para los 10 topicos.
- [ ] Pre-aggregations para los dashboards principales.
- [ ] FastAPI con endpoints de dashboards + entidades + me.
- [ ] Middleware auth + entitlements + RLS.
- [ ] Webhook Clerk + sync usuarios/orgs.

### Fase 4 — Frontend MVP (semanas 10-13)
- [ ] Landing publica + pricing.
- [ ] Onboarding signup -> trial dashboard en < 90s.
- [ ] 10 dashboards canonicos.
- [ ] Comparador multi-entidad.
- [ ] Exports PDF + Excel.

### Fase 5 — Billing + go-live (semanas 14-15)
- [ ] Stripe Billing + checkout.
- [ ] Webhook Stripe + sync entitlements.
- [ ] Nubefact integration para facturacion.
- [ ] Dunning flow.
- [ ] Soft launch a los 5 leads (beta paga 50% off primer trimestre).

### Fase 6 — Pulido + Alertas + IA (semanas 16-18)
- [ ] Alertas configurables (cambio en ratio > X%, nuevo cierre publicado).
- [ ] Boton "explicame" — narrativa generada por IA del dashboard actual.
- [ ] Mejoras UX basadas en feedback beta.
- [ ] Onboarding emails + drip.
- [ ] Lanzamiento publico.

---

## 14. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| SBS cambia layout de su web y rompe scraper | Alta | Alto | Tests de validacion en cada corrida + parser modular por version + alerta inmediata |
| Volumen 200M filas mata performance | Media | Alto | Particionado pg_partman + pre-agg Cube + materialized views + EXPLAIN regular |
| Pocos clientes pagan al lanzar | Media | Alto | Validar pricing con 5 leads antes de codear billing. Tener plan Starter "barato" como anchor |
| Quema de runway construyendo solo | Alta | Medio | Lanzar Fase 1 (ETL+DW) y vender consultoria interim a Caja Arequipa o ex-clientes |
| Competidor (Equilibrium, BCR) lanza algo similar | Baja | Alto | Velocidad + nicho microfinanzas + UX > grandes |
| Postgres se queda chico | Baja | Medio | Migrable a Neon serverless o ClickHouse si OLAP explota |
| Vendor lock Vercel/Railway | Baja | Bajo | Stack portable: Docker compose dev mirror + IaC docs |
| Clerk se cae | Baja | Alto | Status page + fallback sign-in pagina estatica + considerar Supabase Auth como backup |

---

## 15. Decisiones abiertas (pendientes)

1. **Nombre comercial y dominio.**
2. **Idioma de codigo:** confirmar Python backend + TS frontend (asumido). Alternativa: full TS con Node + Drizzle.
3. **Cube.dev OSS self-hosted vs Cube Cloud:** OSS para arrancar, Cloud si crece > USD 200/mes vale la pena.
4. **Hosting Postgres final:** Railway shared (MVP) vs Neon (serverless) vs Supabase (auth+db combinado, ahorra Clerk).
5. **Pricing exacto:** confirmar con entrevistas a 5 leads antes de codear billing.
6. **Branding:** logo, paleta, tipografia. Sesion de design system en Fase 4.
7. **Whitelabel en Enterprise:** alcance (custom CSS, dominio, logos solo).
8. **API publica metered:** OpenAPI spec + dev portal? Postman collection?
9. **Mobile:** ¿app o PWA? Decision en Fase 6 o post-launch.

---

## 16. Proxima accion concreta

Antes de codear:
1. **Decidir nombre + dominio.**
2. **Hacer 5 entrevistas a los leads que preguntaron precio** (script en `docs/research/customer-interviews-v1.md`).
3. **Aprobar este documento o iterarlo.**

Despues: empezar Fase 0 (setup repo).

---

## Apendice A: glosario rapido

- **DW**: Data Warehouse. Base de datos optimizada para consulta analitica, no transaccional.
- **Star schema**: modelo dimensional con tablas de hechos al centro y dimensiones al borde.
- **dbt**: data build tool. Define transformaciones SQL versionables con tests y docs.
- **Semantic layer**: capa intermedia que abstrae metricas para reusarlas desde varios consumidores.
- **Pre-aggregation**: tabla rollup precomputada para acelerar queries.
- **RLS**: Row-Level Security. Postgres filtra filas automatico segun usuario.
- **GUC**: Grand Unified Configuration. Variable de sesion Postgres (usamos `app.tenant_id`).
- **Entitlement**: lo que el plan de un cliente le permite hacer.
- **Dunning**: proceso automatico de cobranza cuando un pago falla.
