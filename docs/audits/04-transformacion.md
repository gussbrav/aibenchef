# Auditoría — Transformación (dbt + MVs)

**Estado general: 🔴 ROJO**

## Veredicto en 3 líneas

1. La capa dbt está **vacía / muerta**: 1 solo modelo (`stg_sbs_eeff.sql`) que apunta a una fuente inexistente (`raw.eeff` vs `raw.eeff_observacion`); `marts/`, `intermediate/`, `metrics/`, `tests/`, `macros/`, `seeds/` son **carpetas vacías**. No hay `schema.yml`, ni tests, ni snapshots.
2. Las 3 MVs sí funcionan (índices únicos OK, refresh concurrent posible), pero **no son producidas por dbt** sino por migraciones SQL auto-generadas (`generate_marts_sql.py` → `V009`/`V010`/`V011`). La supuesta arquitectura `raw → stg → marts → dw` no existe: `dw.fact_observacion` y `dw.dim_entidad/dim_tiempo` **jamás se pueblan** desde dbt.
3. El workflow `monthly-sbs-ingestion.yml:37-38` corre `dbt run` + `dbt test` en producción cada mes — eso **falla o no produce nada útil** porque el único modelo apunta a `raw.eeff` que no existe. Encima el workflow **no llama** a `aibenchef db refresh-mvs`, que es lo único que sí refresca los marts reales.

---

## Flujo 1 — dbt staging

- **Qué hace (debería):** limpiar/tipar `raw.*` → `stg.*`. En la práctica, el único modelo es `stg_sbs_eeff.sql` (un SELECT con cast a numeric y filtro `valor is not null`).
- **Entrada/Salida:** lee `source('raw_sbs', 'eeff')` → produce vista `raw.stg_sbs_eeff` (según `dbt_project.yml:21` el schema staging es `raw`, raro).
- **Código clave:**
  - `data-platform/dbt/models/staging/stg_sbs_eeff.sql:13`
  - `data-platform/dbt/models/staging/sources.yml:9` declara `raw_sbs.eeff` (otras 9 tablas declaradas: `colocaciones`, `depositos`, `castigos`, etc. — ninguna existe).
  - `data-platform/dbt/dbt_project.yml:19-29`
- **¿Funciona hoy?** **NO**. La tabla `raw.eeff` no existe; la tabla real es `raw.eeff_observacion` (`V006`). Las columnas del SELECT (`periodo_yyyymm`, `entidad_codigo_sbs`, `cuenta_codigo`, `moneda`) tampoco matchean el schema real (`periodo`, `nomb_correg`, `cuenta_codigo`, `moneda` en `V006:10-26`).
- **Bugs:** source mismatch crítico — `dbt run` rompe. 9 sources declarados sin tabla física.

## Flujo 2 — dbt marts

- **Qué hace:** debería producir `dim_*` / `fact_*`. **No hace nada — la carpeta `models/marts/` está vacía.**
- **¿Funciona hoy?** **NO existe**. Las tablas `dw.dim_entidad`, `dw.dim_tiempo`, `dw.fact_observacion` se crean por migraciones (`V003`, `V004`) y se pueblan por **código Python** (`dim_cuenta_seeder.py:77`, `monthly_eeff_importer.py`), no por dbt. `dw.fact_observacion` **no se popula desde ningún sitio** (grep solo encuentra el `CREATE TABLE`).
- **Bugs:**
  - **Naming inconsistente `dw.dim_cuenta.codigo` vs MV columns:** `dim_cuenta.codigo = 'A1.1'` (con puntos) mientras las MVs exponen `cta_a1_1` (sanitizado por `generate_marts_sql.py:27`).
  - `V008` ya tuvo que parchar el CHECK constraint de `dim_cuenta.tipo_estado` (de `'BG','ER'` → `'balance','resultados',...`) — síntoma de divergencia schema/dominio.
  - `dw.fact_observacion` está **muerta** (partition table sin filas).

## Flujo 3 — Refresh MVs (`aibenchef db refresh-mvs --concurrently`)

