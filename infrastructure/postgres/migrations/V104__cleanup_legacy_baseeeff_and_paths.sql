-- =========================================================================
-- V104: Cleanup data legacy de `BASE EE.FF..xlsx` + normalizar paths a
-- formato server (issue #42)
--
-- CONTEXTO
--
-- Issue 1: `raw.archivos_descargados.path_local` tiene rutas Windows del
-- laptop original (`D:\PROYECTO\SBS\aibenchef\data-platform\local-data\raw\
-- ...`). Esos archivos ahora viven en el server bajo bind volume
-- `/app/local-data/raw/`. El Inspector muestra path_local y queda mal.
--
-- Issue 2: ~2M rows en `raw.eeff_observacion` con `source_file =
-- 'BASE EE.FF..xlsx'` (Excel manual de referencia del usuario, importado en
-- 2026-05-21). Esa fuente usa una mapeo de codigos LEGACY (A3.5 Permanentes,
-- A3.6 Inversiones en subsidiarias y asociadas, codigos numericos para
-- resultados '1', '2', '10', etc) que NO coincide con la publicacion SBS
-- actual.
--
-- El bulk re-ingest historico (2008-2024) trajo los codigos canonicos desde
-- los archivos SBS reales. Los rows del Excel legacy quedan como ghost
-- duplicados que ensucian el Inspector (warning "cuenta extra que no esta
-- en cabecera-base").
--
-- FIX
--
-- Step 1: DELETE rows con source_file = 'BASE EE.FF..xlsx'. SBS files son
--         source-of-truth.
-- Step 2: UPDATE archivos_descargados.path_local de Windows -> path del
--         container (`/app/local-data/raw/...`). Eso es lo que ve
--         aibenchef-data y lo que el Inspector debe mostrar.
-- Step 3: DELETE cuenta_alias del legacy (codigo='A3.6', 'A3.5 Permanentes',
--         'C2', 'C7') que ya no aplican.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: cleanup raw.eeff_observacion del Excel legacy
-- -------------------------------------------------------------------------
DO $$
DECLARE v_deleted INT;
BEGIN
    DELETE FROM raw.eeff_observacion
     WHERE source_file LIKE '%BASE EE.FF%';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'V104 step1: % rows ghost eliminadas de raw.eeff_observacion', v_deleted;
END $$;

-- -------------------------------------------------------------------------
-- Step 2: normalizar path_local de Windows -> container
--
-- Pattern: 'D:\PROYECTO\SBS\aibenchef\data-platform\local-data\raw\<grupo>\
--          <topico>\<year>\<month>\<file>.xls'
--   -> '/app/local-data/raw/<grupo>/<topico>/<year>/<month>/<file>.xls'
-- -------------------------------------------------------------------------
DO $$
DECLARE v_updated INT;
BEGIN
    UPDATE raw.archivos_descargados
       SET path_local = REPLACE(
            REPLACE(
                path_local,
                'D:\PROYECTO\SBS\aibenchef\data-platform\local-data\raw\',
                '/app/local-data/raw/'
            ),
            '\',
            '/'
        ),
        actualizado_en = now()
     WHERE path_local LIKE 'D:\PROYECTO\SBS\aibenchef\data-platform\local-data\raw\%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'V104 step2: % paths Windows -> container normalizados', v_updated;
END $$;

-- -------------------------------------------------------------------------
-- Step 3: cleanup cuenta_alias de codigos legacy que ya no aplican
--
-- A3.6 'Inversiones en subsidiarias y asociadas' fue mergeado por SBS en
-- A3.5 'Inversiones en Subsidiarias, Asociadas y Negocios Conjuntos'.
-- A3.5 'Permanentes' tambien fue mergeado en el nuevo A3.5.
-- C2 'Capital Adicional y Ajustes al Patrimonio' fue separado en C3 + C5.
-- C7 'Resultados no realizados' eliminado.
-- -------------------------------------------------------------------------
DO $$
DECLARE v_deleted INT;
BEGIN
    DELETE FROM dw.cuenta_alias
     WHERE codigo IN ('A3.6', 'C2', 'C7', 'A3.1', 'A3.9');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'V104 step3: % aliases de codigos legacy eliminados', v_deleted;
END $$;

COMMIT;

-- -------------------------------------------------------------------------
-- Reporte final
-- -------------------------------------------------------------------------
DO $$
DECLARE
    v_remaining_baseeeff INT;
    v_windows_paths INT;
    v_total_obs INT;
BEGIN
    SELECT count(*) INTO v_remaining_baseeeff
      FROM raw.eeff_observacion WHERE source_file LIKE '%BASE EE.FF%';
    SELECT count(*) INTO v_windows_paths
      FROM raw.archivos_descargados WHERE path_local LIKE 'D:\%';
    SELECT count(*) INTO v_total_obs FROM raw.eeff_observacion;

    RAISE NOTICE 'V104 verify: % rows BASE EE.FF remaining (esperado 0)', v_remaining_baseeeff;
    RAISE NOTICE 'V104 verify: % paths Windows remaining (esperado 0)', v_windows_paths;
    RAISE NOTICE 'V104 verify: % rows totales en raw.eeff_observacion', v_total_obs;
END $$;
