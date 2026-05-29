-- =========================================================================
-- V112: Renumerar orden unificado modern+legacy (issue #42)
--
-- PROBLEMA
--
-- V105 inserto codigos legacy con orden 100-104 (balance) y 200-208
-- (resultados). Inspector ordena por orden -> legacy aparece al FINAL
-- de la tabla en lugar de intercalado en su posicion natural SBS.
--
-- Ejemplo: CMAC Arequipa 200901 muestra C1 (orden 77), C4 (79), C6 (81),
-- C8 (82), T (83), y DESPUES C2 (orden 100). Pero el archivo SBS pre-2013
-- publica C2 entre C1 y Reservas.
--
-- FIX
--
-- Helper function `dw.codigo_sort_key()` que retorna INTEGER[] para que
-- los codigos se ordenen naturalmente (C1 < C2 < C3 < ..., A3 < A3.1 < A3.2,
-- 1 < 1.1 < 1.10 < 2). Luego ROW_NUMBER OVER (PARTITION BY tipo_estado,
-- tipo_entidad ORDER BY sort_key) renumera todos los ordenes.
--
-- Los codigos legacy y modernos pueden compartir orden si tienen valido_desde
-- distintos (legacy=200801..201212, modern=201301..NULL). El PK
-- (tipo_estado, tipo_entidad, orden, valido_desde) lo permite.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: helper function para sort key natural de codigos
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dw.codigo_sort_key(codigo TEXT)
RETURNS INTEGER[]
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $$
DECLARE
    section_letter CHAR;
    section_num    INT;
    rest_str       TEXT;
    parts          INT[];
    p              TEXT;
BEGIN
    IF codigo IS NULL OR codigo = '' THEN
        RETURN ARRAY[0];
    END IF;

    -- Section letter A/B/C/D/T = 1..5, no letter (resultados) = 0
    section_letter := LEFT(codigo, 1);
    section_num := CASE section_letter
        WHEN 'A' THEN 1
        WHEN 'B' THEN 2
        WHEN 'C' THEN 3
        WHEN 'D' THEN 4
        WHEN 'T' THEN 5
        ELSE 0
    END;

    -- Rest of codigo after letter (or whole codigo for resultados)
    IF section_num > 0 THEN
        rest_str := SUBSTRING(codigo FROM 2);
    ELSE
        rest_str := codigo;
    END IF;

    parts := ARRAY[section_num];

    -- Split by dot, parse each as int
    FOREACH p IN ARRAY string_to_array(rest_str, '.')
    LOOP
        IF p = '' THEN
            CONTINUE;
        END IF;
        BEGIN
            parts := parts || p::INT;
        EXCEPTION WHEN OTHERS THEN
            -- Si la parte no es numerica (raro), usar 0
            parts := parts || 0;
        END;
    END LOOP;

    RETURN parts;
END;
$$;

-- -------------------------------------------------------------------------
-- Step 2: renumerar orden por (tipo_estado, tipo_entidad) usando sort_key
-- Bump x100000 primero para evitar conflict de PK durante el renumber.
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET orden = orden + 1000000;

WITH renumbered AS (
    SELECT
        tipo_estado, tipo_entidad, valido_desde, orden,
        ROW_NUMBER() OVER (
            PARTITION BY tipo_estado, tipo_entidad, valido_desde
            ORDER BY dw.codigo_sort_key(codigo) NULLS LAST, codigo
        ) AS new_orden
      FROM dw.cabecera_maestra
)
UPDATE dw.cabecera_maestra cm
   SET orden = r.new_orden,
       updated_at = now()
  FROM renumbered r
 WHERE cm.tipo_estado  = r.tipo_estado
   AND cm.tipo_entidad = r.tipo_entidad
   AND cm.valido_desde = r.valido_desde
   AND cm.orden        = r.orden;

COMMIT;

-- -------------------------------------------------------------------------
-- Reporte
-- -------------------------------------------------------------------------
DO $$
DECLARE v_max_orden_balance INT; v_max_orden_resultados INT;
BEGIN
    SELECT MAX(orden) INTO v_max_orden_balance
      FROM dw.cabecera_maestra WHERE tipo_estado='balance';
    SELECT MAX(orden) INTO v_max_orden_resultados
      FROM dw.cabecera_maestra WHERE tipo_estado='resultados';
    RAISE NOTICE 'V112: max orden balance=%, max orden resultados=% (deben ser razonables ~95 y ~70)',
        v_max_orden_balance, v_max_orden_resultados;
END $$;
