-- =========================================================================
-- V077: Mejora dw.limpiar_nombre_raw para que tambien quite sufijos
-- legales comunes (' S A', ' S.A.', ' S.A.C.', ' S A.', etc).
--
-- Bug: raw oficinas tiene 'CMAC CUSCO S A' que mi sistema mapeaba a
-- 'Cmac Cusco S A' (INITCAP) sin matchear el canonico 'CMAC Cusco'.
-- Mismo problema con 'FINANCIERA OH S A', 'EDPYME PROGRESO S.A.', etc.
--
-- Fix: limpiar_nombre_raw ahora aplica un strip extra al final del
-- string para sufijos legales. Como esta funcion se usa en LOWER(...)
-- para match con entidad_nombre, el resultado se canoniza correctamente.
-- =========================================================================

CREATE OR REPLACE FUNCTION dw.limpiar_nombre_raw(raw_nombre TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    COALESCE(raw_nombre, ''),
                    -- Marcadores de notas al pie al final
                    '\s*(\*+|\([\*p\)]+\)|\d+/|\s\*+)$',
                    '',
                    'g'
                ),
                -- Sufijos intermedios con espacio: "Foo *", "Foo 1/"
                '\s+(\*+|\d+/)$',
                '',
                'g'
            ),
            -- Sufijos legales al final: ' S A', ' S.A.', ' S.A.C.', ' S A C',
            -- ' S A.', ' SA', ' S.A.A.', 'S.A.A', etc.
            '\s+S\.?\s?A\.?(\s?[AC]\.?)?\s*$',
            '',
            'gi'
        )
    );
$$;


-- Agregar aliases especificos para nombres truncados que aun no matchean
-- aun despues del strip de sufijos:
DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        -- Edpyme Progreso: no existe canonico en entidad_maestra; mapear a una nueva
        -- entidad si aparece. Por ahora dejamos como esta (INITCAP).
        -- Add aliases UPPERCASE comunes en oficinas pre-2013 que no estaban:
        ['CMAC CUSCO',                 'CMAC Cusco'],
        ['FINANCIERA OH',              'Financiera Oh!'],
        ['EDPYME PROGRESO',            'Edpyme GMG']
    ];
    par TEXT[];
    canon_id BIGINT;
BEGIN
    FOREACH par SLICE 1 IN ARRAY pares LOOP
        SELECT id INTO canon_id FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = par[2] LIMIT 1;
        IF canon_id IS NULL THEN CONTINUE; END IF;
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V077 — nombres SBS sin sufijo legal')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
    END LOOP;
END $$;
