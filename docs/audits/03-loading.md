# Auditoría — Flujos de Loading

**Estado general: 🟡 AMARILLO**

## Veredicto

1. Ambos importers funcionan y comparten la misma tabla destino (`raw.eeff_observacion`) con la misma `UNIQUE (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo)` y misma estrategia COPY-to-stage + UPSERT.
2. **Cero tests automatizados** para los importers — `tests/unit/` solo cubre `catalog`, `cuenta` y `sbs_url`. Toda la lógica de parsing (layout SBS, matching posicional, dedupe, monedas) sin red de seguridad.
3. **Bug de cache en `_PositionLookup`** (`monthly_eeff_importer.py:194-208`): el cache se indexa por `(tipo_estado, tipo_entidad)` pero la query SQL filtra por `periodo`. Cuando se importa un directorio que abarca un cutoff de `valido_desde/valido_hasta`, se reusa la versión del primer periodo procesado para todos los siguientes.

---

## Flujo 1 — `BaseEeffImporter` (histórico)

**Qué hace.** Lee `BASE EE.FF..xlsx` (hojas BG/ER con código canónico embebido en header `(A1.1) Caja`) y vuelca observaciones a `raw.eeff_observacion`.

**Schema destino** (`V006`): `id BIGSERIAL`, `periodo INT (YYYYMM)`, `fecha_cierre DATE`, `tipo_estado` CHECK in `(balance,resultados)`, `empresa_sbs`, `nomb_correg NOT NULL`, `tipo_entidad NOT NULL`, `microfinanciera`, `nacional`, `moneda` CHECK in `(MN,ME,TOTAL)`, `cuenta_codigo NOT NULL`, `cuenta_nombre`, `valor NUMERIC(20,4)`, `source`, `source_file`, `loaded_at`. **UNIQUE** `(periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo)`.

**Código clave** (`base_eeff_importer.py`):
- `import_file` :54
- `_import_sheet` :109
- `_copy_batch` :154 — temp `_eeff_stage` + COPY + INSERT ON CONFLICT DO UPDATE
- `_detect_columns` :223 / `_detect_cuenta_columns` :236
- `_row_to_observations` :257 / `_cell_str` :320 / `_coerce_date` :328 / `_coerce_number` :358

**¿Funciona hoy?** SÍ. Lógica robusta — el `xlsx` lleva el código regulatorio precocido, no requiere matching.

**Bugs**:
- Filas con `mes` vacío, `nomb_correg` vacío o moneda fuera de `(MN,ME,TOTAL)` se descartan SILENCIOSAMENTE (`:269/274/278`). No hay métrica de skipped rows.
- `_excel_serial_to_date` (:350) usa epoch 1899-12-30 pero no compensa el bug Excel 1900 leap year — solo seguro para fechas >= 1900-03-01.
- No se normaliza `nomb_correg` con `dw.normalizar_entidad()` — solo el monthly lo hace. El histórico puede tener variantes con `\n` o asteriscos.
- Errores son por-hoja, no por-fila: una sola fila corrupta tumba toda la hoja (`:94-99`).

## Flujo 2 — `MonthlyEeffImporter`

**Qué hace.** Lee `.xls` mensuales SBS (transpuestos: filas=cuentas, columnas=entidad x moneda) y vuelca a la misma tabla. Resuelve `cuenta_codigo` via `dw.cabecera_maestra` (posicional) con fallback por `_CuentaLookup` (nombre normalizado + aliases en `dw.cuenta_alias`).

**Código clave** (`monthly_eeff_importer.py`):
- `import_file` :104, `_import_sheet` :210
- `_copy_batch` :359 — aplica `dw.normalizar_entidad(nomb_correg)` en el INSERT (:397)
- `_detect_layout` :444 — fecha_cierre rows 0-6, busca fila MN en rows 4-9
- `_classify_sheet` :58 — prefijos `bg_*`/`gyp_*`/`er_*` + heurística de título
- `_CuentaLookup` :530 con `find_header`/`find_child` fuzzy single-match :613/:647
- `_PositionLookup` :681 — query a `dw.cabecera_maestra` con vigencia por periodo

