-- V152 — Auto-detect + merge robusto Compartamos (retry de V151)
--
-- V151 hizo 4 intentos con nombres canonicos hardcodeados y ninguno
-- matcheo (segun feedback del usuario: "Financiera Compartamos" sigue
-- apareciendo con warning de sin data reciente).
--
-- V152 hace un DO block que busca automaticamente en dw.entidad_maestra
-- todos los canonicos con 'compartamos' en el nombre, elige el que tiene
-- la data MAS RECIENTE (via marts.v_eeff_resultados_ancho) como canonico
-- ACTUAL, y mergea todos los demas hacia el.
--
-- Idempotente: si no encuentra >1 canonico con 'compartamos', no hace
-- nada. Si ya se mergeo antes (activa=FALSE), tambien no-op.

DO $$
DECLARE
    v_actual_id BIGINT;
    v_actual_nombre TEXT;
    v_historico RECORD;
    v_result RECORD;
BEGIN
    -- Elegir el canonico ACTIVO con data mas reciente como 'actual'.
    SELECT em.id, em.nomb_correg_canonico
    INTO v_actual_id, v_actual_nombre
    FROM dw.entidad_maestra em
    JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(periodo) AS max_periodo
        FROM marts.mv_eeff_resultados_ancho r
        WHERE LOWER(TRIM(r.nomb_correg)) = LOWER(TRIM(en.nombre))
    ) datos ON TRUE
    WHERE LOWER(em.nomb_correg_canonico) LIKE '%compartamos%'
      AND em.activa = TRUE
    GROUP BY em.id, em.nomb_correg_canonico
    ORDER BY MAX(datos.max_periodo) DESC NULLS LAST, em.id ASC
    LIMIT 1;

    IF v_actual_id IS NULL THEN
        RAISE NOTICE 'V152: no hay canonicos activos con compartamos — nada que mergear';
        RETURN;
    END IF;

    RAISE NOTICE 'V152: canonico actual elegido = % (id=%)', v_actual_nombre, v_actual_id;

    -- Mergear TODOS los otros canonicos con 'compartamos' (activos o no)
    -- hacia el actual. La funcion helper de V149 es idempotente y devuelve
    -- 'skip: mismo id' si intenta mergear consigo mismo.
    FOR v_historico IN
        SELECT em.nomb_correg_canonico
        FROM dw.entidad_maestra em
        WHERE LOWER(em.nomb_correg_canonico) LIKE '%compartamos%'
          AND em.id != v_actual_id
          AND em.activa = TRUE
    LOOP
        FOR v_result IN
            SELECT * FROM dw.merge_entidad_maestra(
                _canonico_actual := v_actual_nombre,
                _canonico_historico := v_historico.nomb_correg_canonico,
                _fecha_rename := '2023-01-01'::date
            )
        LOOP
            RAISE NOTICE 'V152: merge % -> % => %',
                v_historico.nomb_correg_canonico, v_actual_nombre, v_result.status;
        END LOOP;
    END LOOP;
END $$;

-- =========================================================================
-- Post-merge: verificacion informativa (NOTICE) del resultado final.
-- =========================================================================
DO $$
DECLARE
    v_row RECORD;
BEGIN
    RAISE NOTICE 'V152: estado post-merge de canonicos con Compartamos:';
    FOR v_row IN
        SELECT em.id, em.nomb_correg_canonico, em.activa, em.fecha_baja
        FROM dw.entidad_maestra em
        WHERE LOWER(em.nomb_correg_canonico) LIKE '%compartamos%'
        ORDER BY em.activa DESC, em.id ASC
    LOOP
        RAISE NOTICE '  id=% "%" activa=% baja=%',
            v_row.id, v_row.nomb_correg_canonico, v_row.activa, v_row.fecha_baja;
    END LOOP;
END $$;
