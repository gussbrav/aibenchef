-- =========================================================================
-- V111: Ajustar valido_desde de cabecera moderna al primer periodo con data
--
-- BUG
--
-- V105 puso TODAS las cabeceras modernas (post-2013) con valido_desde=201301.
-- Pero la mayoria de codigos (1, 1.1, 2, 3, 5, 6, 12.7 Depreciacion, 14, 17,
-- A1-A9, B1-B10, etc.) ya existian PRE-2013 — SBS no los introdujo en la
-- reforma 2013, solo reformulo ALGUNOS codigos especificos (C2->C3+C5,
-- A3.6->A3.5, eliminacion de 1.9, 2.12, 4.1, 4.2, 12.1, 13.1-3, 15).
--
-- Para periodo 200901 el Inspector solo mostraba los 9 codigos legacy
-- (1.9, 2.12, 4.1, 4.2, 12.1, 13.1-3, 15) que es claramente incompleto:
-- el file 200901 tiene 12.7 Depreciacion, 14 RESULTADO ANTES, 17 RESULTADO
-- NETO, etc. y existen en raw con esos codigos.
--
-- FIX
--
-- UPDATE cabecera moderna SET valido_desde = LEAST(valido_desde, periodo
-- minimo donde el codigo TIENE data en raw). Para codigos que efectivamente
-- existen en raw desde 200901, valido_desde quedara en 200801 (o el periodo
-- minimo si es mas tardio).
--
-- Codigos que NO tienen data pre-2013 (los nuevos del 2013, como C3/C5/A3.5)
-- mantienen valido_desde=201301.
-- =========================================================================

BEGIN;

-- Para cada (tipo_estado, tipo_entidad, codigo) en cabecera moderna,
-- encontrar el periodo minimo donde existe data en raw.
WITH min_periodo AS (
    SELECT tipo_estado, tipo_entidad, cuenta_codigo, MIN(periodo) AS min_p
      FROM raw.eeff_observacion
     WHERE cuenta_codigo IS NOT NULL
     GROUP BY 1, 2, 3
)
UPDATE dw.cabecera_maestra cm
   SET valido_desde = LEAST(cm.valido_desde, GREATEST(200801, mp.min_p)),
       updated_at = now()
  FROM min_periodo mp
 WHERE cm.tipo_estado  = mp.tipo_estado
   AND cm.tipo_entidad = mp.tipo_entidad
   AND cm.codigo       = mp.cuenta_codigo
   AND cm.valido_hasta IS NULL
   AND mp.min_p < cm.valido_desde;

-- -------------------------------------------------------------------------
-- Reporte
-- -------------------------------------------------------------------------
DO $$
DECLARE v_now201301 INT; v_now200801 INT; v_other INT;
BEGIN
    SELECT count(*) INTO v_now201301 FROM dw.cabecera_maestra
     WHERE valido_hasta IS NULL AND valido_desde = 201301;
    SELECT count(*) INTO v_now200801 FROM dw.cabecera_maestra
     WHERE valido_hasta IS NULL AND valido_desde = 200801;
    SELECT count(*) INTO v_other FROM dw.cabecera_maestra
     WHERE valido_hasta IS NULL AND valido_desde NOT IN (200801, 201301);
    RAISE NOTICE 'V111: % rows valido_desde=200801, % rows valido_desde=201301, % rows otros',
        v_now200801, v_now201301, v_other;
END $$;

COMMIT;
