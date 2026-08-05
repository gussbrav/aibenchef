-- V149 — Helper function reutilizable para fusionar entidades canonicas
-- que en realidad son la misma entidad real (rename historico).
--
-- Contexto: V147 (Continental->BBVA) y V148 (Banco de China->Bank of China)
-- resolvieron 2 casos con codigo duplicado. Esta migration extrae la logica
-- a una funcion reutilizable + view materializada de candidatos para que
-- el panel admin los detecte y fusione con 1 click.
--
-- USO:
--   SELECT * FROM dw.merge_entidad_maestra(
--     _canonico_actual := 'Banco BBVA Perú',
--     _canonico_historico := 'Banco Continental',
--     _fecha_rename := '2023-03-31'::date
--   );
--
--   O detectar candidatos:
--   SELECT * FROM dw.v_entidad_rename_candidates;

-- =========================================================================
-- FUNCION: dw.merge_entidad_maestra
-- Fusiona 2 canonicos en 1. Mueve todos los aliases del historico al
-- actual, marca al historico con fecha_baja + activa=FALSE. Idempotente.
--
-- DROP + CREATE (no CREATE OR REPLACE) porque si la signature cambio,
-- CREATE OR REPLACE FUNCTION falla con 'cannot change return type'.
-- Tag $fn$ (no $$) por si el parser de postgres.js tiene bug con $$.
-- =========================================================================
DROP FUNCTION IF EXISTS dw.merge_entidad_maestra(TEXT, TEXT, DATE) CASCADE;

CREATE FUNCTION dw.merge_entidad_maestra(
    _canonico_actual TEXT,
    _canonico_historico TEXT,
    _fecha_rename DATE
) RETURNS TABLE (
    id_actual BIGINT,
    id_historico BIGINT,
    nombres_reasignados INT,
    nombres_borrados INT,
    status TEXT
) AS $fn$
DECLARE
    v_id_actual     BIGINT;
    v_id_historico  BIGINT;
    v_reasignados   INT := 0;
    v_borrados      INT := 0;
BEGIN
    SELECT em.id INTO v_id_actual
    FROM dw.entidad_maestra em
    WHERE em.nomb_correg_canonico = _canonico_actual;

    SELECT em.id INTO v_id_historico
    FROM dw.entidad_maestra em
    WHERE em.nomb_correg_canonico = _canonico_historico
      AND em.activa = TRUE;

    IF v_id_actual IS NULL THEN
        RETURN QUERY SELECT NULL::BIGINT, NULL::BIGINT, 0, 0,
                            'skip: canonico actual no existe: ' || _canonico_actual;
        RETURN;
    END IF;

    IF v_id_historico IS NULL THEN
        RETURN QUERY SELECT v_id_actual, NULL::BIGINT, 0, 0,
                            'skip: canonico historico no existe o ya fusionado: ' || _canonico_historico;
        RETURN;
    END IF;

    IF v_id_actual = v_id_historico THEN
        RETURN QUERY SELECT v_id_actual, v_id_historico, 0, 0,
                            'skip: mismo id (no puede fusionarse consigo)';
        RETURN;
    END IF;

    -- 1. Reasignar nombres al canonico actual, evitando conflictos UNIQUE
    WITH updated AS (
        UPDATE dw.entidad_nombre AS en_old
        SET entidad_id = v_id_actual,
            tipo = CASE WHEN en_old.tipo = 'canonico' THEN 'historico' ELSE en_old.tipo END,
            vigente_hasta = CASE
                WHEN en_old.tipo = 'canonico' AND en_old.vigente_hasta IS NULL
                    THEN _fecha_rename
                ELSE en_old.vigente_hasta
            END,
            notas = COALESCE(en_old.notas || E'\n', '') ||
                    'merge auto: reasignado desde entidad_id=' || v_id_historico
        WHERE en_old.entidad_id = v_id_historico
          AND NOT EXISTS (
              SELECT 1 FROM dw.entidad_nombre en_new
              WHERE en_new.entidad_id = v_id_actual
                AND LOWER(TRIM(en_new.nombre)) = LOWER(TRIM(en_old.nombre))
                AND en_new.tipo = CASE WHEN en_old.tipo = 'canonico' THEN 'historico' ELSE en_old.tipo END
          )
        RETURNING 1
    )
    SELECT count(*) INTO v_reasignados FROM updated;

    -- 2. Borrar nombres restantes (duplicados que causaban conflict UNIQUE)
    WITH deleted AS (
        DELETE FROM dw.entidad_nombre WHERE entidad_id = v_id_historico RETURNING 1
    )
    SELECT count(*) INTO v_borrados FROM deleted;

    -- 3. Marcar la entidad historica como con fecha de baja
    UPDATE dw.entidad_maestra
    SET fecha_baja = _fecha_rename,
        activa = FALSE,
        notas = COALESCE(notas || E'\n', '') ||
                'merge auto (' || now()::date || '): fusionada a ' || _canonico_actual ||
                ' (id=' || v_id_actual || ').',
        updated_at = now()
    WHERE id = v_id_historico;

    -- 4. Nota de auditoria en el canonico actual
    UPDATE dw.entidad_maestra
    SET notas = COALESCE(notas || E'\n', '') ||
                'merge auto (' || now()::date || '): absorbio historicos de ' ||
                _canonico_historico || ' (id=' || v_id_historico || ').',
        updated_at = now()
    WHERE id = v_id_actual;

    RETURN QUERY SELECT v_id_actual, v_id_historico, v_reasignados, v_borrados,
                        'ok: ' || v_reasignados || ' nombres reasignados, ' ||
                        v_borrados || ' duplicados borrados';
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION dw.merge_entidad_maestra(TEXT, TEXT, DATE) IS
    'Fusiona 2 canonicos de dw.entidad_maestra en 1. Mueve aliases + marca historico como inactivo con fecha_baja. Idempotente y auditado.';

