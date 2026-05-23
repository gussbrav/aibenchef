-- =========================================================================
-- V036: Mart materializado para COLOCACIONES
--
-- Vista resumen lista para dashboards: saldos por entidad/periodo/producto.
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_colocaciones_resumen CASCADE;

CREATE MATERIALIZED VIEW marts.mv_colocaciones_resumen AS
SELECT
    o.periodo,
    o.fecha_cierre,
    o.tipo_entidad,
    o.empresa,
    o.empresa_benchmark,
    o.producto,
    o.prod_consumo,
    COALESCE(o.saldo_vigente, 0)      AS saldo_vigente,
    COALESCE(o.saldo_reest_refin, 0)  AS saldo_reest_refin,
    COALESCE(o.saldo_atrasado, 0)     AS saldo_atrasado,
    COALESCE(o.saldo_total, 0)        AS saldo_total,
    -- Ratio de morosidad: atrasados / total
    CASE
        WHEN o.saldo_total > 0
        THEN o.saldo_atrasado / o.saldo_total
        ELSE NULL
    END AS ratio_morosidad,
    -- Ratio de cartera deteriorada: (atrasados + reest+refin) / total
    CASE
        WHEN o.saldo_total > 0
        THEN (COALESCE(o.saldo_atrasado, 0) + COALESCE(o.saldo_reest_refin, 0)) / o.saldo_total
        ELSE NULL
    END AS ratio_cartera_deteriorada,
    -- Orden canonico SBS
    CASE o.tipo_entidad
        WHEN 'BANCOS' THEN 1
        WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3
        WHEN 'CRAC' THEN 4
        WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.colocaciones_observacion o
WHERE o.saldo_total IS NOT NULL;

CREATE UNIQUE INDEX idx_mv_coloc_unique
    ON marts.mv_colocaciones_resumen (periodo, empresa, producto, prod_consumo);

CREATE INDEX idx_mv_coloc_periodo
    ON marts.mv_colocaciones_resumen (periodo);

CREATE INDEX idx_mv_coloc_empresa
    ON marts.mv_colocaciones_resumen (empresa);

CREATE INDEX idx_mv_coloc_tipo
    ON marts.mv_colocaciones_resumen (tipo_entidad);

CREATE INDEX idx_mv_coloc_producto
    ON marts.mv_colocaciones_resumen (producto);

COMMENT ON MATERIALIZED VIEW marts.mv_colocaciones_resumen IS
    'Resumen de cartera de creditos por entidad/periodo/producto. '
    'Incluye saldos y ratios de morosidad / cartera deteriorada. '
    'Refrescar con REFRESH MATERIALIZED VIEW CONCURRENTLY marts.mv_colocaciones_resumen.';

-- Vista agregada por tipo de entidad (un row por periodo+tipo+producto)
DROP MATERIALIZED VIEW IF EXISTS marts.mv_colocaciones_por_tipo CASCADE;

CREATE MATERIALIZED VIEW marts.mv_colocaciones_por_tipo AS
SELECT
    periodo,
    fecha_cierre,
    tipo_entidad,
    orden_tipo,
    producto,
    COUNT(DISTINCT empresa)           AS n_entidades,
    SUM(saldo_vigente)                AS saldo_vigente,
    SUM(saldo_reest_refin)            AS saldo_reest_refin,
    SUM(saldo_atrasado)               AS saldo_atrasado,
    SUM(saldo_total)                  AS saldo_total,
    CASE
        WHEN SUM(saldo_total) > 0
        THEN SUM(saldo_atrasado) / SUM(saldo_total)
        ELSE NULL
    END AS ratio_morosidad,
    CASE
        WHEN SUM(saldo_total) > 0
        THEN (SUM(saldo_atrasado) + SUM(saldo_reest_refin)) / SUM(saldo_total)
        ELSE NULL
    END AS ratio_cartera_deteriorada
FROM marts.mv_colocaciones_resumen
GROUP BY periodo, fecha_cierre, tipo_entidad, orden_tipo, producto;

CREATE UNIQUE INDEX idx_mv_coloc_tipo_unique
    ON marts.mv_colocaciones_por_tipo (periodo, tipo_entidad, producto);

CREATE INDEX idx_mv_coloc_tipo_periodo
    ON marts.mv_colocaciones_por_tipo (periodo);

COMMENT ON MATERIALIZED VIEW marts.mv_colocaciones_por_tipo IS
    'Agregado: saldos y ratios por (periodo, tipo_entidad, producto). '
    'Para dashboards comparativos entre Bancos / Financieras / CMAC / CRAC / EDPYMES.';
