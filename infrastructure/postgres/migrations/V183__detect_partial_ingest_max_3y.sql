-- =========================================================================
-- V183 — detect_partial_ingest: limitar historia a maximo 3 anos
--
-- ROOT CAUSE (descubierto 2026-09-10):
--   B-3241-jl2026.xls (financiera/creditos_depositos_geo, Jul 2026)
--   fue marcado sospechoso por partial ingest: 310 filas vs prom=881.
--   El promedio de 881 se explica porque la subquery:
--
--     WHERE grupo='financiera' AND topico='creditos_depositos_geo'
--       AND periodo < 202607 AND status='procesado'
--       AND filas_insertadas IS NOT NULL AND filas_insertadas > 0
--     ORDER BY periodo DESC LIMIT 6
--
--   salta los nulos de 202601-202603 y llega hasta B-3241-jl2009.xls
--   (200907, 2220 filas), inflando el promedio:
--     (310 + 485 + 509 + 2220) / 4 = 881
--
--   En 2009 habia mas puntos de datos (distinta granularidad SBS), por
--   lo que mezclar el historial de 2009 con el de 2026 produce falsos
--   positivos. La vista v_archivos_sospechosos (V162) ya excluye <202001
--   para la UI, pero la funcion en si no tenia esa proteccion.
--
-- FIX: agregar AND periodo >= _periodo - 300 al historial de comparacion.
--   _periodo - 300 = mismo mes 3 anos atras (ej. 202607 - 300 = 202307).
--   Asi solo se comparan con los 6 meses mas recientes DENTRO DE LOS
--   ULTIMOS 3 ANOS, evitando saltar a decadas anteriores.
-- =========================================================================

CREATE OR REPLACE FUNCTION raw.detect_partial_ingest(_archivo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _grupo        TEXT;
    _topico       TEXT;
    _periodo      INT;
    _rows_actual  INT;
    _status       TEXT;
    _rows_prom    NUMERIC;
    _n_meses      INT;
    _ratio        NUMERIC;
    _threshold    CONSTANT NUMERIC := 0.60;
    _min_history  CONSTANT INT     := 3;
    _max_lookback CONSTANT INT     := 300; -- 3 anos (formato YYYYMM aritmetico)
BEGIN
    SELECT grupo, topico, periodo, filas_insertadas, status
      INTO _grupo, _topico, _periodo, _rows_actual, _status
      FROM raw.archivos_descargados
     WHERE id = _archivo_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'reason', 'archivo_no_encontrado');
    END IF;

    -- V163: castigos con 0 filas + status='procesado' es LEGITIMO.
    IF _rows_actual = 0 AND _topico = 'castigos' AND _status = 'procesado' THEN
        RETURN jsonb_build_object(
            'ok', true,
            'reason', 'castigos_vacios_legitimos',
            'note', 'las entidades no tuvieron castigos este mes'
        );
    END IF;

    IF _rows_actual IS NULL OR _rows_actual = 0 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'rows_insertadas_null_o_cero',
            'rows_actual', _rows_actual
        );
    END IF;

    -- Promedio de los ultimos 6 meses del mismo (grupo, topico) dentro de
    -- los ultimos 3 anos. El limite de 3 anos evita saltar a decadas
    -- anteriores cuando los meses recientes tienen filas_insertadas=NULL
    -- (archivos importados antes de que se trackease esta columna).
    -- V183: agregado AND periodo >= _periodo - _max_lookback.
    SELECT AVG(filas_insertadas)::NUMERIC, COUNT(*)::INT
      INTO _rows_prom, _n_meses
      FROM (
        SELECT filas_insertadas
          FROM raw.archivos_descargados
         WHERE grupo   = _grupo
           AND topico  = _topico
           AND periodo < _periodo
           AND periodo >= _periodo - _max_lookback
           AND status  = 'procesado'
           AND filas_insertadas IS NOT NULL
           AND filas_insertadas > 0
         ORDER BY periodo DESC
         LIMIT 6
      ) sub;

    IF _n_meses < _min_history OR _rows_prom IS NULL OR _rows_prom = 0 THEN
        RETURN jsonb_build_object(
            'ok', true,
            'reason', 'sin_historia_suficiente',
            'n_meses_comparados', _n_meses
        );
    END IF;

    _ratio := _rows_actual::NUMERIC / _rows_prom;

    IF _ratio < _threshold THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'filas_muy_por_debajo_del_promedio',
            'ratio', ROUND(_ratio, 4),
            'threshold', _threshold,
            'rows_actual', _rows_actual,
            'rows_promedio', ROUND(_rows_prom, 1),
            'n_meses_comparados', _n_meses
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'ratio', ROUND(_ratio, 4),
        'rows_actual', _rows_actual,
        'rows_promedio', ROUND(_rows_prom, 1),
        'n_meses_comparados', _n_meses
    );
END;
$$;

COMMENT ON FUNCTION raw.detect_partial_ingest IS
    'V183: limita el historial de comparacion a los ultimos 3 anos '
    '(periodo >= _periodo - 300) para evitar que nulos recientes lleven '
    'la ventana de LIMIT 6 a decadas anteriores e inflen el promedio. '
    'V163: castigos vacios legitimos devuelven ok=true. '
    'Threshold: <60% del promedio de los ultimos 6 meses (dentro de 3 anos) '
    'del mismo (grupo,topico), con >=3 meses de historia.';
