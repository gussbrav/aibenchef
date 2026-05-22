-- =========================================================================
-- V022: dw.normalizar_entidad v2 — quitar newlines + aliases nuevos
--
-- Problemas detectados en produccion (dropdown EE.FF.):
--   1. 'Banco de Crédito con Sucursales en el \nExterior' aparecia DUPLICADO
--      junto a 'Banco de Crédito con Sucursales en el Exterior'.
--      Causa: el .xls SBS guarda nombres con line break interno en la celda.
--   2. Variantes del mismo banco con guion: 'Banco de Crédito - Sucursales'
--   3. TOTAL_* aparecian como entidades normales en el selector.
-- =========================================================================

DROP FUNCTION IF EXISTS dw.normalizar_entidad(TEXT);

CREATE OR REPLACE FUNCTION dw.normalizar_entidad(input TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT
AS $$
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
    -- 6. Aplicar aliases registrados en dw.entidad_alias (si existe la tabla)
    RETURN COALESCE(
        (SELECT nomb_correg FROM dw.entidad_alias WHERE alias = v LIMIT 1),
        v
    );
END;
$$;

COMMENT ON FUNCTION dw.normalizar_entidad(TEXT) IS
    'v2 (V022): normaliza nombre de entidad. Quita newlines, colapsa espacios, '
    'quita asteriscos/sufijos N/, aplica aliases de dw.entidad_alias.';

-- ============================================================
-- Aliases nuevos para banco de credito (consolidar variantes)
-- ============================================================
-- 'Banco de Credito - Sucursales' es el mismo banco "con sucursales en el exterior"
-- 'Banco de Credito' (sin "del Peru") era el nombre antiguo de "Banco de Credito del Peru"

INSERT INTO dw.entidad_alias (alias, nomb_correg, fuente) VALUES
    ('Banco de Crédito - Sucursales', 'Banco de Crédito con Sucursales en el Exterior', 'sbs_consolidacion'),
    -- Banco de Credito a secas: dejarlo como alias del nombre actual del Banco
    -- (NO de la version con sucursales en el exterior — son entidades distintas)
    -- Solo si Gus confirma, agregar:
    -- ('Banco de Crédito', 'Banco de Crédito del Perú', 'sbs_rename_2020', NULL)
    (E'Banco de Crédito con Sucursales en el \nExterior', 'Banco de Crédito con Sucursales en el Exterior', 'sbs_newline_fix')
ON CONFLICT (alias) DO UPDATE SET
    nomb_correg = EXCLUDED.nomb_correg,
    fuente = EXCLUDED.fuente;

-- ============================================================
-- Marcar TOTAL_* como es_total (no son entidades reportantes)
-- ============================================================
UPDATE dw.dim_entidad
SET es_total = TRUE
WHERE nomb_correg ILIKE 'TOTAL %' AND NOT es_total;
