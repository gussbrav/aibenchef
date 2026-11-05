-- =========================================================================
-- V207: Corrige parent_codigo COOPAC N2B balance para MonthlyCoopacEeffImporter
--
-- V201 asignó parent_codigo='A' a las cuentas L2 del ACTIVO y parent_codigo='B'
-- a las del PASIVO. Pero el XLS COOPAC N2B tiene estructura INVERTIDA:
--
--   Fila 8   DISPONIBLE (uppercase) ← current_l1=None todavía
--   Fila 22  CRÉDITOS NETOS... (uppercase) ← current_l1=None todavía
--   Fila 53  TOTAL ACTIVO (uppercase) ← recién aquí sets current_l1='A'
--   Fila 65  OBLIGACIONES CON LOS SOCIOS ← current_l1='A' (no 'B')
--   Fila 110 TOTAL PASIVO ← sets current_l1='B'
--   Fila 112 PATRIMONIO ← sets current_l2='C' (nivel=2 necesario)
--
-- Regla: parent_codigo = valor de current_l1 cuando esa fila aparece en el XLS.
--
-- ACTIVO L2: se procesan con current_l1=None → parent_codigo = NULL
-- PASIVO L2: se procesan con current_l1='A' → parent_codigo = 'A'
-- PATRIMONIO: nivel 1→2 para que sub-cuentas resuelvan via current_l2='C'
--
-- IDEMPOTENTE: UPDATE pisa el valor previo, misma ejecución N veces = OK.
-- =========================================================================

-- ACTIVO L2: procesados cuando current_l1=NULL (antes de TOTAL ACTIVO)
UPDATE dw.cabecera_maestra
SET parent_codigo = NULL
WHERE tipo_entidad = 'COOPAC_N2B'
  AND tipo_estado  = 'balance'
  AND valido_hasta IS NULL
  AND codigo IN ('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A_bir');

-- PASIVO L2: procesados cuando current_l1='A' (despues de TOTAL ACTIVO, fila 53)
UPDATE dw.cabecera_maestra
SET parent_codigo = 'A'
WHERE tipo_entidad = 'COOPAC_N2B'
  AND tipo_estado  = 'balance'
  AND valido_hasta IS NULL
  AND codigo IN ('B1', 'B2', 'B3', 'B5', 'B6', 'B_fi', 'B_igp', 'B_prov', 'B_sub');

-- PATRIMONIO: nivel 1→2 para que sus sub-cuentas puedan resolverse via current_l2='C'
-- (lookup: (current_l2='C', nombre_norm) → C1/C2/C3/etc.)
UPDATE dw.cabecera_maestra
SET nivel = 2
WHERE tipo_entidad = 'COOPAC_N2B'
  AND tipo_estado  = 'balance'
  AND valido_hasta IS NULL
  AND codigo = 'C';

-- Refrescar MVs para que los nuevos datos sean visibles en analytics
REFRESH MATERIALIZED VIEW marts.mv_eeff_balance_ancho;
REFRESH MATERIALIZED VIEW marts.mv_eeff_resultados_ancho;
