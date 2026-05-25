-- =========================================================================
-- V074: Regla ESTRICTA para nombres historicos especificos en
-- 'Renombres separados' (consolidar=false).
--
-- Semantica nueva:
--   - Si el peer label aparece en dw.entidad_renombre.nomb_correg_anterior
--     (es un nombre HISTORICO especifico, ya no vigente), entonces solo
--     debe mostrar data si el periodo solicitado pertenece a su rango de
--     vigencia. En periodos posteriores a su conversion -> NULL (vacio).
--   - Si el peer label es un canonico actual o un alias informal (no
--     historico), se mapea al nombre vigente del periodo (comportamiento
--     anterior).
--
-- Casos:
--   nombre_vigente_en_periodo('Financiera Compartamos', 202004) -> 'Financiera Compartamos'
--   nombre_vigente_en_periodo('Financiera Compartamos', 202603) -> NULL (estricto)
--   nombre_vigente_en_periodo('Compartamos Banco', 202004)      -> 'Financiera Compartamos'
--   nombre_vigente_en_periodo('Compartamos Banco', 202603)      -> 'Compartamos Banco'
--   nombre_vigente_en_periodo('Compartamos', 202004)            -> 'Financiera Compartamos'
--   nombre_vigente_en_periodo('Banco Continental', 201906)      -> NULL (post BBVA)
--   nombre_vigente_en_periodo('Banco Continental', 201803)      -> 'Banco Continental'
--
-- IMPORTANTE: la funcion dw.raw_to_vigente (usada para mapear nombres
-- RAW de las tablas raw.*) NO es afectada por esta regla, porque el
-- raw_name representa lo que existia en ese periodo. Para evitar romper
-- las vistas historicas, dw.raw_to_vigente ahora hace fallback al canonico
-- actual cuando nombre_vigente devuelve NULL.
-- =========================================================================

CREATE OR REPLACE FUNCTION dw.nombre_vigente_en_periodo(_nombre TEXT, _periodo INT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _current TEXT;
    _prev    TEXT;
    _depth   INT := 0;
    _is_historic BOOLEAN;
BEGIN
    IF _nombre IS NULL OR _nombre = '' THEN RETURN _nombre; END IF;

    -- Detectar si label es un NOMBRE HISTORICO ESPECIFICO
    SELECT EXISTS (
        SELECT 1 FROM dw.entidad_renombre
        WHERE nomb_correg_anterior = _nombre AND activo
    ) INTO _is_historic;

    -- Resolver al canonico actual
    _current := dw.resolver_nomb_correg_canonico(_nombre);
    IF _current IS NULL THEN RETURN _nombre; END IF;

    -- Retroceder por la cadena de renombres mientras el cambio
    -- haya ocurrido DESPUES del periodo solicitado.
    LOOP
        SELECT nomb_correg_anterior INTO _prev
        FROM dw.entidad_renombre
        WHERE nomb_correg_actual = _current
          AND activo
          AND periodo_cambio > _periodo
        ORDER BY periodo_cambio ASC
        LIMIT 1;

        EXIT WHEN _prev IS NULL OR _prev = _current OR _depth >= 10;
        _current := _prev;
        _depth   := _depth + 1;
    END LOOP;

    -- REGLA ESTRICTA: si el label original es un nombre historico especifico
    -- pero el vigente en el periodo es OTRO nombre, devolver NULL.
    IF _is_historic AND LOWER(TRIM(_nombre)) != LOWER(TRIM(_current)) THEN
        RETURN NULL;
    END IF;

    RETURN _current;
END;
$$;


-- raw_to_vigente NO debe aplicar la regla estricta porque maps datos raw
-- que existen en ese periodo. Si nombre_vigente_en_periodo devuelve NULL
-- (caso historico fuera de rango), fallback al canonico actual.
CREATE OR REPLACE FUNCTION dw.raw_to_vigente(_raw TEXT, _periodo INT)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(
        dw.nombre_vigente_en_periodo(
            COALESCE(
                (SELECT em.nomb_correg_canonico
                 FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
                 WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(_raw))
                 LIMIT 1),
                INITCAP(dw.limpiar_nombre_raw(_raw))
            ),
            _periodo
        ),
        -- Fallback: si nombre_vigente_en_periodo devuelve NULL (regla estricta),
        -- usar el canonico actual.
        dw.resolver_nomb_correg_canonico(
            COALESCE(
                (SELECT em.nomb_correg_canonico
                 FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
                 WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(_raw))
                 LIMIT 1),
                INITCAP(dw.limpiar_nombre_raw(_raw))
            )
        )
    );
$$;
