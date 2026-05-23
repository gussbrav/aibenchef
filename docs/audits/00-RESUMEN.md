# Auditoría Aibenchef — Resumen Ejecutivo

**Fecha**: 2026-05-23
**Auditor**: Claude Opus 4.7 (sesión interactiva con Gus)
**Alcance**: 6 grupos de flujos + benchmark del producto cliente
**Estado**: post-fix Análisis Dinámico, pre-implementación del panel de Ingesta

---

## TL;DR

El sistema técnico **funciona pero es teatro** respecto al producto que el cliente quiere comprar.

- **Capa de ingesta + base de datos**: sólida (verde/amarillo). Las MVs sirven datos reales SBS, el `Análisis Dinámico` funciona, hay 86 entidades cargadas.
- **Capa de transformación dbt**: rota (rojo). El único modelo apunta a `raw.eeff` (no existe; la tabla real es `raw.eeff_observacion`). El workflow mensual ejecuta `dbt run` pero no produce nada útil. Las MVs reales se mantienen por SQL en migraciones, no por dbt.
- **Capa de APIs**: amarilla. Auth ausente en `/api/v1/pivot/*`, `/eeff/*`, `/entidades` (DoS gratis). Bug runtime en `listEntidades` con filtro `tipo_entidad`. Sin tests de integración.
- **Workflow mensual GH Action**: roto (rojo). Llama `python -m scrapers.sbs.cli` que no existe; el CLI real es `aibenchef`. Y `dbt run` corre desde el cwd equivocado.
- **Frontend dashboard**: amarillo. App Router bien aplicado. **Cero `loading.tsx`/`error.tsx`/`not-found.tsx`** en toda la app. Nav mobile inexistente. React Query instalado pero no usado.

**Y el hallazgo más importante**: existe en `D:\PROYECTO\SBS\Benchmark\` el deliverable real del cliente (Caja Arequipa, 45 slides PPT + Excel 64 sheets). El producto actual es un dashboard interactivo tipo Tableau, pero **el cliente quiere un generador de informes ejecutivos brandeados**. Ver `PRODUCT_VISION.md` para el gap completo.

---

## Veredictos por flujo

| # | Flujo | Estado | Hallazgo más serio |
|---|---|---|---|
| 1 | Ingesta (scrape + storage + GH Action) | 🔴 ROJO | Workflow mensual desconectado del CLI real |
| 2 | Catálogo (seeds + maestra + normalize) | 🟡 AMARILLO | 0% tests; `cuentas_indicadores.json` huérfano |
| 3 | Loading (import histórico + mensual) | 🟡 AMARILLO | Cache cruzado periodo en `_PositionLookup` |
| 4 | Transformación (dbt + MVs) | 🔴 ROJO | dbt es teatro — único modelo apunta a tabla inexistente |
| 5 | APIs v1 | 🟡 AMARILLO | Endpoints analytics sin auth |
| 6 | Frontend dashboard | 🟡 AMARILLO | Sin error boundaries; nav mobile rota |

---

## Detalles por archivo

- `01-ingesta.md` — Scrape, storage, GitHub Action mensual.
- `02-catalogo.md` — Seeds, init-maestra, detectar-cambios, normalize-entidades.
- `03-loading.md` — BaseEeffImporter (histórico) y MonthlyEeffImporter.
- `04-transformacion.md` — dbt + las 3 MVs + wrapper V026.
- `05-apis.md` — Inventario completo de `/api/v1/*` + seguridad + tests.
- `06-frontend.md` — Páginas del dashboard + patrones + accesibilidad.
- `../PRODUCT_VISION.md` — Lo que el cliente realmente quiere (con base en Benchmark/).
- `../FIXES_APLICADOS.md` — Fixes críticos aplicados durante la auditoría.

---

## Top 10 acciones prioritarias (extracto de todas las auditorías)

| # | Severidad | Acción | Costo aprox |
|---|---|---|---|
| 1 | 🔴 Crítica | Arreglar `monthly-sbs-ingestion.yml`: `python -m scrapers.sbs.cli` → `uv run aibenchef ingest` | 15 min |
| 2 | 🔴 Crítica | Arreglar `dbt run` path: `--project-dir dbt --profiles-dir dbt` | 5 min |
| 3 | 🔴 Crítica | Agregar auth a `/api/v1/pivot/*`, `/eeff/*`, `/entidades` (DoS abierto) | 1 h |
| 4 | 🔴 Crítica | `app/dashboard/error.tsx` y `loading.tsx` — sin esto, un fallo en page.tsx tira pantalla en blanco | 30 min |
| 5 | 🔴 Crítica | Fix `withTenant` race condition antes de cualquier feature multi-tenant | 2 h |
| 6 | 🟠 Alta | Fix bug runtime en `listEntidades` con filtro `tipo_entidad` (`analytics/queries.ts:36`) | 15 min |
| 7 | 🟠 Alta | Conectar `HttpxDownloader` con `raw.archivos_descargados` (hoy son dos pipelines desacoplados) | 4 h |
| 8 | 🟠 Alta | Decidir: ¿dbt o no dbt? Si sí, reemplazar las MVs SQL por modelos dbt | 1-2 días |
| 9 | 🟡 Media | Helper `requireSession()` + `requireAdminSession()` (DRY auth) | 2 h |
| 10 | 🟡 Media | Tests de integración para pivot, importers, users authz | 1-2 días |

Las acciones de "reframe del producto" (informes PPT/PDF, motor de Punto de Equilibrio, peer groups) están en `PRODUCT_VISION.md`.
