-- =========================================================================
-- V096: Cabecera Aligner — herramientas para mantener dw.cabecera_maestra
-- alineada con lo que SBS realmente publica (issue #28).
--
-- Caso real: Banco Alfin 202603 trae cuentas B1.3.4, B1.4, B1.5, B1.5.1,
-- B1.5.2 que el parser correctamente identifica y persiste en
-- raw.eeff_observacion, pero que NO están en dw.cabecera_maestra. Este
-- aligner detecta ese gap y permite agregarlas en orden lógico.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Tabla audit log — registrar cada cambio en cabecera_maestra
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin.cabecera_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    tipo_estado     TEXT NOT NULL,
    tipo_entidad    TEXT NOT NULL,
    codigo          TEXT,
    nombre          TEXT NOT NULL,
    orden           INTEGER NOT NULL,

    accion          TEXT NOT NULL
                    CHECK (accion IN ('insert', 'update', 'delete', 'reorder')),
    payload_before  JSONB,
    payload_after   JSONB,

    performed_by    TEXT NOT NULL,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    motivo          TEXT
);

CREATE INDEX IF NOT EXISTS idx_cabecera_audit_by_entity
    ON admin.cabecera_audit_log (tipo_estado, tipo_entidad, performed_at DESC);

COMMENT ON TABLE admin.cabecera_audit_log IS
    'Audit trail de cambios en dw.cabecera_maestra. Issue #28.';

-- -------------------------------------------------------------------------
-- 2) Vista v_cabecera_diff — codigos en raw vs cabecera
--
-- Para cada (tipo_estado, tipo_entidad, periodo, cuenta_codigo) que aparece
-- en raw.eeff_observacion, marca si esta en dw.cabecera_maestra.
--
-- Filter en la query:
--   status='missing_in_cabecera' → operador puede agregarlas
--   status='in_cabecera'         → ya esta alineada
-- -------------------------------------------------------------------------

DROP VIEW IF EXISTS marts.v_cabecera_diff CASCADE;
CREATE VIEW marts.v_cabecera_diff AS
WITH raw_codigos AS (
    SELECT DISTINCT
        eo.tipo_estado,
        eo.tipo_entidad,
        eo.periodo,
        eo.cuenta_codigo,
        -- Tomamos un nombre cualquiera (el de la primera obs) para mostrar al user
        MIN(eo.cuenta_nombre) AS cuenta_nombre_raw,
        -- Cuantas entidades tienen esa cuenta (mas entidades = mas legitima)
        COUNT(DISTINCT eo.nomb_correg) AS n_entidades
    FROM raw.eeff_observacion eo
    WHERE eo.moneda = 'TOTAL'
    GROUP BY eo.tipo_estado, eo.tipo_entidad, eo.periodo, eo.cuenta_codigo
),
cab_codigos AS (
    SELECT
        tipo_estado, tipo_entidad,
        codigo,
        nombre        AS cuenta_nombre_canonica,
        orden,
        nivel
    FROM dw.cabecera_maestra
    WHERE valido_hasta IS NULL
      AND codigo IS NOT NULL
)
SELECT
    rc.tipo_estado,
    rc.tipo_entidad,
    rc.periodo,
    rc.cuenta_codigo,
    rc.cuenta_nombre_raw,
    rc.n_entidades,
    cc.cuenta_nombre_canonica,
    cc.orden       AS orden_cabecera,
    cc.nivel       AS nivel_cabecera,
    CASE
        WHEN cc.codigo IS NULL THEN 'missing_in_cabecera'
        ELSE 'in_cabecera'
    END AS status
FROM raw_codigos rc
LEFT JOIN cab_codigos cc
    ON cc.tipo_estado  = rc.tipo_estado
   AND cc.tipo_entidad = rc.tipo_entidad
   AND cc.codigo       = rc.cuenta_codigo;

COMMENT ON VIEW marts.v_cabecera_diff IS
    'Diffea codigos en raw.eeff_observacion vs dw.cabecera_maestra por
     (tipo_estado, tipo_entidad, periodo). missing_in_cabecera = cuentas
     que el parser asigno pero la cabecera no contempla. Issue #28.';