**¿Funciona hoy?** PARCIAL. Probado en producción (V017/V018/V027/V028 confirman aliases iterativamente parchados sobre datos reales 2024-2026). El fallback nombre-based muestra signos de fragilidad — V017 documenta `'disponible' -> 1.1`, V015 documenta `'provisiones para creditos directos' -> 4`, V028 fusiona 4 entidades renombradas en abr-2023.

**Bugs**:
- **Cache estático de `_PositionLookup`** (:198-208): firma incluye `periodo` pero el cache solo usa `(tipo_estado, tipo_entidad)`. Procesar directorio que cruza un `valido_desde` reutiliza la primera versión.
- **TOTAL calculado** (:312-317): cuando falta `TOTAL` pero están MN+ME se suma. No hay tolerancia a `MN` solo o `ME` solo — quedan como observaciones parciales (esperado pero no documentado).
- **Dedup en memoria** (:341-350): si fuzzy match colapsa 2 filas distintas al mismo codigo, se queda con la **primera** — sin warning. Riesgo de perder data si un alias está mal calibrado.
- Detector de header (`:271`): `nombre_raw.strip() == nombre_raw.strip().upper()` da true para strings cortos como `"OTROS"` que pueden ser hijos legítimos — depende 100% del `_PositionLookup` para distinguir.
- Errores son por-hoja (`:154-176`): un layout-detection-fail tira toda la hoja sin reportar qué filas se procesaron.

## Batch / transaccionalidad

- `batch_size=10_000` observaciones (NO filas Excel) en ambos.
- Cada batch: stage temp → COPY → INSERT...ON CONFLICT → `conn.commit()`. **NO** es transaccional a nivel archivo — si el archivo falla en el batch N+1, los batches 1..N quedan commiteados. Consistente con upsert idempotente, pero invalida cualquier intento de "import atómico".

## Health checks sugeridos

```sql
-- 1. Cobertura por (periodo, tipo_entidad, tipo_estado, moneda)
SELECT periodo, tipo_entidad, tipo_estado, moneda, COUNT(*) AS obs,
       COUNT(DISTINCT nomb_correg) AS entidades, COUNT(DISTINCT cuenta_codigo) AS cuentas
FROM raw.eeff_observacion GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;

-- 2. Códigos en raw que NO existen en dim_cuenta
SELECT DISTINCT r.cuenta_codigo, r.tipo_estado, COUNT(*) AS n
FROM raw.eeff_observacion r
LEFT JOIN dw.dim_cuenta d ON d.codigo=r.cuenta_codigo AND d.tipo_estado=r.tipo_estado
WHERE d.codigo IS NULL GROUP BY 1,2 ORDER BY n DESC;

-- 3. Periodos donde MN+ME != TOTAL (>1% drift)
SELECT periodo, nomb_correg, cuenta_codigo,
       SUM(valor) FILTER (WHERE moneda='MN') + SUM(valor) FILTER (WHERE moneda='ME') AS suma,
       SUM(valor) FILTER (WHERE moneda='TOTAL') AS tot
FROM raw.eeff_observacion WHERE tipo_estado='balance'
GROUP BY 1,2,3 HAVING ABS(COALESCE(SUM(valor) FILTER (WHERE moneda='TOTAL'),0)
     - (COALESCE(SUM(valor) FILTER (WHERE moneda='MN'),0)+COALESCE(SUM(valor) FILTER (WHERE moneda='ME'),0))) > 0.01;

-- 4. cabecera_maestra con codigo NULL pero sin nombre
SELECT * FROM dw.cabecera_maestra WHERE codigo IS NULL AND (nombre IS NULL OR nombre='');
```

## Deuda

- **Sin tests** — refactors del parsing son ciegos.
- **Cache cruzado cross-periodo** en `_PositionLookup`.
- **Sin métricas de skip/fallback** — invisible cuántas filas se pierden y por qué.
- **Idempotencia parcial**: ON CONFLICT DO UPDATE no detecta cuando una fila DEJA de existir en el origen (no hay tombstoning).
- **Dedup silencioso** en monthly puede ocultar errores de aliases.
