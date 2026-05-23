# Fixes aplicados durante la auditoría 2026-05-23

Esta sesión aplicó 5 fixes críticos sobre los hallazgos documentados en `audits/`. Cada fix incluye archivo, línea, antes/después y referencia al hallazgo.

---

## Fix 1 — Análisis Dinámico: cambio de fuente rompía con "Columna no permitida"

**Origen**: bug visible en captura del usuario. Cambiar fuente (Balance → Resultados) tiraba banner rojo y mostraba columnas viejas.

**Archivo**: `apps/web/app/dashboard/analisis/analisis-client.tsx:47-87`

**Causa**: `DEFAULT_CONFIG.medidas = ["cta_a", "cta_b", "cta_c"]` son columnas SOLO del Balance. Al cambiar fuente, solo se actualizaba `config.fuente`; las medidas viejas seguían en el state, el auto-ejecutor disparaba el pivot con columnas inexistentes en el mart nuevo, y el backend validaba con `Columna no permitida en medidas: cta_a`. Como `resultado` no se limpiaba, la grilla seguía mostrando data del Balance.

**Fix aplicado**: en el `useEffect` que carga columnas al cambiar fuente:
1. `setResultado(null)` antes del fetch — adiós a la grilla stale.
2. Tras recibir las columnas nuevas, podar `config.medidas` y `config.dimensiones` para quedarse solo con las que existen en el nuevo schema (en lugar de borrarlas todas).

El guard existente (`config.medidas.length === 0` no auto-ejecuta) se encarga de no disparar pivot con medidas vacías.

---

## Fix 2 — Workflow mensual GH Action: `python -m scrapers.sbs.cli` no existe

**Origen**: `audits/01-ingesta.md` hallazgo crítico — el cron del día 5 viene fallando silenciosamente desde que se renombró el paquete a `aibenchef_data`.

**Archivo**: `.github/workflows/monthly-sbs-ingestion.yml`

**Cambios**:
- Cron: día 5 → **día 15** (SBS publica entre día 30-45 del mes siguiente; día 5 es demasiado temprano).
- Reemplazado `python -m scrapers.sbs.cli ingest` por **5 steps explícitos**:
  1. `uv run aibenchef scrape --periodo "${PERIODO:-}"` — descarga al storage local
  2. `uv run aibenchef storage scan` — registra archivos en `raw.archivos_descargados`
  3. `uv run aibenchef import monthly-eeff ./local-data/raw` — carga a `raw.eeff_observacion`
  4. `uv run aibenchef catalog normalize-entidades` — normaliza nombres
  5. `uv run aibenchef db refresh-mvs --concurrently` — refresca MVs
- `dbt run` **comentado** hasta que se reconcilien los sources (`audits/04-transformacion.md`). El único modelo apuntaba a `raw.eeff` que no existe. Mientras tanto los marts se mantienen por SQL.
- Quitados secrets `R2_*` que nadie lee.
- `defaults.run.working-directory: data-platform` — todos los steps corren ahí.

**Resultado esperado**: la próxima corrida (manual via `gh workflow run` o automática) procesa el período completo end-to-end.

---

## Fix 3 — `listEntidades()` runtime crash con filtro `tipo_entidad`

**Origen**: `audits/05-apis.md` hallazgo E1.

**Archivo**: `apps/web/lib/domains/analytics/queries.ts:29-72`

**Causa**: el código armaba placeholders `$1` en el string SQL y los pasaba a `sql.raw()`. Pero `sql.raw()` de drizzle **no substituye placeholders** — solo concatena el string literalmente. Cuando se llama `/api/v1/entidades?tipo_entidad=CajaMunicipal`, PG ve `e.tipo_entidad = $1` sin binding y lanza `42P02 parameter "$1" not present`. Solo funcionaba el caso sin filtros.

**Fix**: convertido a `sql` tag de drizzle (que sí bindea parámetros). Los fragmentos condicionales se arman con `sql\`AND ...\`` o `sql\`\`` y se interpolan en el query principal.

**Health check**: `curl /api/v1/entidades?tipo_entidad=CajaMunicipal` ahora devuelve filas en lugar de 500.

---

## Fix 4 — Endpoints analytics sin autenticación (vector de DoS)

**Origen**: `audits/05-apis.md` hallazgo C1 (crítico).

**Archivos nuevos**:
- `apps/web/lib/domains/shared/auth-helpers.ts` — helpers `requireSession()` y `requireAdminSession()` centralizados.
- `apps/web/lib/domains/shared/index.ts` — re-export.

**Archivos modificados** — agregado `await requireSession()` como primera línea del handler:
- `apps/web/app/api/v1/pivot/route.ts:34`
- `apps/web/app/api/v1/pivot/columnas/route.ts:15`
- `apps/web/app/api/v1/eeff/balance/route.ts:17`
- `apps/web/app/api/v1/eeff/ratios/route.ts:20`
- `apps/web/app/api/v1/entidades/route.ts:16`

