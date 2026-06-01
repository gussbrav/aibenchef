-- =========================================================================
-- V127: Dedupe BCP/Interbank/Scotiabank en colocaciones y depositos.
--
-- BUG REPORTADO (post V118):
--   raw.colocaciones_observacion y raw.depositos_observacion contienen
--   2 filas por banco grande:
--     * "Banco de Crédito del Perú"                            (domestic)
--     * "Banco de Crédito del Perú (con sucursales en el exterior)" (consolidado)
--   Pre-V118: cada variante tenia un canonical name distinto, asi que
--   v_colocaciones_total_por_entidad NO las sumaba. Cada una iba a su
--   bucket separado.
--   Post-V118: ambas variantes resuelven al MISMO canonical (entidad 47),
--   asi que SUM las suma -> 2x cartera para BCP -> denominador SF inflado
--   en ~2.3x -> %Part SF de BCP cae a 8.99% (real esperado ~25%).
--
-- FIX:
--   Re-crear v_colocaciones_total_por_entidad y v_depositos_total_por_entidad
--   con dedupe: cuando hay dos variantes (domestic + consolidado) para el
--   mismo canonical, preferimos LA CONSOLIDADA (incluye filiales). Es la
--   medida de market share correcta porque representa el banco completo.
--
--   Approach: GROUP BY (periodo, nomb_correg_canonico, empresa_raw), luego
--   DISTINCT ON (periodo, nomb_correg_canonico) ORDER BY es_consolidado DESC.
--
-- IMPACTO downstream:
--   - v_participacion_sf_*       -> denominador correcto -> %Part realista
--   - v_participacion_smf_*      -> idem
--   - dw.entidad_microfinanciera_periodo (V057) usa raw directo con su
--     propio aggregator, NO se ve afectado por este fix.
--   - v_kpis_anuales / v_cobertura_car / v_mora_global usan EEFF (cta_*),
--     no raw.colocaciones — tampoco se ven afectados.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_colocaciones_total_por_entidad AS
WITH agg AS (
    SELECT
        c.periodo,
        dw.resolver_nomb_correg_canonico(c.empresa) AS nomb_correg,
        c.empresa                                    AS empresa_raw,
        SUM(c.saldo_total)                           AS cartera_total,
        -- Preferimos la version consolidada (incluye filiales exterior)
        -- cuando existen ambas. Patron heuristico: cualquier nombre que
        -- contenga "(con sucursales" es la consolidada.
        CASE
            WHEN c.empresa ILIKE '%(con sucursales%' THEN 1
            ELSE 0
        END AS es_consolidado
    FROM raw.colocaciones_observacion c
    WHERE c.empresa IS NOT NULL
      AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
      AND c.saldo_total IS NOT NULL
    GROUP BY c.periodo, dw.resolver_nomb_correg_canonico(c.empresa), c.empresa
    HAVING SUM(c.saldo_total) > 0
)
SELECT DISTINCT ON (periodo, nomb_correg)
    periodo,
    nomb_correg,
    cartera_total
FROM agg
ORDER BY periodo, nomb_correg, es_consolidado DESC, cartera_total DESC;

COMMENT ON VIEW marts.v_colocaciones_total_por_entidad IS
    'Cartera total por entidad canonica. DEDUPE: cuando SBS publica 2 '
    'variantes (domestic + consolidado), preferimos la consolidada. Sin '
    'esto, BCP/Interbank/Scotiabank quedaban contados 2 veces tras V118.';


CREATE OR REPLACE VIEW marts.v_depositos_total_por_entidad AS
WITH agg AS (
    SELECT
        d.periodo,
        dw.resolver_nomb_correg_canonico(d.empresa) AS nomb_correg,
        d.empresa                                    AS empresa_raw,
        SUM(d.saldo_total)                           AS depositos_total,
        CASE
            WHEN d.empresa ILIKE '%(con sucursales%' THEN 1
            ELSE 0
        END AS es_consolidado
    FROM raw.depositos_observacion d
    WHERE d.empresa IS NOT NULL
      AND LOWER(TRIM(d.empresa)) NOT IN ('total general', 'total', '')
      AND d.saldo_total IS NOT NULL
    GROUP BY d.periodo, dw.resolver_nomb_correg_canonico(d.empresa), d.empresa
    HAVING SUM(d.saldo_total) > 0
)
SELECT DISTINCT ON (periodo, nomb_correg)
    periodo,
    nomb_correg,
    depositos_total
FROM agg
ORDER BY periodo, nomb_correg, es_consolidado DESC, depositos_total DESC;

COMMENT ON VIEW marts.v_depositos_total_por_entidad IS
    'Depositos totales por entidad canonica. Dedupe igual que '
    'v_colocaciones_total_por_entidad — preferimos consolidado vs domestic.';