-- -------------------------------------------------------------------------
-- 3) Funcion dw.align_cabecera — agrega codigos faltantes en orden logico
--
-- Para cada codigo a agregar, inserta en cabecera_maestra inmediatamente
-- DESPUES del padre (si existe) o al final de su seccion. Bumps el orden
-- de los siguientes.
--
-- Args:
--   p_tipo_estado    'balance' | 'resultados'
--   p_tipo_entidad   BANCOS | FINANCIERAS | CMAC | CRAC | EDPYMES
--   p_codigos        ARRAY de codigos a agregar (ej. ['B1.3.4', 'B1.4'])
--   p_periodo_src    YYYYMM para extraer nombre canonico desde raw
--   p_performed_by   email del operador
--   p_motivo         razon (libre)
--
-- Returns: n filas insertadas.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dw.align_cabecera(
    p_tipo_estado   TEXT,
    p_tipo_entidad  TEXT,
    p_codigos       TEXT[],
    p_periodo_src   INT,
    p_performed_by  TEXT,
    p_motivo        TEXT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
    v_codigo            TEXT;
    v_nombre_raw        TEXT;
    v_nombre_normalizado TEXT;
    v_codigo_padre      TEXT;
    v_orden_target      INT;
    v_nivel_target      INT;
    v_orden_existente   INT;
    v_n_changes         INT := 0;
BEGIN
    -- Estrategia de align:
    --   Caso A: existe codigo ya → skip (idempotente).
    --   Caso B: existe una fila con codigo=NULL y nombre similar al de raw
    --           → UPDATE codigo en esa fila (no requiere reorder).
    --   Caso C: no existe ni codigo ni nombre similar → INSERT al final del
    --           padre con bump.
    --
    -- B es lo mas comun: la cabecera_maestra inicial registro las filas
    -- como "marker sin codigo" (caso `Otros`, `Depositos Restringidos`)
    -- y solo falta darles su codigo definitivo.

    FOREACH v_codigo IN ARRAY p_codigos LOOP
        -- Caso A: codigo ya esta → skip
        IF EXISTS (
            SELECT 1 FROM dw.cabecera_maestra
            WHERE tipo_estado = p_tipo_estado
              AND tipo_entidad = p_tipo_entidad
              AND codigo = v_codigo
              AND valido_hasta IS NULL
        ) THEN
            CONTINUE;
        END IF;

        -- Extraer nombre canonico desde raw.eeff_observacion del periodo src
        SELECT cuenta_nombre INTO v_nombre_raw
        FROM raw.eeff_observacion
        WHERE tipo_estado = p_tipo_estado
          AND tipo_entidad = p_tipo_entidad
          AND cuenta_codigo = v_codigo
          AND periodo = p_periodo_src
          AND moneda = 'TOTAL'
        LIMIT 1;

        IF v_nombre_raw IS NULL THEN
            -- Buscar en cualquier periodo si no esta en el solicitado
            SELECT cuenta_nombre INTO v_nombre_raw
            FROM raw.eeff_observacion
            WHERE tipo_estado = p_tipo_estado
              AND tipo_entidad = p_tipo_entidad
              AND cuenta_codigo = v_codigo
              AND moneda = 'TOTAL'
            LIMIT 1;
        END IF;

        IF v_nombre_raw IS NULL THEN
            INSERT INTO admin.cabecera_audit_log
                (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
                 performed_by, motivo)
            VALUES (p_tipo_estado, p_tipo_entidad, v_codigo,
                    '(SKIPPED: nombre no encontrado en raw)', 0, 'insert',
                    p_performed_by, COALESCE(p_motivo, '') || ' [skipped]');
            CONTINUE;
        END IF;

        -- Normalizar para comparar nombres (lower + strip especiales)
        v_nombre_normalizado := lower(regexp_replace(v_nombre_raw, '[^a-zA-Z0-9 ]', '', 'g'));

        -- Caso B: hay fila con codigo NULL y nombre similar → UPDATE codigo
        SELECT orden INTO v_orden_existente
        FROM dw.cabecera_maestra
        WHERE tipo_estado = p_tipo_estado
          AND tipo_entidad = p_tipo_entidad
          AND codigo IS NULL
          AND valido_hasta IS NULL
          AND lower(regexp_replace(nombre, '[^a-zA-Z0-9 ]', '', 'g')) = v_nombre_normalizado
        ORDER BY orden
        LIMIT 1;

        IF v_orden_existente IS NOT NULL THEN
            v_nivel_target := 2 + (LENGTH(v_codigo) - LENGTH(REPLACE(v_codigo, '.', '')));
            UPDATE dw.cabecera_maestra
            SET codigo = v_codigo,
                nivel = v_nivel_target,
                updated_at = now()
            WHERE tipo_estado = p_tipo_estado
              AND tipo_entidad = p_tipo_entidad
              AND orden = v_orden_existente
              AND valido_hasta IS NULL;

            INSERT INTO admin.cabecera_audit_log
                (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
                 payload_after, performed_by, motivo)
            VALUES (p_tipo_estado, p_tipo_entidad, v_codigo, v_nombre_raw,
                    v_orden_existente, 'update',
                    jsonb_build_object('nivel', v_nivel_target,
                                       'periodo_src', p_periodo_src,
                                       'strategy', 'match_by_name'),
                    p_performed_by, p_motivo);

            v_n_changes := v_n_changes + 1;
            CONTINUE;
        END IF;

        -- Caso C: no existe nombre similar → INSERT despues del padre
        v_codigo_padre := regexp_replace(v_codigo, '\.[0-9]+$', '');
        IF v_codigo_padre = v_codigo THEN
            v_codigo_padre := NULL;
        END IF;

        IF v_codigo_padre IS NOT NULL THEN
            SELECT MAX(orden) INTO v_orden_target
            FROM dw.cabecera_maestra
            WHERE tipo_estado = p_tipo_estado
              AND tipo_entidad = p_tipo_entidad
              AND valido_hasta IS NULL
              AND (codigo = v_codigo_padre OR codigo LIKE v_codigo_padre || '.%');
        END IF;

        IF v_orden_target IS NULL THEN
            SELECT COALESCE(MAX(orden), 0) INTO v_orden_target
            FROM dw.cabecera_maestra
            WHERE tipo_estado = p_tipo_estado
              AND tipo_entidad = p_tipo_entidad
              AND valido_hasta IS NULL;
        END IF;

        v_nivel_target := 2 + (LENGTH(v_codigo) - LENGTH(REPLACE(v_codigo, '.', '')));

        -- Bump orden de filas posteriores. Hacer DESC para evitar collision.
        UPDATE dw.cabecera_maestra
        SET orden = orden + 1, updated_at = now()
        WHERE tipo_estado = p_tipo_estado
          AND tipo_entidad = p_tipo_entidad
          AND valido_hasta IS NULL
          AND orden > v_orden_target;

        INSERT INTO dw.cabecera_maestra
            (tipo_estado, tipo_entidad, orden, codigo, nombre, nivel,
             es_header, es_total, es_seccion, valido_desde)
        VALUES
            (p_tipo_estado, p_tipo_entidad, v_orden_target + 1, v_codigo,
             v_nombre_raw, v_nivel_target, FALSE, FALSE, FALSE, 200801);

        INSERT INTO admin.cabecera_audit_log
            (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
             payload_after, performed_by, motivo)
        VALUES (p_tipo_estado, p_tipo_entidad, v_codigo, v_nombre_raw,
                v_orden_target + 1, 'insert',
                jsonb_build_object('nivel', v_nivel_target,
                                   'codigo_padre', v_codigo_padre,
                                   'periodo_src', p_periodo_src,
                                   'strategy', 'insert_after_parent'),
                p_performed_by, p_motivo);

        v_n_changes := v_n_changes + 1;
    END LOOP;

    RETURN v_n_changes;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION dw.align_cabecera IS
    'Agrega codigos faltantes a dw.cabecera_maestra en orden logico
     (despues del padre). Reordena orden posteriores. Audita en
     admin.cabecera_audit_log. Issue #28.';
