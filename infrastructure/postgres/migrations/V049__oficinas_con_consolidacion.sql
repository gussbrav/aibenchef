-- =========================================================================
-- V049: Vistas de oficinas con/sin consolidacion de renombres
--
-- Provee 2 vistas paralelas:
--   - marts.v_oficinas_por_entidad           (sin consolidar — raw)
--   - marts.v_oficinas_por_entidad_canonico  (con consolidar — aplica renombres)
--
-- Asi el dashboard puede elegir cual usar segun el toggle del user.
-- =========================================================================

-- Vista CRUDA (sin consolidar renombres) — reemplaza la V047
-- Mantiene los nombres tal cual vienen de raw (despues de las 4 estrategias
-- de matching contra dw.dim_entidad).
CREATE OR REPLACE VIEW marts.v_oficinas_por_entidad AS
WITH normalizado AS (
    SELECT
        o.periodo,
        o.codigo_oficina,
        dw.normalizar_entidad(o.empresa_sbs) AS via_normalizar,
        o.empresa_sbs AS raw_empresa_sbs
    FROM raw.creditos_depositos_oficina o
    WHERE LOWER(TRIM(o.empresa_sbs)) NOT IN ('total general', 'total', '')
      AND o.empresa_sbs IS NOT NULL
),
con_nomb_correg AS (
    SELECT
        n.periodo,
        n.codigo_oficina,
        COALESCE(
            (SELECT e.nomb_correg FROM dw.dim_entidad e WHERE e.nomb_correg = n.via_normalizar LIMIT 1),
            (SELECT e.nomb_correg FROM dw.dim_entidad e WHERE UPPER(TRIM(e.empresa_sbs)) = UPPER(TRIM(n.raw_empresa_sbs)) LIMIT 1),
            (SELECT e.nomb_correg FROM dw.dim_entidad e WHERE UPPER(TRIM(e.nomb_correg)) = UPPER(TRIM(n.raw_empresa_sbs)) LIMIT 1),
            INITCAP(TRIM(n.raw_empresa_sbs))
        ) AS nomb_correg
    FROM normalizado n
)
SELECT
    periodo,
    nomb_correg,
    COUNT(DISTINCT codigo_oficina) FILTER (WHERE codigo_oficina IS NOT NULL) AS n_oficinas
FROM con_nomb_correg
WHERE nomb_correg IS NOT NULL AND nomb_correg <> ''
GROUP BY periodo, nomb_correg;

COMMENT ON VIEW marts.v_oficinas_por_entidad IS
    'N de oficinas (agencias) por entidad por periodo SIN consolidar renombres. '
    'Las entidades historicas (ej. "Financiera Compartamos") aparecen separadas '
    'de las actuales ("Compartamos Banco"). Para consolidar usar la vista '
    'marts.v_oficinas_por_entidad_canonico.';


-- Vista CONSOLIDADA — aplica resolver_nomb_correg_canonico antes del GROUP BY
-- "Financiera Compartamos" (2010-2023) + "Compartamos Banco" (2023+) aparecen
-- como una serie continua bajo "Compartamos Banco".
CREATE OR REPLACE VIEW marts.v_oficinas_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_oficinas)::int AS n_oficinas
FROM marts.v_oficinas_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

COMMENT ON VIEW marts.v_oficinas_por_entidad_canonico IS
    'N de oficinas por entidad por periodo CONSOLIDANDO renombres. '
    'Aplica dw.resolver_nomb_correg_canonico() para que series historicas '
    'aparezcan como continuas bajo el nombre actual. Es la vista por default '
    'del informe ejecutivo (param consolidar=true).';
