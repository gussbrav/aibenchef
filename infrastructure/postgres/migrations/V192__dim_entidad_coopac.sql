-- =========================================================================
-- V192: dim_entidad + entidad_maestra — extender CHECK + seed cooperativas
--
-- Extiende los CHECK de tipo_entidad en las tablas de catalogo para aceptar
-- los 4 niveles COOPAC. Luego popula dim_entidad con las cooperativas
-- individuales encontradas en raw.eeff_observacion (datos ya importados).
--
-- dw.entidad_maestra se extiende en CHECK pero NO se popula aqui:
-- las cooperativas aparecen como "huerfanos" en el PE (ruta fallback),
-- lo cual es suficiente para Fase 4. La maestra se puede poblar manualmente.
--
-- ROLLBACK:
--   DELETE FROM dw.dim_entidad WHERE tipo_entidad LIKE 'COOPAC_%';
--   ALTER TABLE dw.dim_entidad DROP CONSTRAINT dim_entidad_tipo_entidad_ck;
--   ALTER TABLE dw.dim_entidad
--     ADD CONSTRAINT dim_entidad_tipo_entidad_check
--     CHECK (tipo_entidad IN ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES'));
--   ALTER TABLE dw.entidad_maestra
--     DROP CONSTRAINT entidad_maestra_tipo_entidad_actual_ck;
--   ALTER TABLE dw.entidad_maestra
--     ADD CONSTRAINT entidad_maestra_tipo_entidad_actual_check
--     CHECK (tipo_entidad_actual IN
--       ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES','BANCO_NACION','OTRO'));
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. dim_entidad: ampliar CHECK tipo_entidad
-- ---------------------------------------------------------------------------
ALTER TABLE dw.dim_entidad
    DROP CONSTRAINT IF EXISTS dim_entidad_tipo_entidad_check,
    DROP CONSTRAINT IF EXISTS dim_entidad_tipo_entidad_ck;

ALTER TABLE dw.dim_entidad
    ADD CONSTRAINT dim_entidad_tipo_entidad_ck CHECK (
        tipo_entidad IN (
            'BANCOS', 'FINANCIERAS', 'CMAC', 'CRAC', 'EDPYMES',
            'COOPAC_N3', 'COOPAC_N2B', 'COOPAC_N2A', 'COOPAC_N1'
        )
    );

-- ---------------------------------------------------------------------------
-- 2. entidad_maestra: ampliar CHECK tipo_entidad_actual
-- ---------------------------------------------------------------------------
ALTER TABLE dw.entidad_maestra
    DROP CONSTRAINT IF EXISTS entidad_maestra_tipo_entidad_actual_check,
    DROP CONSTRAINT IF EXISTS entidad_maestra_tipo_entidad_actual_ck;

ALTER TABLE dw.entidad_maestra
    ADD CONSTRAINT entidad_maestra_tipo_entidad_actual_ck CHECK (
        tipo_entidad_actual IN (
            'BANCOS', 'FINANCIERAS', 'CMAC', 'CRAC', 'EDPYMES',
            'BANCO_NACION', 'OTRO',
            'COOPAC_N3', 'COOPAC_N2B', 'COOPAC_N2A', 'COOPAC_N1'
        )
    );

-- ---------------------------------------------------------------------------
-- 3. Poblar dim_entidad con cooperativas desde raw.eeff_observacion
--    Se excluyen filas de totales (TOTAL*, Total*).
--    microfinanciera=TRUE, nacional='LOCAL' para todas las cooperativas.
-- ---------------------------------------------------------------------------
INSERT INTO dw.dim_entidad (nomb_correg, tipo_entidad, microfinanciera, nacional)
SELECT DISTINCT
    nomb_correg,
    tipo_entidad,
    TRUE             AS microfinanciera,
    'LOCAL'          AS nacional
FROM raw.eeff_observacion
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND nomb_correg NOT ILIKE 'total%'
  AND nomb_correg NOT ILIKE '%sistema%'
  AND TRIM(nomb_correg) <> ''
ON CONFLICT (nomb_correg) DO NOTHING;
