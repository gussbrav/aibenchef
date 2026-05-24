-- =========================================================================
-- V059: Mejora dw.resolver_nomb_correg_canonico() para que tambien
-- consulte `dw.entidad_nombre` (aliases) ademas de seguir la cadena
-- de renombres.
--
-- Motivo: si el peer group usa un label corto/alias (ej. 'Compartamos',
-- 'BCP', 'BBVA') el resolver anterior devolvia el input tal cual, el
-- query no matcheaba con el canonico real y el cuadro resumen quedaba
-- vacio para esa entidad.
--
-- Nuevo flow:
--   Paso 1: si el input matchea un alias en entidad_nombre, traer el
--           canonico de entidad_maestra y seguir desde ahi.
--   Paso 2: seguir la cadena de renombres como antes (max 10 iter).
-- =========================================================================

CREATE OR REPLACE FUNCTION dw.resolver_nomb_correg_canonico(_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _current TEXT := _raw;
    _next    TEXT;
    _depth   INT := 0;
BEGIN
    IF _raw IS NULL OR _raw = '' THEN
        RETURN _raw;
    END IF;

    -- Paso 1: consultar entidad_nombre (alias / canonico / razon_social /
    -- historico). Si hay match, partimos del canonico de la entidad maestra.
    SELECT em.nomb_correg_canonico INTO _next
    FROM dw.entidad_nombre en
    JOIN dw.entidad_maestra em ON em.id = en.entidad_id
    WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(_current))
       OR LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(_current))
    ORDER BY
        -- Preferimos match exacto sobre limpieza
        CASE WHEN LOWER(TRIM(en.nombre)) = LOWER(TRIM(_current)) THEN 0 ELSE 1 END,
        -- Preferimos tipo canonico > razon_social > alias > historico
        CASE en.tipo
            WHEN 'canonico' THEN 0
            WHEN 'razon_social' THEN 1
            WHEN 'alias' THEN 2
            WHEN 'historico' THEN 3
            ELSE 9
        END
    LIMIT 1;

    IF _next IS NOT NULL THEN
        _current := _next;
    END IF;

    -- Paso 2: seguir la cadena de renombres (fusion, rebranding, conversion).
    LOOP
        SELECT nomb_correg_actual INTO _next
        FROM dw.entidad_renombre
        WHERE nomb_correg_anterior = _current
          AND activo
          AND consolidar_por_default
        LIMIT 1;
        EXIT WHEN _next IS NULL OR _next = _current OR _depth >= 10;
        _current := _next;
        _depth := _depth + 1;
    END LOOP;

    RETURN _current;
END;
$$;

COMMENT ON FUNCTION dw.resolver_nomb_correg_canonico(TEXT) IS
    'Resuelve un nombre raw a su canonico actual. Consulta primero '
    'dw.entidad_nombre (aliases) y luego sigue la cadena de renombres '
    'en dw.entidad_renombre. Acepta labels cortos, aliases, razon social, '
    'nombres historicos, o el canonico mismo (idempotente).';


-- ---------- ALIASES CORTOS COMUNES ----------
-- Labels que la gente usa al editar peer groups manualmente.
DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        ['Compartamos',                  'Compartamos Banco'],
        ['Compartamos Banco',            'Compartamos Banco'],
        ['BCP',                          'Banco de Crédito con Sucursales en el Exterior'],
        ['Banco de Crédito del Perú',    'Banco de Crédito con Sucursales en el Exterior'],
        ['BBVA',                         'Banco BBVA Perú'],
        ['Banco BBVA',                   'Banco BBVA Perú'],
        ['Scotia',                       'Scotiabank Perú'],
        ['Scotiabank',                   'Scotiabank Perú'],
        ['Falabella',                    'Banco Falabella Perú'],
        ['Banco Falabella',              'Banco Falabella Perú'],
        ['Pichincha',                    'Banco Pichincha'],
        ['Santander',                    'Banco Santander Perú'],
        ['Ripley',                       'Banco Ripley'],
        ['Edyficar',                     'Mibanco']
    ];
    par TEXT[];
    canon_id BIGINT;
    inserted_count INT := 0;
BEGIN
    FOREACH par SLICE 1 IN ARRAY pares LOOP
        SELECT id INTO canon_id FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = par[2] LIMIT 1;
        IF canon_id IS NULL THEN CONTINUE; END IF;
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V059 — label corto comun')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
        inserted_count := inserted_count + 1;
    END LOOP;
    RAISE NOTICE 'V059: % aliases cortos procesados', inserted_count;
END $$;
