-- =========================================================================
-- V218: Alinear nombre_fuente de cabecera COOPAC con los nombres exactos
--       que SBS trae en el XLS a Sep 2026.
--
-- CONTEXTO
--   El importer COOPAC (`monthly_coopac_eeff_importer.py`) hace matching
--   por nombre normalizado contra `dw.cabecera_maestra.nombre_fuente`.
--   Para los 4 niveles COOPAC, nombre_fuente de A4 (CREDITOS DIRECTOS) está
--   TRUNCADO a "Creditos Netos de Provisiones y de Ingresos n" (45 chars
--   aprox), por lo que NO matchea el string completo del XLS:
--     "CRÉDITOS NETOS DE PROVISIONES Y DE INGRESOS NO DEVENGADOS"
--   Al fallar el match por nombre, el parser caía al fallback posicional
--   silencioso que asignaba códigos INCORRECTOS a las sub-cuentas,
--   propagando error por todas las entidades y arrastrando el PE a valores
--   irreales (SAN BLAS rendimiento 48.95% cuando correcto ~37%).
--
--   Además la entrada A4.3 ATRASADOS fue borrada previamente al detectar
--   una colisión de `orden` (duplicado con A4.2). Esta migración la
--   re-inserta con parent_codigo=A4 y nombre_fuente='Atrasados' para que
--   el parser la resuelva correctamente por nombre (NO por posición).
--
--   Finalmente, completa nombre_fuente faltantes en A4.4 Provisiones y
--   A7 Otros Activos para que matcheen el XLS exacto.
--
-- DISEÑO
--   Idempotente. Solo UPDATE cuando nombre_fuente actual difiera del
--   objetivo. INSERT con ON CONFLICT DO NOTHING.
--
--   NO modifica el campo `orden` de ninguna entrada existente, para no
--   alterar el pos_map que otros periodos puedan necesitar.
--
-- HARDENING DEL PARSER (fuera de esta migración)
--   En paralelo a V218, el parser elimina el fallback posicional silencioso
--   para sub-items: si un sub-item no matchea por nombre, queda con
--   cuenta_codigo=NULL y un WARN explícito. La única manera que un sub-item
--   quede bien resuelto es que exista en cabecera con parent_codigo correcto
--   y nombre_fuente que matchee el XLS.
-- =========================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 1. Completar A4 CREDITOS DIRECTOS nombre_fuente al nombre completo.
--    El valor truncado anterior no matcheaba el XLS.
-- -----------------------------------------------------------------------
UPDATE dw.cabecera_maestra
SET nombre_fuente = 'Créditos Netos de Provisiones y de Ingresos No Devengados',
    updated_at    = now()
WHERE codigo         = 'A4'
  AND tipo_entidad   LIKE 'COOPAC_%'
  AND tipo_estado    = 'balance'
  AND valido_hasta   IS NULL;

-- -----------------------------------------------------------------------
-- 2. Re-insertar A4.3 ATRASADOS (header L2 bajo CREDITOS DIRECTOS).
--    nombre_fuente='Atrasados' matchea el string del XLS exacto.
--    parent_codigo='A4' para que el parser lo resuelva vía
--    cuentas_map.get(('A4', 'atrasados')).
--
--    orden=999 (reservado para entradas que NO dependen de posición).
--    El PK (tipo_estado, tipo_entidad, orden, valido_desde) requiere orden
--    único, y el parser ya no usa pos_map para sub-items (hardening
--    2026-11-18), así que A4.3 no necesita un orden posicional específico.
-- -----------------------------------------------------------------------
INSERT INTO dw.cabecera_maestra (
    codigo, nombre, nombre_fuente, orden, nivel,
    tipo_entidad, tipo_estado, parent_codigo,
    valido_desde, valido_hasta, pais, regulador,
    es_header, es_total, es_seccion
)
VALUES
    ('A4.3', 'ATRASADOS', 'Atrasados', 999, 2,
     'COOPAC_N1',  'balance', 'A4', 202101, NULL, 'PE', 'SBS', TRUE, FALSE, FALSE),
    ('A4.3', 'ATRASADOS', 'Atrasados', 999, 2,
     'COOPAC_N2A', 'balance', 'A4', 202101, NULL, 'PE', 'SBS', TRUE, FALSE, FALSE),
    ('A4.3', 'ATRASADOS', 'Atrasados', 999, 2,
     'COOPAC_N2B', 'balance', 'A4', 202101, NULL, 'PE', 'SBS', TRUE, FALSE, FALSE),
    ('A4.3', 'ATRASADOS', 'Atrasados', 999, 2,
     'COOPAC_N3',  'balance', 'A4', 202101, NULL, 'PE', 'SBS', TRUE, FALSE, FALSE)
ON CONFLICT (tipo_estado, tipo_entidad, codigo) WHERE valido_hasta IS NULL AND codigo IS NOT NULL
DO UPDATE SET
    nombre_fuente = EXCLUDED.nombre_fuente,
    parent_codigo = EXCLUDED.parent_codigo,
    updated_at    = now();

-- -----------------------------------------------------------------------
-- 3. Completar nombre_fuente faltantes en cuentas L2 críticas.
--    A4.4 Provisiones y A7 Otros Activos tenían nombre_fuente NULL.
-- -----------------------------------------------------------------------
UPDATE dw.cabecera_maestra
SET nombre_fuente = 'Provisiones',
    updated_at    = now()
WHERE codigo         = 'A4.4'
  AND tipo_entidad   LIKE 'COOPAC_%'
  AND tipo_estado    = 'balance'
  AND nombre_fuente  IS NULL
  AND valido_hasta   IS NULL;

UPDATE dw.cabecera_maestra
SET nombre_fuente = 'Otros Activos',
    updated_at    = now()
WHERE codigo         = 'A7'
  AND tipo_entidad   LIKE 'COOPAC_%'
  AND tipo_estado    = 'balance'
  AND nombre_fuente  IS NULL
  AND valido_hasta   IS NULL;

-- -----------------------------------------------------------------------
-- 4. Verificación post-migración (no bloquea commit, solo muestra en logs).
-- -----------------------------------------------------------------------
DO $$
DECLARE
    _rows INT;
BEGIN
    SELECT COUNT(*) INTO _rows
    FROM dw.cabecera_maestra
    WHERE codigo = 'A4.3' AND tipo_entidad LIKE 'COOPAC_%' AND tipo_estado = 'balance';
    RAISE NOTICE 'V218: A4.3 entries now = %', _rows;

    SELECT COUNT(*) INTO _rows
    FROM dw.cabecera_maestra
    WHERE codigo = 'A4' AND tipo_entidad LIKE 'COOPAC_%'
      AND nombre_fuente = 'Créditos Netos de Provisiones y de Ingresos No Devengados';
    RAISE NOTICE 'V218: A4 nombre_fuente completo = %', _rows;
END $$;

COMMIT;
