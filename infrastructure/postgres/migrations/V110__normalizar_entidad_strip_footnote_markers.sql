-- =========================================================================
-- V110: extender dw.normalizar_entidad() para strip de footnote markers (*)
--
-- CONTEXTO
--
-- La funcion no strip-eaba el patron "(*)" / "(**)" → CMAC Arequipa quedaba
-- como "CMAC Arequipa (*)" en raw (issue reportado por el usuario).
-- V109 hizo el cleanup masivo. V110 extiende la funcion para que futuras
-- ingestas no re-introduzcan el bug.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION dw.normalizar_entidad(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $function$
DECLARE
    v TEXT;
BEGIN
    v := input;
    -- 1. Reemplazar newlines/tabs por espacio
    v := regexp_replace(v, E'[\\n\\r\\t]+', ' ', 'g');
    -- 2. Colapsar espacios multiples
    v := regexp_replace(v, '\s+', ' ', 'g');
    -- 3. Trim
    v := btrim(v);
    -- 4. Quitar superindices unicode comunes (1/, 2/, etc) al final
    v := regexp_replace(v, '\s*\d+/\s*$', '');
    -- 5. Quitar asteriscos finales
    v := regexp_replace(v, '\*+\s*$', '');
    v := btrim(v);
    -- 6. V110: quitar footnote markers parentizados "(*)" / "(**)" al final
    v := regexp_replace(v, '\s*\(\*+\)\s*$', '');
    -- 7. V110: cortar texto luego de asterisco interno "Total Banca Múltiple* Incluye..."
    v := regexp_replace(v, '\s*\*+\s+.*$', '');
    v := btrim(v);
    -- 8. Aplicar aliases registrados en dw.entidad_alias (si existe la tabla)
    RETURN COALESCE(
        (SELECT nomb_correg FROM dw.entidad_alias WHERE alias = v LIMIT 1),
        v
    );
END;
$function$;

COMMIT;

-- -------------------------------------------------------------------------
-- Verificar normalizacion correcta de casos problematicos
-- -------------------------------------------------------------------------
DO $$
DECLARE v_result TEXT;
BEGIN
    v_result := dw.normalizar_entidad('CMAC Arequipa (*)');
    IF v_result != 'CMAC Arequipa' THEN
        RAISE EXCEPTION 'V110 fail: "CMAC Arequipa (*)" -> "%" (esperaba "CMAC Arequipa")', v_result;
    END IF;
    v_result := dw.normalizar_entidad('TOTAL CAJAS MUNICIPALES (**)');
    IF v_result != 'TOTAL CAJAS MUNICIPALES' THEN
        RAISE EXCEPTION 'V110 fail: "TOTAL CAJAS MUNICIPALES (**)" -> "%"', v_result;
    END IF;
    v_result := dw.normalizar_entidad('Total Banca Múltiple* Incluye Sucursales en el Exterior');
    IF v_result != 'Total Banca Múltiple' THEN
        RAISE EXCEPTION 'V110 fail: "Total Banca M*..." -> "%"', v_result;
    END IF;
    RAISE NOTICE 'V110 OK: footnote markers normalizados correctamente';
END $$;