-- =========================================================================
-- VIEW: dw.v_entidad_rename_candidates
-- Detecta pares de canonicos que probablemente son renames del mismo
-- entity real (mismo tipo regulatorio + rangos no solapados + tokens
-- compartidos no genericos). Alimenta el panel admin.
--
-- DROP + CREATE para permitir que V150 la re-cree con columnas distintas.
-- =========================================================================
DROP VIEW IF EXISTS dw.v_entidad_rename_candidates CASCADE;

CREATE VIEW dw.v_entidad_rename_candidates AS
WITH rangos AS (
    SELECT em.id,
           em.nomb_correg_canonico,
           em.tipo_entidad_actual,
           em.activa,
           MIN(v.periodo) AS primer_periodo,
           MAX(v.periodo) AS ultimo_periodo
    FROM dw.entidad_maestra em
    JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
    JOIN marts.v_punto_equilibrio_ancho v
      ON LOWER(TRIM(v.nomb_correg)) = LOWER(TRIM(en.nombre))
     AND v.moneda = 'TOTAL'
    GROUP BY em.id, em.nomb_correg_canonico, em.tipo_entidad_actual, em.activa
),
pares AS (
    SELECT
      a.id AS id_a, a.nomb_correg_canonico AS nombre_a,
      a.tipo_entidad_actual AS tipo, a.activa AS activa_a,
      a.primer_periodo AS primer_a, a.ultimo_periodo AS ultimo_a,
      b.id AS id_b, b.nomb_correg_canonico AS nombre_b,
      b.activa AS activa_b,
      b.primer_periodo AS primer_b, b.ultimo_periodo AS ultimo_b,
      -- Cual es el mas reciente (candidato a 'actual')
      CASE
          WHEN a.ultimo_periodo >= b.ultimo_periodo THEN a.nomb_correg_canonico
          ELSE b.nomb_correg_canonico
      END AS canonico_sugerido_actual,
      CASE
          WHEN a.ultimo_periodo >= b.ultimo_periodo THEN b.nomb_correg_canonico
          ELSE a.nomb_correg_canonico
      END AS canonico_sugerido_historico,
      -- Gap en meses entre las historias (idealmente ~1 mes para un rename)
      ABS(GREATEST(a.primer_periodo, b.primer_periodo) - LEAST(a.ultimo_periodo, b.ultimo_periodo)) AS gap_periodos
    FROM rangos a
    JOIN rangos b ON b.id > a.id
    WHERE
      a.tipo_entidad_actual = b.tipo_entidad_actual
      AND (a.ultimo_periodo < b.primer_periodo OR b.ultimo_periodo < a.primer_periodo)
      AND EXISTS (
          SELECT 1
          FROM regexp_split_to_table(LOWER(a.nomb_correg_canonico), '\s+') AS tok_a(t)
          JOIN regexp_split_to_table(LOWER(b.nomb_correg_canonico), '\s+') AS tok_b(t)
            ON tok_a.t = tok_b.t
          WHERE LENGTH(tok_a.t) >= 4
            AND tok_a.t NOT IN ('banco','peru','financiera','caja','municipal','rural','edpyme','del','con','sucursales','exterior','crédito','credito','ahorro','crediticio')
      )
)
SELECT
    id_a, nombre_a, primer_a, ultimo_a, activa_a,
    id_b, nombre_b, primer_b, ultimo_b, activa_b,
    tipo,
    canonico_sugerido_actual,
    canonico_sugerido_historico,
    gap_periodos,
    -- Score de confianza: menor gap = mas probable que sea rename
    CASE
        WHEN gap_periodos <= 3 THEN 'alta'
        WHEN gap_periodos <= 12 THEN 'media'
        ELSE 'baja'
    END AS confianza
FROM pares
ORDER BY
    CASE WHEN gap_periodos <= 3 THEN 0 WHEN gap_periodos <= 12 THEN 1 ELSE 2 END,
    tipo, nombre_a;

COMMENT ON VIEW dw.v_entidad_rename_candidates IS
    'Pares de canonicos que probablemente son renames de la misma entidad real. Confianza alta = gap <=3 meses. Requiere validacion humana antes de fusionar.';