- **Qué hace:** `REFRESH MATERIALIZED VIEW [CONCURRENTLY]` sobre las 3 MVs en orden: `mv_eeff_balance_ancho` → `mv_eeff_resultados_ancho` → `mv_eeff_ratios`.
- **Entrada / Salida:** lee `raw.eeff_observacion` (las dos primeras) y las propias MVs (ratios). El consumo público es vía `marts.v_eeff_balance_ancho` (wrapper V026) — `apps/web/lib/domains/analytics/pivot.ts:79`.
- **Código clave:**
  - `cli.py:295-343`
  - MVs: `V009__marts_eeff_balance_ancho.sql:119`, `V010` (`uq_mv_eeff_resultados_ancho`), `V011`/`V012` (`uq_mv_eeff_ratios`).
  - Wrapper: `V026__l1_totales_balance.sql:17-65`.
- **¿Funciona hoy?** **Sí, parcialmente.** Las 3 MVs tienen `UNIQUE INDEX` (necesario para REFRESH CONCURRENTLY).
- **Bugs:**
  - **Bug histórico V011 → V012:** la versión original calculaba `total_activo = bg.cta_a`, pero `cta_a` siempre era NULL porque SBS no reporta el código L1 `'A'` raw. **V012 lo arregla**.
  - **Wrapper `v_eeff_balance_ancho` (V026):** los códigos sintéticos `cta_a`/`cta_b`/`cta_c` están correctamente recomputados como `SUM(COALESCE(cta_aN,0))` para `A1..A9`, `B1..B10`, `C1..C8` (V026:52-64). **Identidad A=B+C se cumple por construcción**, salvo cuentas L2 faltantes.
  - **Asimetría:** balance tiene wrapper pero **no hay `v_eeff_resultados_ancho`**, pese a que `cta_3` (Margen Financiero Bruto) y similares también son totales no provistos por raw (`pivot.ts:76` lo nota como TODO).
  - Workflow mensual **no llama** a `aibenchef db refresh-mvs` — MVs quedan stale post-ingest.

## Health check sugerido

```sql
-- 1) Conteo por mart
SELECT 'balance' AS mv, COUNT(*), MAX(periodo) FROM marts.mv_eeff_balance_ancho
UNION ALL SELECT 'resultados', COUNT(*), MAX(periodo) FROM marts.mv_eeff_resultados_ancho
UNION ALL SELECT 'ratios', COUNT(*), MAX(periodo) FROM marts.mv_eeff_ratios;

-- 2) Identidad contable A = B + C (tolerancia 0.5%)
SELECT periodo, nomb_correg, moneda, cta_a, cta_b + cta_c AS bc,
       cta_a - (cta_b + cta_c) AS diff
FROM marts.v_eeff_balance_ancho
WHERE ABS(cta_a - (cta_b + cta_c)) > GREATEST(ABS(cta_a) * 0.005, 1)
LIMIT 20;

-- 3) Staleness de MVs
SELECT (SELECT MAX(periodo) FROM raw.eeff_observacion) AS raw_max,
       (SELECT MAX(periodo) FROM marts.mv_eeff_balance_ancho) AS mv_max;
```

## Deuda crítica

- **dbt es teatro.** El workflow productivo corre `dbt run`/`dbt test` pero no produce nada útil; genera falsa sensación de "tenemos transformaciones testeadas". **Decidir: borrar dbt o migrar las MVs auto-generadas a modelos dbt con `materialized='materialized_view'`.**
- **`generate_marts_sql.py` + migraciones versionadas** acoplan el catálogo de cuentas a numeración de migraciones — si se agrega una cuenta hay que re-DROP/CREATE la MV (operación cara). dbt resolvería esto.
- **`dw.fact_observacion` muerta** — código y particiones existen pero nadie inserta. Decidir: poblarla desde dbt o eliminarla.
- **Workflow mensual no refresca MVs** — post-ingest dashboards quedan stale.
- **Sin asserts ni tests** (`not_null`, `unique`, `relationships`).
- **Sin wrapper de resultados** — la API consume `mv_eeff_resultados_ancho` directo, expuesta a NULLs en `cta_3`/`cta_8`/`cta_14`.
