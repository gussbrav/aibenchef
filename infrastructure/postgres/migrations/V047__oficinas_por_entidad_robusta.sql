-- =========================================================================
-- V047: Vista marts.v_oficinas_por_entidad mas robusta
--
-- La version anterior (V046) usaba SOLO dw.normalizar_entidad(empresa_sbs).
-- Si esa funcion no tiene un alias para "MIBANCO" o "BANCO DE CREDITO"
-- mayusculas, devolvia el string crudo y NO matcheaba con los nomb_correg
-- canonicos del peer group ("Mibanco", "Banco de Credito").
--
-- Esta version intenta varios candidatos en orden:
--   1. dw.normalizar_entidad(empresa_sbs) — el path normal
--   2. Match contra dw.dim_entidad.empresa_sbs (la tabla raw del xlsx
--      usa el nombre legal completo en mayusculas que esta en empresa_sbs)
--   3. Match case-insensitive contra dw.dim_entidad.nomb_correg
--   4. INITCAP del raw (capitaliza primera letra de cada palabra)
-- =========================================================================

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
    'N de oficinas (agencias) por entidad por periodo. Resuelve nomb_correg '
    'con 4 estrategias en cascada: normalizar_entidad / empresa_sbs match / '
    'nomb_correg match / INITCAP fallback.';
