-- =========================================================================
-- V195: Seed dw.entidad_maestra + dw.entidad_nombre para cooperativas COOPAC
--
-- V192 agrego las 291 cooperativas a dw.dim_entidad pero NO a
-- dw.entidad_maestra (comentario V192: "se puede poblar manualmente").
-- Sin entrada en entidad_maestra, las queries del Punto de Equilibrio
-- no pueden canonizar nombres ni resolver aliases historicos — las
-- cooperativas aparecen como "huerfanos" y el dropdown del PE las muestra
-- sin metadatos de tipo (N3/N2B/N2A/N1).
--
-- Esta migration pobla la maestra usando los datos ya limpios de dim_entidad.
-- Solo se insertan entidades individuales (NOT es_total AND NOT es_sucursal).
-- Idempotente: ON CONFLICT DO NOTHING en ambas tablas.
--
-- ROLLBACK:
--   -- 1. Borrar entidad_nombre insertados por esta migration
--   DELETE FROM dw.entidad_nombre
--     WHERE fuente = 'V195 coopac seed';
--   -- 2. Borrar entidad_maestra insertados por esta migration
--   DELETE FROM dw.entidad_maestra
--     WHERE notas = 'seeded V195';
-- =========================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1 — Seed entidad_maestra: 1 fila por cooperativa individual
--
-- Usa los datos de dim_entidad que V192 ya limpio (sin totales ni sistema).
-- tipo_entidad_actual hereda el nivel COOPAC (N3/N2B/N2A/N1).
-- es_microfinanciera=TRUE para todas las cooperativas.
-- ---------------------------------------------------------------------------
INSERT INTO dw.entidad_maestra
    (nomb_correg_canonico, tipo_entidad_actual, es_microfinanciera, nacional, activa, notas)
SELECT
    de.nomb_correg,
    de.tipo_entidad,
    TRUE,
    'LOCAL',
    TRUE,
    'seeded V195'
FROM dw.dim_entidad de
WHERE de.tipo_entidad LIKE 'COOPAC_%'
  AND NOT de.es_total
  AND NOT de.es_sucursal
ON CONFLICT (nomb_correg_canonico) DO NOTHING;

-- ---------------------------------------------------------------------------
-- PARTE 2 — Seed entidad_nombre: nombre canonico para cada cooperativa
--
-- Una cooperativa no deberia tener renombres historicos en el plan contable
-- SBS — el nombre llega siempre igual en cada archivo mensual. Por eso
-- solo se inserta el nombre 'canonico' con consolidar=TRUE.
-- Si en el futuro hay renombres se agregan como 'historico' en otra migration.
-- ---------------------------------------------------------------------------
INSERT INTO dw.entidad_nombre
    (entidad_id, nombre, tipo, consolidar, fuente)
SELECT
    em.id,
    em.nomb_correg_canonico,
    'canonico',
    TRUE,
    'V195 coopac seed'
FROM dw.entidad_maestra em
WHERE em.tipo_entidad_actual LIKE 'COOPAC_%'
ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
