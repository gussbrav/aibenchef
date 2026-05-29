-- =========================================================================
-- V108: poblar cuenta_alias con TODOS los nombres-variantes publicados por
-- SBS para cada codigo (issue #42)
--
-- CONTEXTO
--
-- V107 alineo cabecera_maestra.nombre al nombre mas-frecuente publicado por
-- SBS. Pero para algunos codigos SBS publica MULTIPLES nombres en distintas
-- epocas/grupos:
--
--   B1.1 BANCOS: "Depósitos A La Vista" (6552x) Y "Depósitos a la Vista" (3192x)
--   B4.1 BANCOS: "Instituciones del País" Y "Instituciones Financieras del País"
--   C8 BANCOS:   "Resultado Neto del Ejercicio" Y "Resultados Netos del Ejercicio"
--   ... etc
--
-- Cabecera puede tener solo UN nombre canonico. Las variantes van como
-- aliases en cuenta_alias. El parser ya las consume (matching por nombre
-- normalizado). El Inspector debe consumirlas tambien para suprimir el
-- warning "⚠️ nombre" cuando el archivo usa una variante conocida.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Poblar cuenta_alias con cada (tipo_estado, codigo, nombre_distinto)
-- normalizado, SOLO si difiere del nombre_cabecera vigente.
--
-- Normalize fix: usar lower() ANTES del regex para que mayusculas survivan
-- (el v_dq normalize anterior tenia bug que borraba caps).
-- -------------------------------------------------------------------------
INSERT INTO dw.cuenta_alias (tipo_estado, alias_norm, codigo, seccion, fuente)
SELECT DISTINCT
    eo.tipo_estado,
    REGEXP_REPLACE(LOWER(unaccent(eo.cuenta_nombre)), '[^a-z0-9]+', ' ', 'g') AS alias_norm,
    eo.cuenta_codigo AS codigo,
    CASE
        WHEN eo.tipo_estado = 'balance' AND LEFT(eo.cuenta_codigo, 1) IN ('A','B','C','D','T')
            THEN LEFT(eo.cuenta_codigo, 1)
        ELSE NULL
    END AS seccion,
    'V108_file_variants' AS fuente
FROM raw.eeff_observacion eo
WHERE eo.cuenta_codigo IS NOT NULL
  AND eo.cuenta_nombre IS NOT NULL
ON CONFLICT (tipo_estado, alias_norm) DO NOTHING;

-- -------------------------------------------------------------------------
-- Reporte
-- -------------------------------------------------------------------------
DO $$
DECLARE v_total INT; v_new INT;
BEGIN
    SELECT count(*) INTO v_total FROM dw.cuenta_alias;
    SELECT count(*) INTO v_new FROM dw.cuenta_alias WHERE fuente = 'V108_file_variants';
    RAISE NOTICE 'V108: % aliases nuevos desde file_variants, % total en cuenta_alias',
        v_new, v_total;
END $$;

COMMIT;
