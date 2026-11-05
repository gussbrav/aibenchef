-- =========================================================================
-- V210: Unifica "CMCP Lima" con "Caja Municipal de Crédito Popular Lima"
--
-- Contexto: SBS cambió la forma de reportar el nombre de esta entidad
-- alrededor de ABR 2023.
--   Hasta MAR 2023 → "CMCP Lima"              (1830 filas en fact_kpis)
--   Desde ABR 2023 → "Caja Municipal de Crédito Popular Lima" (420 filas)
--
-- La entidad en dw.entidad_maestra (id=5) tenía canonical="CMCP Lima"
-- pero el nombre nuevo nunca se registró en dw.entidad_nombre, quedando
-- como "huérfano" en la query listEntidadesConDataPE.
--
-- Solución:
--   1. Canonical → "Caja Municipal de Crédito Popular Lima" (nombre oficial SBS actual)
--   2. "CMCP Lima" queda como alias + historico
--   3. Actualizar todas las tablas base con nomb_correg='CMCP Lima'
--      para que v_punto_equilibrio_ancho devuelva historia continua 200801-202609
--
-- IDEMPOTENTE: condiciones WHERE con nombre viejo; N ejecuciones = OK.
-- =========================================================================

DO $$
DECLARE
    v_id      BIGINT := 5;
    v_viejo   TEXT   := 'CMCP Lima';
    v_nuevo   TEXT   := 'Caja Municipal de Crédito Popular Lima';
    r         RECORD;
    v_updated INT;
BEGIN
    -- ----------------------------------------------------------------
    -- 1. Canonical en entidad_maestra
    -- ----------------------------------------------------------------
    UPDATE dw.entidad_maestra
       SET nomb_correg_canonico = v_nuevo,
           updated_at = now()
     WHERE id = v_id
       AND nomb_correg_canonico = v_viejo;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'V210: entidad_maestra id=% → "%" (%  filas)', v_id, v_nuevo, v_updated;

    -- ----------------------------------------------------------------
    -- 2. entidad_nombre: marcar viejo canonico como historico y agregar nuevo
    -- ----------------------------------------------------------------
    UPDATE dw.entidad_nombre
       SET tipo = 'historico'
     WHERE entidad_id = v_id
       AND nombre     = v_viejo
       AND tipo       = 'canonico';

    INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
    VALUES
        (v_id, v_nuevo, 'canonico', TRUE, 'V210 — nombre SBS vigente desde ABR 2023'),
        (v_id, v_nuevo, 'raw_sbs',  TRUE, 'V210 — forma exacta en fact_kpis_mensuales'),
        (v_id, v_viejo, 'historico', TRUE, 'V210 — nombre SBS hasta MAR 2023')
    ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;

    -- ----------------------------------------------------------------
    -- 3. entidad_alias (legacy): mapear variantes a nuevo canonico
    -- ----------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'dw' AND table_name = 'entidad_alias'
    ) THEN
        INSERT INTO dw.entidad_alias (alias, nomb_correg, fuente)
        VALUES
            (v_viejo,         v_nuevo, 'V210 — nombre pre-ABR-2023'),
            ('CMCP LIMA',     v_nuevo, 'V210 — allcaps SBS'),
            ('CMAC Lima',     v_nuevo, 'V210 — alias comun entidad')
        ON CONFLICT (alias) DO UPDATE SET
            nomb_correg = EXCLUDED.nomb_correg,
            fuente      = EXCLUDED.fuente;

        UPDATE dw.entidad_alias
           SET nomb_correg = v_nuevo
         WHERE nomb_correg = v_viejo;
    END IF;

    -- ----------------------------------------------------------------
    -- 4. dim_entidad (legacy)
    -- ----------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'dw' AND table_name = 'dim_entidad'
    ) THEN
        IF EXISTS (SELECT 1 FROM dw.dim_entidad WHERE nomb_correg = v_nuevo) THEN
            DELETE FROM dw.dim_entidad WHERE nomb_correg = v_viejo;
        ELSE
            UPDATE dw.dim_entidad SET nomb_correg = v_nuevo WHERE nomb_correg = v_viejo;
        END IF;
    END IF;

    -- ----------------------------------------------------------------
    -- 5. Actualizar TODAS las tablas base con columna nomb_correg
    --    (incluye marts.fact_kpis_mensuales y tablas raw)
    -- ----------------------------------------------------------------
    FOR r IN
        SELECT n.nspname AS schema_name, c.relname AS table_name
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attname   = 'nomb_correg'
           AND NOT a.attisdropped
           AND c.relkind   = 'r'
           AND n.nspname  IN ('raw', 'marts', 'dw')
    LOOP
        EXECUTE format(
            'UPDATE %I.%I SET nomb_correg = %L WHERE nomb_correg = %L',
            r.schema_name, r.table_name, v_nuevo, v_viejo
        );
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated > 0 THEN
            RAISE NOTICE 'V210: %.% → % filas renombradas de "%"→"%"',
                r.schema_name, r.table_name, v_updated, v_viejo, v_nuevo;
        END IF;
    END LOOP;

    RAISE NOTICE 'V210: completado. v_punto_equilibrio_ancho mostrará historia unificada 200801-202609.';
END $$;

-- No REFRESH MV aquí (ver V175 — riesgo de lock + restart).
-- El watchdog de MVs (V137) refresca en <30 min con CONCURRENTLY.
-- v_punto_equilibrio_ancho es VIEW regular → refleja cambios inmediatamente.
