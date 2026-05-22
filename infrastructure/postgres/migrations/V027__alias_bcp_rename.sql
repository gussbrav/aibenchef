-- =========================================================================
-- V027: alias 'Banco de Crédito' -> 'Banco de Crédito del Perú'
--
-- SBS renombro la entidad en abril 2023. Verificado:
--   'Banco de Crédito'             reporta 200801 -> 202303
--   'Banco de Crédito del Perú'    reporta 202304 -> 202603
--   Cero overlap -> misma entidad legal, solo cambio de label oficial.
--
-- NOTA: 'Banco de Crédito con Sucursales en el Exterior' es DIFERENTE
--   (consolidada con sucursales del exterior, reporta TODO el rango
--   2008-2026). NO se fusiona con esta.
-- =========================================================================

INSERT INTO dw.entidad_alias (alias, nomb_correg, fuente) VALUES
    ('Banco de Crédito', 'Banco de Crédito del Perú', 'sbs_rename_202304')
ON CONFLICT (alias) DO UPDATE SET
    nomb_correg = EXCLUDED.nomb_correg,
    fuente = EXCLUDED.fuente;

-- Aplicar el alias a la data existente: renombrar todas las filas viejas
UPDATE raw.eeff_observacion
SET nomb_correg = 'Banco de Crédito del Perú'
WHERE nomb_correg = 'Banco de Crédito';

-- Limpiar dim_entidad: si 'Banco de Crédito' ya no es referenciada, borrarla
DELETE FROM dw.dim_entidad
WHERE nomb_correg = 'Banco de Crédito'
  AND NOT EXISTS (
    SELECT 1 FROM raw.eeff_observacion WHERE nomb_correg = 'Banco de Crédito'
  );

-- Asegurar que el canonico existe en dim_entidad
INSERT INTO dw.dim_entidad (nomb_correg, tipo_entidad, microfinanciera, activa)
SELECT 'Banco de Crédito del Perú', 'BANCOS', FALSE, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM dw.dim_entidad WHERE nomb_correg = 'Banco de Crédito del Perú'
);
