-- =========================================================================
-- V116: dw.resolver_nomb_correg_para_periodo — canonical-historico para
--       resolver el nombre de la entidad vigente en un periodo dado.
--
-- PROBLEMA:
--   `resolver_nomb_correg_canonico` retorna el nombre canonico ACTUAL
--   (post-renombre). Ej: "Compartamos" -> "Compartamos Banco" siempre,
--   incluso para periodos donde la entidad operaba como "Financiera
--   Compartamos" (pre-202303).
--
--   Resultado: cuando el operador activa "Renombres unidos" para periodos
--   pre-conversion, las marts no tienen data bajo "Compartamos Banco"
--   (no existia aun) y el Informe muestra columnas vacias.
--
-- FIX:
--   Esta funcion busca el nombre canonico actual, despues consulta
--   `dw.entidad_renombre` para ver si hubo un renombre/conversion DESPUES
--   del periodo solicitado. Si si, retorna el nombre anterior (vigente en
--   ese periodo).
--
-- EJEMPLOS:
--   dw.resolver_nomb_correg_para_periodo('Compartamos', 202004)
--     -> 'Financiera Compartamos' (porque conversion fue en 202303 > 202004)
--   dw.resolver_nomb_correg_para_periodo('Compartamos', 202501)
--     -> 'Compartamos Banco' (post-conversion)
--   dw.resolver_nomb_correg_para_periodo('Mibanco', 202004)
--     -> 'Mibanco' (sin renombre aplicable)
--
-- USO:
--   getPuntoEquilibrioForPeriodo (apps/web/lib/domains/informe/queries.ts)
--   debe usar esta funcion en lugar de resolver_nomb_correg_canonico
--   cuando consolidar=true Y necesita historico.
-- =========================================================================

CREATE OR REPLACE FUNCTION dw.resolver_nomb_correg_para_periodo(_raw TEXT, _periodo INT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _canonical TEXT;
    _anterior  TEXT;
    _depth     INT := 0;
BEGIN
    IF _raw IS NULL OR _raw = '' THEN
        RETURN _raw;
    END IF;

    -- Paso 1: obtener canonical actual via funcion existente.
    _canonical := dw.resolver_nomb_correg_canonico(_raw);

    -- Paso 2: caminar hacia atras en la cadena de renombres si el cambio
    -- fue DESPUES del periodo solicitado. Loop para casos de multiples
    -- renombres encadenados (A -> B -> C con periodos distintos).
    LOOP
        SELECT nomb_correg_anterior INTO _anterior
        FROM dw.entidad_renombre
        WHERE nomb_correg_actual = _canonical
          AND activo
          AND consolidar_por_default
          AND periodo_cambio IS NOT NULL
          AND _periodo < periodo_cambio
        ORDER BY periodo_cambio DESC  -- el cambio mas reciente que aplica
        LIMIT 1;

        EXIT WHEN _anterior IS NULL OR _depth >= 10;
        _canonical := _anterior;
        _depth := _depth + 1;
    END LOOP;

    RETURN _canonical;
END;
$$;

COMMENT ON FUNCTION dw.resolver_nomb_correg_para_periodo(TEXT, INT) IS
'Retorna el nombre canonico vigente de una entidad en un periodo especifico, siguiendo la cadena de renombres hacia atras. Usado por Informe Ejecutivo con "Renombres unidos" activo para que periodos pre-conversion muestren la entidad correcta. Issue #65 + Compartamos 202004.';
