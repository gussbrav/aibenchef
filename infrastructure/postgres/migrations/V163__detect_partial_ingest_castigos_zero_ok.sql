-- =========================================================================
-- V163 — detect_partial_ingest: reconocer '0 castigos legitimos' vs bug
--
-- CONTEXTO: raw.detect_partial_ingest() marca todo archivo con
-- filas_insertadas=0 como sospechoso (reason='rows_insertadas_null_o_cero').
-- Correcto para la mayoria de topicos, PERO castigos es especial:
--
-- El importer monthly_castigos_importer.py TIENE logica explicita para
-- distinguir "vacio legitimo" vs "vacio por bug":
--
--   Si encontro empresas pero todos sus valores son 0/null:
--     return rows_inserted=0, rows_skipped=empresas_validas, errors=()
--     → status='procesado', filas_insertadas=0, ES LEGITIMO
--
--   Si no encontro ni empresas:
--     return rows_inserted=0, rows_skipped=0, errors=('sin filas',)
--     → status='sospechoso' o error, ES BUG
--
-- CASO REAL (screenshot usuario 2026-08-10):
--   202604 · edpyme · castigos · rows_insertadas=0
--   El importer proceso el archivo OK (status='procesado', sin error).
--   Las edpymes simplemente no tuvieron castigos en abril 2024 — es un
--   evento LEGITIMO, no un bug.
--
-- FIX: extender detect_partial_ingest para diferenciar:
--   - topico='castigos' + rows=0 + status='procesado' → ok=true (legitimo)
--   - cualquier otro caso con rows=0 → sospechoso (como antes)
--
-- Los otros topicos (eeff, colocaciones, personal, etc) SIEMPRE deberian
-- tener filas si SBS publico — 0 filas ahi SI es sospechoso.
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
BEGIN
    SELECT grupo, topico, periodo, filas_insertadas, status
      INTO _grupo, _topico, _periodo, _rows_actual, _status
      FROM raw.archivos_descargados
     WHERE id = _archivo_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'reason', 'archivo_no_encontrado');
    END IF;

    -- V163: castigos con 0 filas + status='procesado' es LEGITIMO.
    -- Las entidades pueden no tener castigos en un mes puntual — no es bug.
    -- El importer ya distinguio esto (rows_skipped > 0 en su ImportResult)
    -- y marco el archivo como 'procesado' (no 'sospechoso') sin errors.
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

    -- Promedio de los ultimos 6 meses del mismo (grupo, topico), excluyendo
    -- el archivo actual, meses sin publicacion SBS y filas nulas.
    SELECT AVG(filas_insertadas)::NUMERIC, COUNT(*)::INT
      INTO _rows_prom, _n_meses
      FROM (
        SELECT filas_insertadas
          FROM raw.archivos_descargados
         WHERE grupo   = _grupo
           AND topico  = _topico
           AND periodo < _periodo
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
    'V163: reconoce castigos vacios legitimos (0 filas + status=procesado). '
    'Antes marcaba todo archivo con 0 filas como sospechoso — falso positivo '
    'para castigos donde las entidades pueden no tener castigos en un mes '
    'puntual. Otros topicos (eeff, colocaciones, etc) con 0 filas siguen '
    'siendo sospechosos porque SIEMPRE deberian tener data si SBS publico.';
