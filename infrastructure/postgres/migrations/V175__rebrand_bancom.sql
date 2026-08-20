-- =========================================================================
-- V175: Rebrand comercial "Banco de Comercio" -> "Bancom" (agosto 2026)
--
-- Contexto: la institucion actualizo su identidad y opera oficialmente
-- bajo la marca corta "Bancom" para servicios financieros y canales
-- digitales. SBS aun publica algunas filas con "Banco de Comercio" o
-- "BANCOM" (allcaps), por eso el alias historico queda vigente.
--
-- Alcance:
--   1. dw.entidad_maestra          -> nomb_correg_canonico "Bancom"
--   2. dw.entidad_nombre           -> historico + nuevo canonico + alias
--   3. dw.dim_entidad (legacy)     -> nomb_correg "Bancom"
--   4. dw.entidad_alias (legacy)   -> alias "Banco de Comercio" -> "Bancom"
--   5. raw.* (dinamico)            -> todas las tablas base con nomb_correg
--   6. marts.*                     -> REFRESH MATERIALIZED VIEW al final
--
-- Idempotente: todos los UPDATE usan WHERE con el nombre viejo; si ya
-- se aplico, los rowcounts son 0 y no rompe nada.
-- =========================================================================

DO $$
DECLARE
    v_id BIGINT;
    v_fecha_rebrand DATE := '2026-08-18';
    r RECORD;
    v_updated INT;
BEGIN
    -- ----------------------------------------------------------------
    -- 1. Renombrar el canonico en dw.entidad_maestra
    -- ----------------------------------------------------------------
    SELECT id INTO v_id
      FROM dw.entidad_maestra
     WHERE nomb_correg_canonico = 'Banco de Comercio';

    IF v_id IS NULL THEN
        SELECT id INTO v_id
          FROM dw.entidad_maestra
         WHERE nomb_correg_canonico = 'Bancom';
        IF v_id IS NULL THEN
            RAISE NOTICE 'V175: ni "Banco de Comercio" ni "Bancom" existen en entidad_maestra — skip';
            RETURN;
        END IF;
        RAISE NOTICE 'V175: "Bancom" ya es el canonico (id=%) — solo actualizo tablas restantes', v_id;
    ELSE
        UPDATE dw.entidad_maestra
           SET nomb_correg_canonico = 'Bancom',
               razon_social_actual  = COALESCE(razon_social_actual, 'Banco de Comercio'),
               notas = COALESCE(notas || E'\n', '') ||
                       'V175 (' || v_fecha_rebrand || '): rebrand comercial ' ||
                       'Banco de Comercio -> Bancom. Razon social legal se ' ||
                       'mantiene como "Banco de Comercio S.A."',
               updated_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'V175: entidad_maestra id=% renombrada a Bancom', v_id;
    END IF;

    -- ----------------------------------------------------------------
    -- 2. entidad_nombre: marcar viejo como historico + agregar nuevos
    -- ----------------------------------------------------------------
    UPDATE dw.entidad_nombre
       SET tipo = 'historico',
           vigente_hasta = COALESCE(vigente_hasta, v_fecha_rebrand),
           notas = COALESCE(notas || E'\n', '') ||
                   'V175: rebrand a Bancom desde ' || v_fecha_rebrand
     WHERE entidad_id = v_id
       AND nombre     = 'Banco de Comercio'
       AND tipo       = 'canonico';

    INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, vigente_desde, consolidar, fuente)
    VALUES
        (v_id, 'Bancom',            'canonico',   v_fecha_rebrand, TRUE, 'V175 — nuevo nombre comercial'),
        (v_id, 'BANCOM',            'alias',      NULL,            TRUE, 'V175 — allcaps SBS'),
        (v_id, 'Banco de Comercio', 'historico',  NULL,            TRUE, 'V175 — nombre pre-rebrand')
    ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;

    -- ----------------------------------------------------------------
    -- 3. Legacy dw.dim_entidad
    -- ----------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'dw' AND table_name = 'dim_entidad'
    ) THEN
        IF EXISTS (SELECT 1 FROM dw.dim_entidad WHERE nomb_correg = 'Bancom') THEN
            DELETE FROM dw.dim_entidad WHERE nomb_correg = 'Banco de Comercio';
        ELSE
            UPDATE dw.dim_entidad
               SET nomb_correg = 'Bancom'
             WHERE nomb_correg = 'Banco de Comercio';
        END IF;
    END IF;

    -- ----------------------------------------------------------------
    -- 4. Legacy dw.entidad_alias
    -- ----------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'dw' AND table_name = 'entidad_alias'
    ) THEN
        INSERT INTO dw.entidad_alias (alias, nomb_correg, fuente)
        VALUES ('Banco de Comercio', 'Bancom', 'V175 — pre-rebrand name')
        ON CONFLICT (alias) DO UPDATE SET
            nomb_correg = EXCLUDED.nomb_correg,
            fuente      = EXCLUDED.fuente;

        UPDATE dw.entidad_alias
           SET nomb_correg = 'Bancom'
         WHERE nomb_correg = 'Banco de Comercio';
    END IF;

    -- ----------------------------------------------------------------
    -- 5. Update dinamico: TODAS las tablas base (raw + marts no-MV) con
    --    columna nomb_correg. Filtro relkind = 'r' para excluir MVs
    --    (que se REFRESHan en la siguiente etapa).
    -- ----------------------------------------------------------------
    FOR r IN
        SELECT n.nspname AS schema_name, c.relname AS table_name
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attname = 'nomb_correg'
           AND NOT a.attisdropped
           AND c.relkind = 'r'                  -- solo tablas base
           AND n.nspname IN ('raw', 'marts', 'dw')
    LOOP
        EXECUTE format(
            'UPDATE %I.%I SET nomb_correg = %L WHERE nomb_correg = %L',
            r.schema_name, r.table_name, 'Bancom', 'Banco de Comercio'
        );
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated > 0 THEN
            RAISE NOTICE 'V175: %.% -> % filas renombradas', r.schema_name, r.table_name, v_updated;
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 6. REFRESH MATERIALIZED VIEW — REMOVIDO 2026-08-19
--
-- El bloque original hacia REFRESH MATERIALIZED VIEW (sin CONCURRENTLY)
-- sobre TODAS las MVs de marts. Con MVs stale de dias/semanas cada
-- REFRESH tomaba varios minutos, y como REFRESH sin CONCURRENTLY toma
-- ACCESS EXCLUSIVE LOCK bloqueando todo read/write en la MV, el health
-- check del container fallaba, EasyPanel restartaba el container, se
-- generaba OTRA sesion migrator queriendo aplicar V175, lock wait
-- cascade, deadlock operativo (visto 2026-08-19: 7 V175 concurrentes
-- + 16 sesiones bloqueadas).
--
-- Fix: no hacer REFRESH aca. El watchdog de MVs (V137, corre cada 30
-- min) refresca las MVs stale sin bloquear reads porque usa
-- REFRESH CONCURRENTLY (require UNIQUE INDEX que las MVs ya tienen).
-- O admin puede disparar refresh manual desde /admin/data-quality.
--
-- Consecuencia: al aplicar V175, las MVs quedan con la data VIEJA
-- (todavia dicen "Banco de Comercio" en nomb_correg materializado).
-- El watchdog las trae al dia en <30 min. Aceptable — no bloquea startup.
-- ----------------------------------------------------------------
