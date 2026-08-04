-- V148 — Fusionar 'Banco de China Perú' con 'Bank of China'
--
-- Contexto: SBS armonizo el nombre al ingles internacional 'Bank of China'
-- desde 2023-04. Antes se registraba como 'Banco de China Perú'. Ambos
-- estan como filas separadas en dw.entidad_maestra.
--
-- Fix: mismo patron que V147 pero con logica automatica de detectar cual
-- es el canonico ACTUAL (el que tiene el ultimo_periodo mas reciente en
-- v_punto_equilibrio_ancho) y fusionar el otro como historico.
--
-- Idempotente.

DO $$
DECLARE
    id_a           BIGINT;
    id_b           BIGINT;
    ultimo_a       INT;
    ultimo_b       INT;
    id_actual      BIGINT;  -- el canonico que queda (mas reciente)
    id_historico   BIGINT;  -- el que se fusiona
    nombre_actual  TEXT;
    fecha_rename   DATE := '2023-03-31';
BEGIN
    SELECT id INTO id_a FROM dw.entidad_maestra WHERE nomb_correg_canonico = 'Bank of China';
    SELECT id INTO id_b FROM dw.entidad_maestra WHERE nomb_correg_canonico = 'Banco de China Perú';

    IF id_a IS NULL AND id_b IS NULL THEN
        RAISE NOTICE 'V148: ninguna de las dos entidades existe — skip';
        RETURN;
    END IF;

    IF id_a IS NULL OR id_b IS NULL THEN
        RAISE NOTICE 'V148: una entidad no existe (ya fusionada?) — skip';
        RETURN;
    END IF;

    -- Detectar cual es el canonico ACTUAL comparando el ultimo periodo
    -- que reporto data en el warehouse.
    SELECT COALESCE(MAX(v.periodo), 0) INTO ultimo_a
    FROM dw.entidad_nombre en
    JOIN marts.v_punto_equilibrio_ancho v
      ON LOWER(TRIM(v.nomb_correg)) = LOWER(TRIM(en.nombre))
     AND v.moneda = 'TOTAL'
    WHERE en.entidad_id = id_a AND en.consolidar = TRUE;

    SELECT COALESCE(MAX(v.periodo), 0) INTO ultimo_b
    FROM dw.entidad_nombre en
    JOIN marts.v_punto_equilibrio_ancho v
      ON LOWER(TRIM(v.nomb_correg)) = LOWER(TRIM(en.nombre))
     AND v.moneda = 'TOTAL'
    WHERE en.entidad_id = id_b AND en.consolidar = TRUE;

    IF ultimo_a >= ultimo_b THEN
        id_actual := id_a;
        id_historico := id_b;
        nombre_actual := 'Bank of China';
    ELSE
        id_actual := id_b;
        id_historico := id_a;
        nombre_actual := 'Banco de China Perú';
    END IF;

    RAISE NOTICE 'V148: fusionando id % (historico) -> id % (%, actual)',
                 id_historico, id_actual, nombre_actual;

    -- Reasignar nombres, evitando duplicados por UNIQUE (entidad_id, nombre, tipo).
    UPDATE dw.entidad_nombre AS en_old
    SET entidad_id = id_actual,
        tipo = CASE WHEN en_old.tipo = 'canonico' THEN 'historico' ELSE en_old.tipo END,
        vigente_hasta = CASE
            WHEN en_old.tipo = 'canonico' AND en_old.vigente_hasta IS NULL
                THEN fecha_rename
            ELSE en_old.vigente_hasta
        END,
        notas = COALESCE(en_old.notas || E'\n', '') || 'V148: reasignado en merge'
    WHERE en_old.entidad_id = id_historico
      AND NOT EXISTS (
          SELECT 1 FROM dw.entidad_nombre en_new
          WHERE en_new.entidad_id = id_actual
            AND LOWER(TRIM(en_new.nombre)) = LOWER(TRIM(en_old.nombre))
            AND en_new.tipo = CASE WHEN en_old.tipo = 'canonico' THEN 'historico' ELSE en_old.tipo END
      );

    DELETE FROM dw.entidad_nombre WHERE entidad_id = id_historico;

    UPDATE dw.entidad_maestra
    SET fecha_baja = fecha_rename,
        activa = FALSE,
        notas = COALESCE(notas || E'\n', '') ||
                'V148 (2026-08): fusionada a ' || nombre_actual || ' (id=' || id_actual || ').'
    WHERE id = id_historico;

    UPDATE dw.entidad_maestra
    SET notas = COALESCE(notas || E'\n', '') ||
                'V148: absorbio historicos del otro canonico (id=' || id_historico || ').',
        updated_at = now()
    WHERE id = id_actual;

    RAISE NOTICE 'V148: merge completado';
END $$;
