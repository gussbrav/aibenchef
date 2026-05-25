-- =========================================================================
-- V068: Dos fixes verificados contra Excel PTO Equilibrio:
--
-- 1) "Cartera x Empleado" y "N° Clientes x Empleado" usan SOLO la columna
--    `empleados` (no `total`), segun formula R36/R37 de la hoja
--    'Resumen Historico Compartam (2)':
--      Cartera x Empleado = Cartera_Bruta / N° Empleados
--      N° Clientes x Empleado = N° Clientes / N° Empleados
--    N17 ('N° de empleados') es distinto a N16 ('N° de personal').
--    Personal incluye gerentes + funcionarios + empleados + otros;
--    Empleados es solo la categoría empleados.
--
-- 2) Funcion dw.nombre_vigente_en_periodo(canonico, periodo): cuando el
--    toggle 'renombres separados' (consolidar=false) esta activo y el peer
--    group usa el canonico actual (ej. 'Compartamos Banco'), las vistas
--    historicas no tienen ese nombre pre-conversion. Esta funcion sigue
--    la cadena de renombres HACIA ATRAS hasta el nombre vigente en el
--    periodo solicitado.
-- =========================================================================

-- ---------- 1) AGREGAR n_empleados A LAS VISTAS DE PERSONAL ----------
DROP VIEW IF EXISTS marts.v_personal_por_entidad_canonico CASCADE;
DROP VIEW IF EXISTS marts.v_personal_por_entidad CASCADE;

CREATE VIEW marts.v_personal_por_entidad AS
SELECT
    periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(p.empresa_sbs))
         LIMIT 1),
        INITCAP(dw.limpiar_nombre_raw(p.empresa_sbs))
    ) AS nomb_correg,
    SUM(p.total)::int     AS n_personal,
    SUM(p.empleados)::int AS n_empleados
FROM raw.personal_observacion p
WHERE p.empresa_sbs IS NOT NULL
  AND LOWER(TRIM(p.empresa_sbs)) NOT IN ('total general', 'total', '')
  AND p.total IS NOT NULL
GROUP BY periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(p.empresa_sbs))
         LIMIT 1),
        INITCAP(dw.limpiar_nombre_raw(p.empresa_sbs))
    );

CREATE VIEW marts.v_personal_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_personal)::int  AS n_personal,
    SUM(n_empleados)::int AS n_empleados
FROM marts.v_personal_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);


-- ---------- 2) FUNCION: NOMBRE VIGENTE EN UN PERIODO ----------
-- Dada una entidad (cualquier nombre suyo) y un periodo P, devuelve cual
-- de sus nombres historicos era vigente en P.
--
-- Algoritmo:
--   1) Resolver entrada -> canonico actual (cadena hacia adelante).
--   2) Buscar el ultimo renombre cuya nomb_correg_actual sea el canonico
--      o un nombre intermedio Y cuyo periodo_cambio > P. Retroceder.
--   3) Si no hay renombre con periodo_cambio > P, el nombre vigente en P
--      es el canonico actual.
CREATE OR REPLACE FUNCTION dw.nombre_vigente_en_periodo(_nombre TEXT, _periodo INT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _current TEXT;
    _prev    TEXT;
    _depth   INT := 0;
BEGIN
    -- Paso 1: resolver al canonico actual
    _current := dw.resolver_nomb_correg_canonico(_nombre);
    IF _current IS NULL THEN RETURN _nombre; END IF;

    -- Paso 2: retroceder por la cadena de renombres mientras el cambio
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

    RETURN _current;
END;
$$;

COMMENT ON FUNCTION dw.nombre_vigente_en_periodo(TEXT, INT) IS
    'Dado un label de entidad y un periodo YYYYMM, devuelve el nombre que '
    'tenia la entidad ese periodo siguiendo el grafo de renombres hacia atras.';
