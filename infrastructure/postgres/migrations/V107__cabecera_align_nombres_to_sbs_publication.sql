-- =========================================================================
-- V107: Alinear cabecera_maestra.nombre con el nombre PUBLICADO por SBS (issue #42)
--
-- PROBLEMA
--
-- La cabecera_maestra tiene nombres que NO coinciden exactamente con los
-- publicados por SBS (40+ casos detectados):
--
--   Cabecera                                     SBS publica
--   ─────────────────────────────────────       ─────────────────────────────
--   Hipotecarios para Vivienda             vs    Hipotecarios
--   Arrendamiento Financiero               vs    Arrendamiento
--   Depósitos a la Vista                   vs    Depósitos A La Vista
--   Depósitos de Ahorro                    vs    Depósitos de Ahorros
--   Vigentes*                              vs    Vigentes
--   Atrasados*                             vs    Atrasados
--   Refinanciados y Reestructurados*       vs    Refinanciados y Reestructurados
--   Resultado Neto del Ejercicio           vs    Resultados Netos del Ejercicio
--   Instituciones del País                 vs    Instituciones Financieras del País
--   Instituciones del Exterior y Org...    vs    Empresas del Exterior y Org...
--   Disponible (resultados 1.1)            vs    Disponibles
--   Provisones para Créditos Indirectos    vs    Provisiones para Créditos Indirectos
--   A la vista (B1.5.1)                    vs    A la Vista
--   Pérdida por Inversiones...             vs    Pérdidas por Inversiones...
--   Provisiones para Bienes Realizados     vs    Provisiones para Bienes Realizables
--   ... etc
--
-- FIX
--
-- El nombre publicado por SBS es la fuente de verdad. UPDATE cabecera.nombre
-- = nombre_file_mas_frecuente por (tipo_estado, tipo_entidad, codigo, era).
--
-- Era vigente (valido_hasta IS NULL): usa nombre file periodo >= 201301
-- Era legacy (valido_hasta = 201212): usa nombre file periodo < 201301
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: VIGENTE — alinear cabecera moderna a nombre SBS publicado
-- desde 201301 (post reforma)
-- -------------------------------------------------------------------------
WITH file_freq AS (
    SELECT eo.tipo_estado, eo.tipo_entidad, eo.cuenta_codigo, eo.cuenta_nombre,
           count(*) AS n,
           ROW_NUMBER() OVER (
               PARTITION BY eo.tipo_estado, eo.tipo_entidad, eo.cuenta_codigo
               ORDER BY count(*) DESC
           ) AS rank
      FROM raw.eeff_observacion eo
     WHERE eo.cuenta_codigo IS NOT NULL
       AND eo.periodo >= 201301
     GROUP BY 1,2,3,4
),
top_name AS (
    SELECT tipo_estado, tipo_entidad, cuenta_codigo, cuenta_nombre
      FROM file_freq WHERE rank = 1
)
UPDATE dw.cabecera_maestra cm
   SET nombre = tn.cuenta_nombre,
       updated_at = now()
  FROM top_name tn
 WHERE cm.tipo_estado  = tn.tipo_estado
   AND cm.tipo_entidad = tn.tipo_entidad
   AND cm.codigo       = tn.cuenta_codigo
   AND cm.valido_hasta IS NULL
   AND LOWER(REGEXP_REPLACE(unaccent(cm.nombre), '[^a-z0-9]+', ' ', 'g'))
       != LOWER(REGEXP_REPLACE(unaccent(tn.cuenta_nombre), '[^a-z0-9]+', ' ', 'g'));

-- -------------------------------------------------------------------------
-- Step 2: LEGACY — alinear cabecera pre-2013 a nombre SBS pre-2013
-- -------------------------------------------------------------------------
WITH file_freq AS (
    SELECT eo.tipo_estado, eo.tipo_entidad, eo.cuenta_codigo, eo.cuenta_nombre,
           count(*) AS n,
           ROW_NUMBER() OVER (
               PARTITION BY eo.tipo_estado, eo.tipo_entidad, eo.cuenta_codigo
               ORDER BY count(*) DESC
           ) AS rank
      FROM raw.eeff_observacion eo
     WHERE eo.cuenta_codigo IS NOT NULL
       AND eo.periodo < 201301
     GROUP BY 1,2,3,4
),
top_name AS (
    SELECT tipo_estado, tipo_entidad, cuenta_codigo, cuenta_nombre
      FROM file_freq WHERE rank = 1
)
UPDATE dw.cabecera_maestra cm
   SET nombre = tn.cuenta_nombre,
       updated_at = now()
  FROM top_name tn
 WHERE cm.tipo_estado  = tn.tipo_estado
   AND cm.tipo_entidad = tn.tipo_entidad
   AND cm.codigo       = tn.cuenta_codigo
   AND cm.valido_hasta = 201212
   AND LOWER(REGEXP_REPLACE(unaccent(cm.nombre), '[^a-z0-9]+', ' ', 'g'))
       != LOWER(REGEXP_REPLACE(unaccent(tn.cuenta_nombre), '[^a-z0-9]+', ' ', 'g'));

-- -------------------------------------------------------------------------
-- Audit log
-- -------------------------------------------------------------------------
INSERT INTO admin.cabecera_audit_log
    (tipo_estado, tipo_entidad, codigo, nombre, orden, accion, payload_after,
     performed_by, motivo)
SELECT tipo_estado, tipo_entidad, codigo, LEFT(nombre, 200), orden, 'update',
       jsonb_build_object('reason', 'V107_align_nombres_sbs'),
       'migration:V107',
       'Issue #42: alinear nombres cabecera con nombre real publicado por SBS'
FROM dw.cabecera_maestra
WHERE updated_at > now() - interval '5 minutes';

COMMIT;

-- -------------------------------------------------------------------------
-- Reporte: mismatches restantes (deben ser 0 o muy pocos)
-- -------------------------------------------------------------------------
DO $$
DECLARE v_mismatches INT;
BEGIN
    WITH cabecera_vig AS (
        SELECT tipo_estado, tipo_entidad, codigo, nombre
          FROM dw.cabecera_maestra WHERE valido_hasta IS NULL AND codigo IS NOT NULL
    ),
    file_distinct AS (
        SELECT DISTINCT tipo_estado, tipo_entidad, cuenta_codigo, cuenta_nombre
          FROM raw.eeff_observacion
         WHERE cuenta_codigo IS NOT NULL AND periodo >= 201301
    )
    SELECT count(*) INTO v_mismatches
      FROM file_distinct fd
      JOIN cabecera_vig cm
        ON cm.tipo_estado=fd.tipo_estado AND cm.tipo_entidad=fd.tipo_entidad
       AND cm.codigo=fd.cuenta_codigo
     WHERE LOWER(REGEXP_REPLACE(unaccent(fd.cuenta_nombre), '[^a-z0-9]+', ' ', 'g'))
        != LOWER(REGEXP_REPLACE(unaccent(cm.nombre), '[^a-z0-9]+', ' ', 'g'));
    RAISE NOTICE 'V107 verify: % mismatches residuales (vigente vs file>=201301)', v_mismatches;
END $$;
