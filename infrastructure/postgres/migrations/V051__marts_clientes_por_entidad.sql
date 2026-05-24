-- =========================================================================
-- V051: Vista marts.v_clientes_por_entidad
-- Fuente del KPI cr_n_clientes en el Cuadro Resumen del informe ejecutivo.
-- =========================================================================

-- Vista CRUDA (sin consolidar renombres)
CREATE OR REPLACE VIEW marts.v_clientes_por_entidad AS
SELECT
    periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(c.empresa)) LIMIT 1),
        INITCAP(TRIM(c.empresa))
    ) AS nomb_correg,
    SUM(c.n_clientes)::int AS n_clientes
FROM raw.clientes_creditos c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.producto = 'TOTAL'
GROUP BY periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(c.empresa)) LIMIT 1),
        INITCAP(TRIM(c.empresa))
    );

COMMENT ON VIEW marts.v_clientes_por_entidad IS
    'N de clientes de credito por entidad por periodo. Lee de raw.clientes_creditos '
    '(producto=TOTAL) y aplica dw.lookup_entidad_canonica via JOIN con entidad_nombre.';


-- Vista consolidada (aplica resolver_nomb_correg_canonico)
CREATE OR REPLACE VIEW marts.v_clientes_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_clientes)::int AS n_clientes
FROM marts.v_clientes_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);
