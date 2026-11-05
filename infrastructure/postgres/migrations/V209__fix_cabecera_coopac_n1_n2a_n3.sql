-- =========================================================================
-- V209: Corrige parent_codigo COOPAC N1/N2A/N3 balance (mismo fix que V207 para N2B)
--
-- V207 aplicó el fix solo para COOPAC_N2B. Los tipos N1, N2A y N3 comparten
-- el mismo layout XLS invertido (sub-cuentas de ACTIVO aparecen ANTES de
-- TOTAL ACTIVO), por lo que sufrían la misma desalineación de parent_codigo
-- introducida por V201.
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
WHERE tipo_entidad IN ('COOPAC_N1', 'COOPAC_N2A', 'COOPAC_N3')
  AND tipo_estado  = 'balance'
  AND valido_hasta IS NULL
  AND codigo IN ('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A_bir');

-- PASIVO L2: procesados cuando current_l1='A' (despues de TOTAL ACTIVO)
UPDATE dw.cabecera_maestra
SET parent_codigo = 'A'
WHERE tipo_entidad IN ('COOPAC_N1', 'COOPAC_N2A', 'COOPAC_N3')
  AND tipo_estado  = 'balance'
  AND valido_hasta IS NULL
  AND codigo IN ('B1', 'B2', 'B3', 'B5', 'B6', 'B_fi', 'B_igp', 'B_prov', 'B_sub');

-- PATRIMONIO: nivel 1→2 para que sus sub-cuentas puedan resolverse via current_l2='C'
UPDATE dw.cabecera_maestra
SET nivel = 2
WHERE tipo_entidad IN ('COOPAC_N1', 'COOPAC_N2A', 'COOPAC_N3')
  AND tipo_estado  = 'balance'
  AND valido_hasta IS NULL
  AND codigo = 'C';

-- Refrescar MVs para que los nuevos datos sean visibles en analytics
REFRESH MATERIALIZED VIEW marts.mv_eeff_balance_ancho;
REFRESH MATERIALIZED VIEW marts.mv_eeff_resultados_ancho;
