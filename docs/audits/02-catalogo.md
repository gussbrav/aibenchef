# Auditoría — Flujos de Catálogo

**Estado general: 🟡 AMARILLO**

## Veredicto en 3 líneas

1. Los 4 flujos están implementados, coherentes entre sí y respaldados por migraciones V003/V008/V014–V018/V022. La aritmética posicional (init-maestra ↔ detectar-cambios ↔ importer) está bien sincronizada.
2. **Cobertura de tests = casi nula** para los 4 flujos auditados: solo `Periodo`/`parse_label`/`derive_*` están testeados. No hay tests del seeder, ni del extractor consolidado, ni de init-maestra, ni de normalize-entidades.
3. Hay inconsistencias menores en los seeds (`nombre` placeholder "A"/"B"/"C", `signo` no escrito por `consolidado_extractor`), y `dim_cuenta_seeder` hace `commit` interno (rompe la transacción externa del CLI).

---

## Flujo 1 — Seed `dw.dim_cuenta`

- **Qué hace**: lee `seeds/cuentas_balance.json` y `cuentas_resultados.json` y UPSERT en `dw.dim_cuenta` ordenando por nivel para respetar FK `parent_codigo`.
- **Entrada**: `seeds/cuentas_balance.json` (92 cuentas), `cuentas_resultados.json` (65), `cuentas_indicadores.json` (49 — **no se usa hoy** por el seeder).
- **Salida**: `dw.dim_cuenta` (V003 + CHECK actualizado en V008).
- **Código clave**:
  - CLI: `cli.py:1096-1122` (`catalog seed-dim-cuenta`)
  - Service: `domains/loading/services/dim_cuenta_seeder.py:24-91`
  - Extractores: `domains/catalog/repositories/cuentas_canonicas_extractor.py` y `consolidado_extractor.py`
- **¿Funciona hoy?** SÍ.
- **Bugs / inconsistencias**:
  - `dim_cuenta_seeder.py:39` hace `await self._conn.commit()` por categoría, pero `cli.py:1117` también llama `await conn.commit()`. Redundancia que rompe transacción externa.
  - `seeds/cuentas_balance.json:982-1013`: las cuentas raíz tienen `nombre: "A"`, `"B"`, `"C"` (placeholders en vez de "ACTIVO", "PASIVO", "PATRIMONIO"). Rompe matching del importer.
  - `consolidado_extractor.py:222-246`: el `write_seeds()` NO escribe los campos `signo` y `categoria`, pero `cuentas_canonicas_extractor.py:177` sí. Shapes JSON divergentes.
  - `cuentas_indicadores.json` existe pero `DimCuentaSeeder._upsert_batch` solo itera `("balance", "resultados")` (`dim_cuenta_seeder.py:31`). Indicadores nunca llegan a `dw.dim_cuenta`.
- **Tests**: ninguno.
- **Health check**: `SELECT tipo_estado, COUNT(*), COUNT(DISTINCT codigo) FROM dw.dim_cuenta GROUP BY 1`.

## Flujo 2 — `init-maestra`

- **Qué hace**: lee los `.xls` reales de un período desde `./local-data/raw/<grupo>/eeff/<anio>/<mes>/`, recorre filas y para cada `(tipo_estado, tipo_entidad)` puebla `dw.cabecera_maestra` con `(orden, codigo, nombre)`. El `codigo` se resuelve via `_CuentaLookup`.
- **Salida**: `dw.cabecera_maestra` (V016 + V017 permite `codigo NULL`).
- **Código clave**: `cli.py:506-707`. Usa `_CuentaLookup.from_db`, `_detect_layout`, `_normalize`, `_cell_str`.
- **¿Funciona hoy?** SÍ.
- **Bugs**:
  - `cli.py:545,763`: `storage_root = Path("./local-data/raw").resolve()` hardcodeado relativo al cwd. No respeta env var.
  - `cli.py:570-578`: solo procesa **el primer archivo** (`files[0]`) por grupo. Si hay >1 `.xls` para un grupo/mes, se ignoran.
  - `cli.py:593-594`: `parent: str | None = section if section == "C" else None`. Si el archivo SBS no empieza con "Activo" como section marker, el parent permanecerá `None` y todos los hijos quedarán con `codigo=NULL`.
  - `cli.py:691`: `nivel = 2 if es_header else 3` — heurístico, no usa la jerarquía real de `dim_cuenta`.
- **Health check**: `SELECT tipo_estado, tipo_entidad, COUNT(*) FILTER (WHERE codigo IS NULL) AS unmapped, COUNT(*) FROM dw.cabecera_maestra WHERE valido_hasta IS NULL GROUP BY 1,2`. Ratio unmapped/total > 30% = matching roto.

## Flujo 3 — `detectar-cambios`

- **Qué hace**: compara la cabecera del archivo SBS del período contra `dw.cabecera_maestra` y reporta renames, extras y missing.
- **Código clave**: `cli.py:710-870`.
- **¿Funciona hoy?** SÍ.
- **Bugs**:
  - `cli.py:763`: mismo hardcode de `./local-data/raw`.
  - `cli.py:760`: si pasas `--grupo` que no existe, KeyError sin try/except.
  - Solo procesa el primer archivo del grupo (mismo issue que init-maestra).
  - El comando NO usa `periodo` para el filtro `valido_desde <= periodo` — sólo `valido_hasta IS NULL`. Sirve para "validar próximo mes" pero NO para auditoría retrospectiva.

## Flujo 4 — `normalize-entidades`

- **Qué hace**: aplica `dw.normalizar_entidad()` a `raw.eeff_observacion.nomb_correg`, DELETE duplicados + UPDATE renombres; limpia `dw.dim_entidad` huérfanos.
- **Código clave**: `cli.py:898-980`. Función SQL: `V022__normalizar_entidad_v2.sql:14-38`.
- **¿Funciona hoy?** SÍ — V022 v2 trae fix de newlines y aliases consolidados (BCP sucursales).
- **Idempotencia**: SÍ. Post-primera-corrida queda vacío.
- **Bugs**:
  - `cli.py:939-962`: ejecuta DELETE + UPDATE por cada alias sin agruparlos → N+1 round-trips.
  - `dw.entidad_alias` (V014:64) tiene PK = `alias` único global — rompe si dos tipos de entidad usan el mismo alias-string.
  - **Crítico**: la función SQL `normalizar_entidad` es declarada `IMMUTABLE STRICT` pero hace SELECT a `dw.entidad_alias` (V022:33-36) — **violación técnica de IMMUTABLE**. Postgres lo permite pero el optimizador puede cachear resultados viejos. **Bug latente** si se agregan aliases.

## Deuda transversal

1. **0% de cobertura de tests** en los 4 flujos. Prioridad 1.
2. Path `./local-data/raw` hardcodeado (`cli.py:545,763`).
3. `dw.normalizar_entidad` marcada IMMUTABLE pero hace lookup en tabla.
4. `cuentas_indicadores.json` huérfano.
5. Dos extractores con shape JSON divergente.
