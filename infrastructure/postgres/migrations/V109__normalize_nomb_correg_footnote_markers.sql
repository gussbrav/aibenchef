-- =========================================================================
-- V109: Normalizar nomb_correg removiendo footnote markers SBS (issue #42)
--
-- CONTEXTO
--
-- SBS publica algunos nombres de entidades con anotaciones tipo footnote:
--   - "CMAC Arequipa (*)" — 26 periodos
--   - "CMAC Pisco (*)" — 4 periodos
--   - "CRAC Chavín (*)" / "CRAC Raíz (*)" / "CRAC Señor de Luren (*)" — 1
--   - "TOTAL CAJAS MUNICIPALES (**)" — 4 periodos
--   - "Total Banca Múltiple* Incluye Sucursales..." — 1 periodo
--
-- El asterisco/doble-asterisco indica nota al pie en el archivo SBS (ej.
-- merger, restructuracion del periodo). Como entity name canonico debe
-- ser el mismo, normalizamos quitando el sufijo.
--
-- IMPACTO: Inspector busca por `CMAC Arequipa` (sin asterisco) y no
-- encuentra data → todos los periodos con "(*)" salen vacios. Bug reportado
-- por el usuario en 201701, 201801, etc.
--
-- FIX: TRIM + REGEXP_REPLACE para remover sufijos de footnote.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: normalizar nomb_correg en raw.eeff_observacion
-- Patrones:
--   '\s*\(\*+\)\s*$'  — " (*)" o " (**)" al final
--   '\*+\s+'           — "X* Incluye..." con asterisco interno
-- -------------------------------------------------------------------------
-- Step 1a: DELETE rows con footnote-marker SI ya existe row normalizada
-- para la misma key (evita conflict de unique constraint).
DELETE FROM raw.eeff_observacion AS r
 WHERE r.nomb_correg ~ '[\(\*]'
   AND EXISTS (
       SELECT 1 FROM raw.eeff_observacion r2
        WHERE r2.periodo = r.periodo
          AND r2.moneda = r.moneda
          AND r2.tipo_estado = r.tipo_estado
          AND r2.cuenta_codigo IS NOT DISTINCT FROM r.cuenta_codigo
          AND r2.nomb_correg = TRIM(REGEXP_REPLACE(
              REGEXP_REPLACE(r.nomb_correg, '\s*\(\*+\)\s*$', ''),
              '\s*\*+\s+.*$', ''))
   );

-- Step 1b: UPDATE rows restantes
UPDATE raw.eeff_observacion
   SET nomb_correg = TRIM(REGEXP_REPLACE(nomb_correg, '\s*\(\*+\)\s*$', ''))
 WHERE nomb_correg ~ '\(\*+\)\s*$';

UPDATE raw.eeff_observacion
   SET nomb_correg = TRIM(REGEXP_REPLACE(nomb_correg, '\s*\*+\s+.*$', ''))
 WHERE nomb_correg ~ '\*+\s+\w';

-- -------------------------------------------------------------------------
-- Reporte
-- -------------------------------------------------------------------------
DO $$
DECLARE v_remaining INT; v_entities INT;
BEGIN
    SELECT count(*) INTO v_remaining
      FROM raw.eeff_observacion WHERE nomb_correg ~ '[\(\*]';
    SELECT count(DISTINCT nomb_correg) INTO v_entities
      FROM raw.eeff_observacion;
    RAISE NOTICE 'V109: % rows con footnote markers restantes; % entidades distintas en raw',
        v_remaining, v_entities;
END $$;

COMMIT;
