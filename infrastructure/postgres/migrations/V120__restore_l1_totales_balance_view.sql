-- =========================================================================
-- V120 — Restaurar totales L1 sinteticos (cta_a, cta_b, cta_c) en
--        marts.v_eeff_balance_ancho.
--
-- ROOT CAUSE:
--   V026 creo marts.v_eeff_balance_ancho con cta_a/b/c computados como SUMA
--   de hijos L2 (los codigos 'A', 'B', 'C' agregados NO existen en raw —
--   SBS solo publica A1, A2, ..., B1, ..., C1, ...).
--
--   V088 sobreescribio el wrapper con un simple `SELECT * FROM mv` para
--   resolver issue #6 (panel informe), borrando los totales L1 sinteticos.
--   Resultado: Analisis Dinamico con DEFAULT_CONFIG.medidas = ['cta_a',
--   'cta_b', 'cta_c'] retorna 10000 filas pero todos los valores son NULL
--   (la columna existe en la MV pero siempre es NULL por la razon de arriba).
--
-- FIX:
--   Recrear el wrapper combinando:
--     * todas las columnas no-cuenta + no-cta_{a,b,c} de la MV (pass-through),
--     * cta_a/b/c sinteticos = SUMA con COALESCE de los hijos L2 publicados.
--
--   Lista de columnas alineada con V085 (ultimo CREATE de la MV) — V091 NO
--   toco esa lista, solo cambio queries en MVs aguas-abajo.
--
-- Idempotente: CREATE OR REPLACE VIEW preserva dependencias siempre que la
--   firma de salida sea compatible. Mantenemos los mismos nombres y tipos
--   que la version actual + los 3 totales L1.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_eeff_balance_ancho AS
SELECT
    periodo,
    fecha_cierre,
    nomb_correg,
    empresa_sbs,
    tipo_entidad,
    microfinanciera,
    nacional,
    moneda,
    -- Pass-through de todas las cuentas L2/L3 publicadas por SBS
    cta_a1, cta_a1_1, cta_a1_2, cta_a1_3, cta_a1_4,
    cta_a2,
    cta_a3, cta_a3_1, cta_a3_2, cta_a3_3, cta_a3_4, cta_a3_5, cta_a3_6,
        cta_a3_7, cta_a3_8, cta_a3_9,
    cta_a4, cta_a4_1, cta_a4_1_1, cta_a4_1_2, cta_a4_1_3, cta_a4_1_4,
        cta_a4_1_5, cta_a4_1_6, cta_a4_1_7, cta_a4_1_8, cta_a4_1_9,
        cta_a4_1_10, cta_a4_2, cta_a4_3, cta_a4_4, cta_a4_5,
    cta_a5,
    cta_a6,
    cta_a7,
    cta_a8,
    cta_a9,
    cta_a10,
    cta_b1, cta_b1_1, cta_b1_2, cta_b1_3, cta_b1_4, cta_b1_5, cta_b1_6,
    cta_b2,
    cta_b3,
    cta_b4,
    cta_b5,
    cta_b6,
    cta_b7,
    cta_b8,
    cta_b9,
    cta_b10,
    cta_c1, cta_c2, cta_c3, cta_c4, cta_c5, cta_c6, cta_c7, cta_c8,
    -- Totales L1 sinteticos: SUMA de hijos L2 (COALESCE para que un NULL
    -- en un hijo no anule todo el total — convencion contable SBS: campo
    -- ausente = 0).
    COALESCE(cta_a1,0) + COALESCE(cta_a2,0) + COALESCE(cta_a3,0)
        + COALESCE(cta_a4,0) + COALESCE(cta_a5,0) + COALESCE(cta_a6,0)
        + COALESCE(cta_a7,0) + COALESCE(cta_a8,0) + COALESCE(cta_a9,0)
        + COALESCE(cta_a10,0)
        AS cta_a,
    COALESCE(cta_b1,0) + COALESCE(cta_b2,0) + COALESCE(cta_b3,0)
        + COALESCE(cta_b4,0) + COALESCE(cta_b5,0) + COALESCE(cta_b6,0)
        + COALESCE(cta_b7,0) + COALESCE(cta_b8,0) + COALESCE(cta_b9,0)
        + COALESCE(cta_b10,0)
        AS cta_b,
    COALESCE(cta_c1,0) + COALESCE(cta_c2,0) + COALESCE(cta_c3,0)
        + COALESCE(cta_c4,0) + COALESCE(cta_c5,0) + COALESCE(cta_c6,0)
        + COALESCE(cta_c7,0) + COALESCE(cta_c8,0)
        AS cta_c
FROM marts.mv_eeff_balance_ancho;

COMMENT ON VIEW marts.v_eeff_balance_ancho IS
    'Wrapper estable sobre mv_eeff_balance_ancho. Expone TODAS las cuentas '
    'cta_* publicadas por SBS (L2/L3) y AGREGA cta_a/b/c sinteticos como '
    'SUMA L2 con COALESCE — los codigos L1 agregados (A, B, C) no existen '
    'en raw.eeff_observacion, por eso la MV los devuelve NULL. Sin estos '
    'totales sinteticos, Analisis Dinamico con medidas default (cta_a/b/c) '
    'retorna filas vacias. Ver V026 (definicion original) y V088 (regresion).';
