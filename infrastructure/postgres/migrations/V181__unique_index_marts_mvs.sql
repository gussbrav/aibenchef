-- =========================================================================
-- V181 — UNIQUE INDEX en las 5 MVs de marts que faltaban
-- =========================================================================
--
-- BUG descubierto 2026-08-19 mientras cerrabamos deudas tecnicas:
-- 5 de las 25 MVs de marts NO tenian UNIQUE INDEX:
--   - mv_clientes_resumen
--   - mv_cobertura_geografica
--   - mv_creditos_distrito_long
--   - mv_tasas_activas_resumen
--   - mv_tasas_pasivas_resumen
--
-- Consecuencia: `REFRESH MATERIALIZED VIEW CONCURRENTLY <mv>` (que es
-- lo que usa el CLI `aibenchef pipeline refresh-marts --concurrent` y
-- el watchdog del worker) FALLA sobre estas 5 con
--   ERROR: cannot refresh materialized view "..." concurrently
--   HINT: Create a unique index with no WHERE clause...
--
-- Riesgo residual: la excepcion aborta el resto del loop del CLI (las
-- MVs posteriores no se refrescan en esa corrida). No cuelga el
-- dashboard porque el fallback a REFRESH sin CONCURRENTLY NO existe
-- en el CLI actual — pero es fragil. Con UNIQUE INDEX en las 5,
-- refresh CONCURRENTLY funciona en TODAS y jamas bloquea reads.
--
-- Keys verificadas contra data prod 2026-08-19 (cero duplicados):
--   mv_clientes_resumen       (tipo, periodo, empresa, producto)
--   mv_cobertura_geografica   (periodo, departamento, tipo_entidad, producto)
--   mv_creditos_distrito_long (periodo, departamento, provincia,
--                              distrito, tipo_entidad, tipo_credito, tipo_base)
--   mv_tasas_activas_resumen  (periodo, empresa_sbs, segmento_credito, tipo_operacion)
--   mv_tasas_pasivas_resumen  (periodo, empresa_sbs, producto)
--
-- Idempotente (IF NOT EXISTS). NO usa CONCURRENTLY en el CREATE porque
-- corre en migrator dentro de txn; los volumenes son chicos (MVs
-- resumen) y toma segundos con LOCK aceptable.
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_clientes_resumen
    ON marts.mv_clientes_resumen (tipo, periodo, empresa, producto);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_cobertura_geografica
    ON marts.mv_cobertura_geografica (periodo, departamento, tipo_entidad, producto);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_creditos_distrito_long
    ON marts.mv_creditos_distrito_long
       (periodo, departamento, provincia, distrito, tipo_entidad, tipo_credito, tipo_base);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_tasas_activas_resumen
    ON marts.mv_tasas_activas_resumen (periodo, empresa_sbs, segmento_credito, tipo_operacion);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_tasas_pasivas_resumen
    ON marts.mv_tasas_pasivas_resumen (periodo, empresa_sbs, producto);

COMMENT ON INDEX marts.uq_mv_clientes_resumen IS
    'V181: unique key para permitir REFRESH CONCURRENTLY.';
COMMENT ON INDEX marts.uq_mv_cobertura_geografica IS
    'V181: unique key para permitir REFRESH CONCURRENTLY.';
COMMENT ON INDEX marts.uq_mv_creditos_distrito_long IS
    'V181: unique key para permitir REFRESH CONCURRENTLY.';
COMMENT ON INDEX marts.uq_mv_tasas_activas_resumen IS
    'V181: unique key para permitir REFRESH CONCURRENTLY.';
COMMENT ON INDEX marts.uq_mv_tasas_pasivas_resumen IS
    'V181: unique key para permitir REFRESH CONCURRENTLY.';
