-- =========================================================================
-- V114: agregar cuenta_codigo a raw.eeff_celda_cruda (fix bug issue #65)
--
-- BUG ORIGINAL:
--   V113 hizo JOIN por (orden) entre cabecera_maestra y celda_cruda,
--   asumiendo que ambas eran posicionales en el .xls. Pero V112 renumero
--   cabecera_maestra usando codigo_sort_key (TOTAL ACTIVO al top), mientras
--   que celda_cruda mantiene posicion del archivo (DISPONIBLE al top).
--   Resultado: shift de 1 fila en el Inspector (Excel SBS de fila N mostraba
--   valores de fila N+1).
--
-- FIX:
--   Agregar cuenta_codigo a celda_cruda (NULL si parser no resolvio). El
--   inspector hace JOIN por codigo, que es la clave estable de negocio.
--   Filas con codigo NULL son las que el parser dropeo — quedan en la
--   tabla pero no aparecen en el JOIN principal del inspector (se pueden
--   listar aparte como "filas archivo sin codigo asignado").
--
-- BACKFILL POST-V114:
--   Re-correr scripts/backfill_celda_cruda.py para llenar cuenta_codigo
--   en las filas ya insertadas (UPSERT update via importer).
-- =========================================================================

ALTER TABLE raw.eeff_celda_cruda
    ADD COLUMN IF NOT EXISTS cuenta_codigo TEXT;

COMMENT ON COLUMN raw.eeff_celda_cruda.cuenta_codigo IS
'Codigo contable resuelto por el parser (A1, A1.1, etc). NULL si el parser no logro asignar — esos casos son lo que valida el inspector cuando comparamos contra cabecera_maestra.';

-- Index para el LEFT JOIN del inspector
CREATE INDEX IF NOT EXISTS idx_eeff_celda_cruda_codigo_lookup
    ON raw.eeff_celda_cruda (periodo, nomb_correg, tipo_estado, cuenta_codigo)
    WHERE cuenta_codigo IS NOT NULL;
