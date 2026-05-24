-- =========================================================================
-- V053: Vista marts.v_personal_por_entidad
-- Fuente del KPI cr_n_personal en el Cuadro Resumen del informe ejecutivo.
-- Lee de raw.personal_observacion y resuelve nombres canonicos via
-- dw.entidad_nombre + dw.entidad_maestra.
-- =========================================================================

-- Vista CRUDA (sin consolidar renombres)
CREATE OR REPLACE VIEW marts.v_personal_por_entidad AS
SELECT
    periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(p.empresa_sbs)) LIMIT 1),
        INITCAP(TRIM(p.empresa_sbs))
    ) AS nomb_correg,
    SUM(p.total)::int AS n_personal
FROM raw.personal_observacion p
WHERE p.empresa_sbs IS NOT NULL
  AND LOWER(TRIM(p.empresa_sbs)) NOT IN ('total general', 'total', '')
  AND p.total IS NOT NULL
GROUP BY periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(p.empresa_sbs)) LIMIT 1),
        INITCAP(TRIM(p.empresa_sbs))
    );

COMMENT ON VIEW marts.v_personal_por_entidad IS
    'Numero total de personal por entidad y periodo. Lee de raw.personal_observacion '
    'y aplica resolucion de nombres via JOIN con entidad_nombre.';


-- Vista consolidada (aplica resolver_nomb_correg_canonico para renombres temporales)
CREATE OR REPLACE VIEW marts.v_personal_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_personal)::int AS n_personal
FROM marts.v_personal_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

COMMENT ON VIEW marts.v_personal_por_entidad_canonico IS
    'Personal por entidad consolidado por renombres (ej. CrediScotia -> Compartamos).';
