# Design Doc — Pipeline Observability V1

**Estado**: DRAFT — pending review
**Autor**: gussbrav (con Claude)
**Fecha**: 2026-05-27
**Issue tracking**: (se crea tras aprobación del doc)

---

## 1. Problema

Hoy no hay forma de saber, sin loggearse a Postgres y leer código, si la
ingestión del último periodo SBS fue completa, si una entidad nueva apareció,
si SBS cambió formato/hoja, o si el parser asignó mal códigos por footnote
extras (como pasó en issue #15). El operador descubre los problemas cuando
el dashboard muestra ratios raros — semanas tarde.

Casos reales recientes que validaron este gap:
- **issue #8**: V085 CASCADE dropeó ~20 vistas, nadie notó hasta que panel
  mostró "X entidades sin data en MVs"
- **issue #13/#15**: parser mal-asignaba TOTAL PASIVO a Capital Social por
  footnote SBS no listado en cabecera — descubierto por discrepancia con
  Excel oficial, no por alertas

## 2. Objetivo de V1

Que el operador (vos, hoy; otros admins, mañana) abra **una sola página**
y vea en menos de 30 segundos:

1. **¿La última corrida está bien?** (scrape OK, import OK, MVs frescas)
2. **¿Hay archivos descargados pero no procesados?** (cuáles, por qué)
3. **¿SBS publicó algo raro este mes?** (entidad nueva, hoja renombrada,
   fila extra en xls, formato distinto)
4. **¿Las MVs están al día?** (lag en meses por dominio)

Sin esto, cualquier feature de visibilidad es teatro porque los campos que
alimentaría (`status='procesado'`, `filas_insertadas`) están NULL hoy.

## 3. No-objetivos de V1

Quedan para V2 (post-MVP):
- Detección de outliers de valores (z-score sobre marts.mv_eeff_ratios)
- Re-hash automático cuando SBS re-publica con corrección (G6)
- Heartbeat en sync_jobs + reaper de jobs zombi
- Alertas Slack reales (hoy solo workflow failure de GitHub Actions)
- Decoupling subprocess shell-out en `sbs work-jobs`
- Catalog watcher que scrapea índice SBS para detectar tópicos nuevos
- Versionado/snapshot histórico de cabecera_maestra

## 4. Arquitectura propuesta

### 4.1 Mapa de datos nuevo (deltas vs hoy)

```
                       LO QUE YA HAY
                       ↓
   [scrape SBS] → raw.archivos_descargados (status, hash, size)
        ↓
   [import]    → raw.<topico>_observacion
        ↓
   [refresh-mvs] → marts.mv_*  (lag medido vía /api/health?deep=1)

                       LO QUE AGREGAMOS EN V1
                       ↓
   [scrape] ─┬──→ raw.carga_log (start/end/rows/status por corrida)
             └──→ raw.archivos_descargados (sin cambios)

   [import] ─┬──→ raw.<topico>_observacion (sin cambios)
             ├──→ raw.archivos_descargados (FIX G1: UPDATE status='procesado',
             │      filas_insertadas, procesado_en)
             ├──→ raw.carga_log (audit por archivo)
             └──→ admin.estructura_diffs (FIX G3: persistir output de
                    detectar-cambios automatizado tras import del periodo)

   [refresh-mvs] ──→ raw.carga_log + marts.mv_entidades_delta (vista para
                       detectar entidades nuevas o desaparecidas)
```

### 4.2 Componentes nuevos

#### Migración V094 — Estructura base de observabilidad

```sql
-- 1. Re-vivir raw.carga_log (existe en V007 pero sin uso)
--    Schema actualizado, más estricto, con índices útiles
CREATE TABLE IF NOT EXISTS raw.carga_log (
    id BIGSERIAL PRIMARY KEY,
    -- "Source" identifica qué corrida es: scrape:eeff:202604, import:eeff:B-2201-ab2026.xls
    source TEXT NOT NULL,           -- formato: <stage>:<topico>[:<key>]
    stage TEXT NOT NULL,             -- 'scrape' | 'import' | 'refresh-mvs' | 'detectar-cambios'
    topico TEXT,                     -- 'eeff', 'oficinas', NULL para refresh global
    periodo INTEGER,                 -- 202604, NULL si no aplica
    archivo_id UUID REFERENCES raw.archivos_descargados(id),  -- NULL para refresh

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_seconds NUMERIC GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (finished_at - started_at))
    ) STORED,

    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'ok', 'error', 'skipped')),
    rows_inserted INTEGER DEFAULT 0,
    rows_updated INTEGER DEFAULT 0,
    rows_skipped INTEGER DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,  -- libre: layout detectado, sheets vistos, etc

    -- triggered_by: para correlacionar con admin.sync_jobs
    triggered_by TEXT,               -- 'cron' | 'manual:<email>' | 'cli:<user>'
    sync_job_id UUID REFERENCES admin.sync_jobs(id)
);

CREATE INDEX idx_carga_log_stage_periodo ON raw.carga_log (stage, periodo DESC);
CREATE INDEX idx_carga_log_started ON raw.carga_log (started_at DESC);
CREATE INDEX idx_carga_log_status ON raw.carga_log (status) WHERE status != 'ok';

-- 2. Tabla nueva: estructura_diffs (G3)
CREATE TABLE IF NOT EXISTS admin.estructura_diffs (
    id BIGSERIAL PRIMARY KEY,
    periodo INTEGER NOT NULL,
    grupo TEXT NOT NULL,             -- BANCOS, CMAC, FIN, etc
    topico TEXT NOT NULL,            -- eeff, oficinas, ...
    tipo_estado TEXT,                -- balance, resultados (para eeff)
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    n_renames INTEGER DEFAULT 0,     -- filas con nombre distinto a cabecera_maestra
    n_extras INTEGER DEFAULT 0,      -- filas en archivo sin entry en cabecera
    n_missing INTEGER DEFAULT 0,     -- entries en cabecera sin fila en archivo
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),

    payload JSONB NOT NULL,          -- detalle: {renames: [...], extras: [...], missing: [...]}

    -- estado de revisión humana
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    review_action TEXT,              -- 'ignored', 'cabecera_updated', 'rename_added', etc

    UNIQUE (periodo, grupo, topico, tipo_estado, detected_at)
);

CREATE INDEX idx_estructura_diffs_periodo ON admin.estructura_diffs (periodo DESC);
CREATE INDEX idx_estructura_diffs_unreviewed
    ON admin.estructura_diffs (detected_at DESC)
    WHERE reviewed_at IS NULL AND severity != 'info';
```

#### Migración V095 — Vista de entidades delta

```sql
-- v_entidades_delta: compara DISTINCT nomb_correg entre últimos 2 periodos
-- por (tipo_entidad). Output tipo:
--   periodo_actual=202604, tipo_entidad=BANCOS, nomb_correg='Banco X', accion='nueva'
--   periodo_actual=202604, tipo_entidad=FIN, nomb_correg='Compartamos', accion='desaparecida'
--
-- Casos detectados:
--  - nueva:       presente en N, ausente en N-1
--  - desaparecida: presente en N-1, ausente en N (puede ser falsa alarma si SBS no publicó)
--  - canonizada:  nomb_correg distinto pero resolver_nomb_correg_canonico lo mapea
--                 (== rename ya conocido, no alerta)

CREATE OR REPLACE VIEW marts.v_entidades_delta AS
WITH ultimos_dos AS (
    SELECT periodo, nomb_correg, tipo_entidad
    FROM raw.eeff_observacion
    WHERE periodo IN (
        SELECT periodo FROM raw.eeff_observacion
        ORDER BY periodo DESC LIMIT 2
    )
    GROUP BY periodo, nomb_correg, tipo_entidad
),
actuales AS (
    SELECT nomb_correg, tipo_entidad FROM ultimos_dos
    WHERE periodo = (SELECT MAX(periodo) FROM ultimos_dos)
),
previos AS (
    SELECT nomb_correg, tipo_entidad FROM ultimos_dos
    WHERE periodo = (SELECT MIN(periodo) FROM ultimos_dos)
)
SELECT
    (SELECT MAX(periodo) FROM ultimos_dos) AS periodo_actual,
    COALESCE(a.tipo_entidad, p.tipo_entidad) AS tipo_entidad,
    COALESCE(a.nomb_correg, p.nomb_correg) AS nomb_correg,
    CASE
        WHEN a.nomb_correg IS NOT NULL AND p.nomb_correg IS NULL THEN 'nueva'
        WHEN a.nomb_correg IS NULL AND p.nomb_correg IS NOT NULL THEN 'desaparecida'
    END AS accion,
    -- ¿está en entidad_maestra como canonico o alias?
    EXISTS (
        SELECT 1 FROM dw.entidad_nombre en
        WHERE en.nombre = COALESCE(a.nomb_correg, p.nomb_correg)
    ) AS en_maestra
FROM actuales a
FULL OUTER JOIN previos p
    ON a.nomb_correg = p.nomb_correg
   AND a.tipo_entidad = p.tipo_entidad
WHERE a.nomb_correg IS NULL OR p.nomb_correg IS NULL;

COMMENT ON VIEW marts.v_entidades_delta IS
'Detecta entidades nuevas o desaparecidas comparando los últimos 2 periodos de raw.eeff_observacion. Usado por /dashboard/admin/pipeline para alertar al operador.';
```

#### Cambios de código backend

##### B1. Helper compartido `_carga_log` (en `domains/shared/`)

```python
# data-platform/src/aibenchef_data/domains/shared/carga_log.py (NUEVO)

from contextlib import asynccontextmanager
from uuid import UUID
import psycopg

@asynccontextmanager
async def carga_log_context(
    conn,
    *,
    stage: str,                   # 'scrape' | 'import' | 'refresh-mvs' | 'detectar-cambios'
    topico: str | None = None,
    periodo: int | None = None,
    archivo_id: UUID | None = None,
    triggered_by: str = 'cli',
    sync_job_id: UUID | None = None,
    metadata: dict | None = None,
):
    """Context manager que crea una fila en raw.carga_log con status='running',
    permite al caller actualizar contadores, y al salir marca 'ok' o 'error'.

    Uso:
        async with carga_log_context(conn, stage='import', topico='eeff',
                                     periodo=202604) as log:
            result = await importer.import_file(f)
            log.rows_inserted = result.rows_inserted
            log.metadata['layout'] = result.layout_name
    """
    source = f"{stage}:{topico or 'all'}" + (f":{periodo}" if periodo else '')
    async with conn.cursor() as cur:
        await cur.execute(
            """INSERT INTO raw.carga_log (source, stage, topico, periodo,
                                          archivo_id, triggered_by, sync_job_id,
                                          metadata)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (source, stage, topico, periodo, archivo_id, triggered_by,
             sync_job_id, psycopg.types.json.Json(metadata or {}))
        )
        log_id = (await cur.fetchone())[0]
    state = _LogState(rows_inserted=0, rows_updated=0, rows_skipped=0,
                      metadata=metadata or {})
    try:
        yield state
    except Exception as exc:
        async with conn.cursor() as cur:
            await cur.execute(
                """UPDATE raw.carga_log
                   SET finished_at=NOW(), status='error',
                       error_message=%s, rows_inserted=%s, rows_updated=%s,
                       rows_skipped=%s, metadata=%s
                   WHERE id=%s""",
                (str(exc)[:1000], state.rows_inserted, state.rows_updated,
                 state.rows_skipped, psycopg.types.json.Json(state.metadata),
                 log_id)
            )
        raise
    else:
        async with conn.cursor() as cur:
            await cur.execute(
                """UPDATE raw.carga_log
                   SET finished_at=NOW(), status='ok',
                       rows_inserted=%s, rows_updated=%s, rows_skipped=%s,
                       metadata=%s
                   WHERE id=%s""",
                (state.rows_inserted, state.rows_updated, state.rows_skipped,
                 psycopg.types.json.Json(state.metadata), log_id)
            )
```

##### B2. Hook G1: cada importer actualiza `archivos_descargados`

Lugar único: `cli.py` en `_run_simple_import` (línea ~2148) y en el loop
del comando `import_eeff` que ya itera files. **NO** modificar los 12
importers individuales — agregar wrapper.

```python
# cli.py — wrapper actualizado
async def _import_with_audit(importer, file: Path, conn, *, topico: str,
                              triggered_by: str = 'cli',
                              sync_job_id: UUID | None = None):
    archivo_id = await _resolve_archivo_id(conn, file)
    periodo = _extract_periodo_from_path(file)

    async with carga_log_context(conn, stage='import', topico=topico,
                                  periodo=periodo, archivo_id=archivo_id,
                                  triggered_by=triggered_by,
                                  sync_job_id=sync_job_id) as log:
        try:
            result = await importer.import_file(file)
            log.rows_inserted = result.rows_inserted
            log.metadata.update({
                'sheets': result.sheets_processed,
                'layout': result.layout_name,
                'duration_s': result.duration_seconds,
            })
            # G1 FIX: marca archivo procesado
            await _mark_archivo_procesado(conn, archivo_id,
                                          result.rows_inserted)
            if result.errors:
                # warning, no fail — guardar errors en metadata
                log.metadata['errors'] = [str(e) for e in result.errors[:5]]
        except Exception as exc:
            await _mark_archivo_error(conn, archivo_id, str(exc))
            raise
    return result
```

##### B3. Hook G3: correr detectar-cambios automáticamente tras último periodo

Al terminar el import del último archivo de un periodo (detectado vía
`MAX(periodo)` en archivos_descargados), correr `detectar_cambios()` y
persistir en `admin.estructura_diffs`. Lugar: nuevo comando CLI
`aibenchef pipeline post-import-check <periodo>` que se invoca al final
de `sbs work-jobs` y al final de `import_all`.

#### Frontend Next.js — Página /dashboard/admin/pipeline

##### Estructura visual (ASCII mockup)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Pipeline / Observabilidad                                Última corrida:   │
│                                                            2026-05-27 13:44 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  🟢 SALUD GENERAL                                                          │
│  ┌──────────────┬──────────────┬──────────────┬──────────────────────┐   │
│  │ Scrape       │ Import       │ MVs          │ Última data           │   │
│  │ 🟢 OK 13:23  │ 🟢 OK 13:44  │ 🟢 OK 13:45  │ Apr-2026 (lag 1 mes) │   │
│  └──────────────┴──────────────┴──────────────┴──────────────────────┘   │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  📥 COBERTURA — Último periodo: 202604                                     │
│                                                                            │
│  Tópico       BANCOS  CMAC   FIN    CRAC   EDPYME   Total                 │
│  eeff           ✅    ✅    ✅    ✅     ✅       100%                    │
│  oficinas       ✅    ✅    ⚠️     ✅     ✅        96%  ← 1 file error   │
│  depositos      ✅    ✅    ✅    🔵     🔵        80%  ← no publicado SBS │
│  clientes       ✅    ✅    ✅    ✅     ✅       100%                    │
│  ...                                                                       │
│  [Ver detalle por archivo →]                                              │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ⚠️ ANOMALÍAS ESTRUCTURALES — 202604                                       │
│                                                                            │
│  Grupo  Tópico   tipo   Renames  Extras  Missing  Severidad  Estado       │
│  CMAC   eeff     bal       0       1        0     warning    Sin revisar  │
│         └─ "1/ Las cifras al cierre" en orden 47 no está en cabecera     │
│         [Ignorar] [Agregar a cabecera] [Marcar como rename]               │
│                                                                            │
│  BANCOS oficinas  -        2       0        0     info       Sin revisar  │
│         └─ "B. Continental S.A." → "BBVA" (ya en entidad_maestra ✅)      │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  🆕 ENTIDADES NUEVAS / DESAPARECIDAS                                       │
│                                                                            │
│  202604 vs 202603:                                                         │
│  • 🆕 "Banco Falabella Perú" (BANCOS) — no está en dw.entidad_maestra     │
│    [Agregar como canónico] [Marcar como rename de...]                     │
│  • 🚫 "FIN Confianza" (FIN) — presente en 202603, ausente en 202604       │
│    Posible falso positivo: SBS aún no publicó. [Verificar SBS]            │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  📋 TIMELINE — Últimas 20 corridas                                         │
│                                                                            │
│  13:44:26  import:eeff:202604       ok      413 archivos    19m23s        │
│  13:23:01  scrape:eeff:202604       ok      414 archivos     8m12s        │
│  12:45:33  refresh-mvs              ok      14 MVs           2m08s        │
│  09:15:02  import:oficinas:202604   ok      89 archivos      3m45s        │
│  09:02:11  scrape:oficinas:202604   error   ⚠️ ver detalle  1m02s         │
│  ...                                                                       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

##### API endpoints nuevos

```
GET /api/v1/admin/pipeline/health
    → { scrape: {status, last_run}, import: {...}, refresh: {...},
        ultima_data: { periodo, lag_meses } }

GET /api/v1/admin/pipeline/cobertura?periodo=202604
    → [{ topico, grupo, status_count: {ok, error, pending, no_publicado},
         pct_completado }]

GET /api/v1/admin/pipeline/anomalias?periodo=202604&unreviewed=true
    → [{ id, grupo, topico, tipo_estado, n_renames, n_extras, n_missing,
         severity, payload, reviewed_at }]

POST /api/v1/admin/pipeline/anomalias/:id/review
    → body: { action: 'ignored' | 'cabecera_updated' | ..., notes? }

GET /api/v1/admin/pipeline/entidades-delta
    → [{ tipo_entidad, nomb_correg, accion: 'nueva'|'desaparecida',
         en_maestra }]

GET /api/v1/admin/pipeline/timeline?limit=20
    → [{ source, stage, status, started_at, duration_s, rows_inserted,
         error_message? }]
```

## 5. Plan de implementación

Dividido en **3 PRs** secuenciales (cada uno con tests + green CI + merge):

### PR-A — Backend foundation (datos)
- Migración V094 (`raw.carga_log` revivida + `admin.estructura_diffs`)
- Migración V095 (`marts.v_entidades_delta`)
- Helper `carga_log_context` en `domains/shared/carga_log.py`
- Hooks G1 + G2 en `_import_with_audit` wrapper en `cli.py`
- Comando CLI nuevo: `aibenchef pipeline post-import-check <periodo>` (G3)
- Hook: `sbs work-jobs` invoca `post-import-check` al terminar
- Tests unit: `test_carga_log_context.py`, `test_estructura_diffs_persistence.py`
- Test integración (testcontainers): import end-to-end con verificación
  de que `archivos_descargados.status` cambia + `carga_log` se llena

### PR-B — API layer
- Endpoints `/api/v1/admin/pipeline/*` (5 routes)
- Drizzle queries en `apps/web/lib/domains/pipeline/queries.ts`
- Tests Next.js API routes

### PR-C — UI
- Página `/dashboard/admin/pipeline/page.tsx` (server component)
- 5 secciones según mockup: Salud / Cobertura / Anomalías / Entidades delta / Timeline
- Componentes reutilizables (semáforos, badges severity)
- Acciones POST anomalías (review)
- Link desde sidebar admin

## 6. Definition of Done

Por DoD del proyecto (`docs/REGLAS_DE_ORO_INGESTA.md` + `.claude/rules/definition-of-done.md`):

- [ ] 3 PRs mergeados con CI verde (data-platform + integration + Next.js)
- [ ] Ruff check + format clean
- [ ] Tests cubren: happy path import → log creado → archivo procesado;
      import con error → log error → archivo en estado error
- [ ] Migración SQL idempotente (`CREATE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`)
- [ ] Backfill: `UPDATE raw.archivos_descargados SET status='procesado'`
      para los ~621 archivos ya procesados (detección: tienen rows en
      raw.<topico>_observacion para ese periodo)
- [ ] Backfill `admin.estructura_diffs` para últimos 3 periodos corriendo
      `detectar-cambios` retroactivamente
- [ ] Documentación: agregar sección al `docs/REGLAS_DE_ORO_INGESTA.md`
      indicando que **TODO importer nuevo debe usar `_import_with_audit`**,
      no llamar `import_file` directo
- [ ] Comentarios y mensajes UI en castellano peruano

## 7. Riesgos & mitigaciones

| Riesgo | Mitigación |
|---|---|
| Backfill de `archivos_descargados.status='procesado'` puede ser pesado (~621 archivos) | UPDATE en batches de 100 con LIMIT/OFFSET |
| `detectar-cambios` retroactivo puede tomar minutos por periodo × grupo × tópico | Job en background con progress en `raw.carga_log` |
| Performance de v_entidades_delta si raw.eeff_observacion crece a >10M filas | Si llega ese punto, materializar la vista |
| Falsos positivos en "entidad desaparecida" cuando SBS no publicó aún ese tópico | Marker `en_carga_log = false` para distinguir "no publicado" de "ya no existe" |
| Confusión entre `raw.archivos_descargados.status` y `raw.carga_log.status` | Documentar: archivo = estado del file físico, carga_log = estado de cada operación sobre él |

## 8. Rollback

- Migraciones: V094 y V095 son aditivas (tablas/vistas nuevas). Drop si falla.
- Backend: `_import_with_audit` envuelve sin reemplazar. Rollback = no usarlo.
- Frontend: nueva ruta `/dashboard/admin/pipeline`, no impacta otras rutas.

## 9. Métricas de éxito

Tras 1 mes en producción:
- Tiempo de detección de drift estructural: **< 24h** (vs "semanas" hoy)
- % archivos con `status` poblado: **100%** (vs 0% hoy)
- Visibilidad de "qué corrió y cuándo": **30 segundos en una página**
- Entidades nuevas detectadas antes de bug en dashboard: **siempre**

## 10. Anexo — Casos conocidos que esta feature debe cubrir

Basado en `docs/REGLAS_DE_ORO_INGESTA.md`:

| Caso | Cómo lo detecta V1 |
|---|---|
| Footnote SBS extra ("* Mediante Resolución...") | `estructura_diffs.n_extras > 0` con severidad warning |
| Rename entidad ya canonizado (Edyficar→Mibanco) | `entidades_delta.en_maestra=true`, severidad info |
| Rename entidad NO canonizado | `entidades_delta.en_maestra=false`, severidad warning |
| Nueva entidad en SBS | `entidades_delta.accion='nueva'`, severidad warning |
| Sheet renombrado en xls | `carga_log.status='error'` con metadata.sheets_detected vs metadata.sheets_expected |
| Archivo no publicado por SBS | Ya cubierto hoy: `archivos_descargados.status='no_publicado_sbs'` |
| Re-publicación con misma URL distinta data | **NO cubierto en V1** (G6 va a V2: re-hash) |
| Outlier de valores intra-cuenta | **NO cubierto en V1** (V2: z-score) |
| Tópico nuevo publicado por SBS | **NO cubierto en V1** (V2: catalog watcher) |

---

**Aprobación requerida antes de implementar.**
Comentarios / cambios al doc → editar este archivo y pedir nuevo review.