**Antes**: cualquier IP del mundo podía hacer `POST /api/v1/pivot` pidiendo 50.000 filas (límite del schema Zod) sin login.

**Después**: si no hay sesión, `UnauthorizedError` → respuesta 401. El `me/route.ts` ya usaba el patrón, ahora es DRY a través del helper.

**Pending**: aplicar el patrón a los endpoints admin que dependían de defense-in-depth via funciones de dominio. No es bloqueante (funciona), pero `requireAdminSession()` en el handler explicita la intención y previene refactors hostiles.

---

## Fix 5 — Sin error/loading boundaries en `/dashboard` (pantalla blanca ante fallo)

**Origen**: `audits/06-frontend.md` recomendación crítica #1.

**Archivos nuevos**:
- `apps/web/app/dashboard/error.tsx` — error boundary del segmento. Captura excepciones en server components o client, muestra UI con mensaje + ID de error + botones "Reintentar" / "Volver al inicio". En dev muestra el mensaje y stack; en prod solo el digest.
- `apps/web/app/dashboard/loading.tsx` — spinner mientras Next.js hace fetch de datos en `page.tsx` server-side.
- `apps/web/app/not-found.tsx` — pantalla 404 global. Los `[id]/page.tsx` ya llamaban `notFound()` (`tableros`, `notebooks`, `sheets`) pero no había componente — usaban el default genérico de Next.

**Antes**: si `getRatiosLatest()` lanza por DB lenta o connection drop → pantalla en blanco sin opción de retry.

**Después**: el usuario ve un panel claro con CTA. El error queda logueado server-side con `digest` correlacionable.

---

## No aplicados en esta sesión (postergados al backlog)

| Fix pendiente | Por qué postergado |
|---|---|
| Conectar `HttpxDownloader` con `raw.archivos_descargados` directamente | Refactor cross-domain. Necesita diseño: repository pattern + cambio en `DownloaderService`. ~4h. |
| Fix `withTenant` race condition | Solo bloquea features multi-tenant futuras. No urgente hoy. |
| `command-palette.tsx:166` deps array missing `sheetItems` | Bug visible solo cuando se cambian sheets durante la sesión, edge case raro. |
| Tests de integración | 1-2 días de trabajo. Mejor decidir el alcance primero. |
| Decisión dbt: borrar o reescribir modelos | Requiere conversación de arquitectura. |
| Reframe del producto a generador de PPT | Ver `PRODUCT_VISION.md` — proyecto de ~10 semanas. |
| Nav mobile en `dashboard/layout.tsx:39` | UX no bloquea uso desktop (caso real hoy). |

---

## Cómo verificar los fixes

```bash
# Frontend type-check + build
cd apps/web
pnpm typecheck
pnpm build

# Workflow (manual trigger)
gh workflow run monthly-sbs-ingestion.yml -f periodo=202604

# Test del bug listEntidades
curl -H "Cookie: <session>" "$BASE/api/v1/entidades?tipo_entidad=CajaMunicipal"
# Antes: 500 "parameter $1 not present"
# Despues: 200 con array de cajas municipales

# Test del auth en analytics
curl "$BASE/api/v1/pivot/columnas?fuente=balance"
# Antes: 200 con columnas (no requeria sesion)
# Despues: 401 unauthorized

# Test de error boundary (forzar error)
# Modificar getRatiosLatest temporalmente para throw -> recargar /dashboard
# Antes: pantalla en blanco
# Despues: panel con "Algo salio mal" + botones
```

---

## Commit sugerido

```
fix(audit): aplicar 5 fixes criticos detectados en auditoria 2026-05-23

- analisis-client: limpiar resultado + podar medidas al cambiar fuente
  Fix del bug "Columna no permitida en medidas: cta_a" visible al cambiar
  Balance -> Estado de Resultados.

- monthly-sbs-ingestion.yml: reescribir como 5 steps explicitos
  El comando previo apuntaba a un modulo inexistente. Ahora corre
  scrape -> storage scan -> import -> normalize -> refresh MVs.
  Cron movido del dia 5 al dia 15 (SBS publica D+30/45).

- analytics/queries.ts: fix listEntidades sql.raw con $1
  PG tiraba 42P02 con cualquier filtro tipo_entidad. Convertido a
  sql tag de drizzle para binding correcto.

- shared/auth-helpers: agregar requireSession + requireAdminSession
  Aplicado a /pivot, /pivot/columnas, /eeff/balance, /eeff/ratios,
  /entidades. Cierra DoS abierto.

- dashboard: agregar error.tsx + loading.tsx + not-found.tsx global
  Sin esto un throw en server-fetch tiraba pantalla blanca.

Documentacion: docs/audits/*.md (6 reportes), docs/PRODUCT_VISION.md,
docs/FIXES_APLICADOS.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
