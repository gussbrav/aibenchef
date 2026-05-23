-- =========================================================================
-- V046: Vista mart "marts.v_oficinas_por_entidad"
--
-- Cuenta el numero de OFICINAS distintas por (periodo, entidad) consumiendo
-- la tabla raw.creditos_depositos_oficina (V043). Es la fuente del KPI
-- "N de agencias" del Cuadro Resumen del informe ejecutivo.
--
-- Logica:
--   - Filtra "Total general" (la fila de totales del .xls)
--   - Normaliza empresa_sbs a nomb_correg via dw.normalizar_entidad()
--   - COUNT DISTINCT codigo_oficina (cada oficina tiene un codigo SBS unico)
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_oficinas_por_entidad AS
SELECT
    periodo,
    dw.normalizar_entidad(empresa_sbs) AS nomb_correg,
    COUNT(DISTINCT codigo_oficina) FILTER (WHERE codigo_oficina IS NOT NULL) AS n_oficinas
FROM raw.creditos_depositos_oficina
WHERE LOWER(TRIM(empresa_sbs)) NOT IN ('total general', 'total', '')
  AND empresa_sbs IS NOT NULL
GROUP BY periodo, dw.normalizar_entidad(empresa_sbs);

COMMENT ON VIEW marts.v_oficinas_por_entidad IS
    'N de oficinas (agencias) por entidad por periodo. Cuenta codigo_oficina '
    'distinto en raw.creditos_depositos_oficina, normalizando empresa_sbs a '
    'nomb_correg. Fuente del KPI cr_n_oficinas en /dashboard/informe.';
