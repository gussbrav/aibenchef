-- =========================================================================
-- V178: Tighten stale threshold + vista de archivos "re-verificables"
--
-- BUG (2026-08-19): financieras/indicadores/202606 seguia mostrando
-- "PUBLICACION PARCIAL" en el informe aunque SBS ya lo habia publicado.
-- Root cause: la fila quedo en status='no_publicado_sbs' desde una corrida
-- previa. Como el cron auto esta desactivado y admin no re-corrio la
-- ingesta despues de que SBS publico, la DB nunca se entero.
--
-- Ademas, el detector v_no_publicados_stale (V161) usaba publish_lag * 1.5
-- (para indicadores = 45 dias) — muy generoso. Da 15 dias de ventana muerta
-- donde el badge muestra "parcial" pero admin no tiene senal accionable.
--
-- Diseno de este fix:
--   1. v_no_publicados_stale: threshold = publish_lag + 7 dias (mas
--      agresivo). Para indicadores baja de 45 → 37 dias. SBS publica
--      historicamente < publish_lag; 7 dias de gracia son suficientes.
--   2. Nueva vista v_no_publicados_reverificables: MISMOS archivos pero
--      con criterio mas laxo (publish_lag + 3 dias). Sirve para el auto-
--      reverify diario, que solo re-verifica archivos que han pasado el
--      lag esperado + 3 dias. No los marca como "atascados" aun (no gritan
--      al admin todavia), pero se re-verifican silenciosamente por si SBS
--      ya publico.
-- =========================================================================

CREATE OR REPLACE VIEW admin.v_no_publicados_stale AS
WITH baseline_actual AS (
    SELECT
        grupo,
        topico,
        publish_lag_days
    FROM admin.expected_files_baseline
    WHERE valid_to IS NULL OR valid_to >= (SELECT MAX(periodo) FROM raw.archivos_descargados)
),
ultimo_por_archivo AS (
    SELECT DISTINCT ON (periodo, grupo, topico)
        periodo, grupo, topico, status, path_local, actualizado_en
    FROM raw.archivos_descargados
    ORDER BY periodo, grupo, topico, actualizado_en DESC
)
SELECT
    a.periodo,
    a.grupo,
    a.topico,
    a.path_local,
    a.actualizado_en,
    (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day')::date AS cierre_mes,
    b.publish_lag_days,
    (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + (b.publish_lag_days || ' days')::interval)::date AS fecha_esperada,
    (CURRENT_DATE - (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + (b.publish_lag_days || ' days')::interval)::date) AS dias_stale
FROM ultimo_por_archivo a
LEFT JOIN baseline_actual b ON b.grupo = a.grupo AND b.topico = a.topico
WHERE a.status = 'no_publicado_sbs'
  -- V178: threshold = publish_lag + 7 dias (antes 1.5x). Para indicadores:
  -- publish_lag=30 → stale desde dia 37, no dia 45. Da senal mas rapida
  -- al admin sin caer en falsos positivos (SBS raramente publica > lag+7).
  AND CURRENT_DATE > (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + ((COALESCE(b.publish_lag_days, 30) + 7) || ' days')::interval)::date
ORDER BY dias_stale DESC, a.periodo DESC, a.grupo, a.topico;

COMMENT ON VIEW admin.v_no_publicados_stale IS
    'V178: threshold pasa de publish_lag*1.5 a publish_lag+7d. Mas agresivo '
    'pero no ruidoso: SBS rara vez publica >7 dias despues del lag esperado. '
    'Para indicadores (lag=30d), stale ahora arranca dia 37 en vez de 45.';


-- ============ Vista de "re-verificables" (guardarail auto-reverify) ============
-- Threshold suave: publish_lag + 3 dias. Estos archivos NO se muestran
-- como "atascados" al admin, pero el auto-reverify diario (script
-- pnpm reverify-sbs) los toca cada 3 dias para re-verificar con SBS,
-- por si publicaron sin que nadie corriera la ingesta manual.
--
-- Restriccion adicional: last_check_hace >= 3 dias — no re-verifica el
-- mismo archivo mas de 1x cada 72h (rate limit contra SBS).
CREATE OR REPLACE VIEW admin.v_no_publicados_reverificables AS
WITH baseline_actual AS (
    SELECT grupo, topico, publish_lag_days
    FROM admin.expected_files_baseline
    WHERE valid_to IS NULL OR valid_to >= (SELECT MAX(periodo) FROM raw.archivos_descargados)
),
ultimo_por_archivo AS (
    SELECT DISTINCT ON (periodo, grupo, topico)
        periodo, grupo, topico, status, path_local, actualizado_en
    FROM raw.archivos_descargados
    ORDER BY periodo, grupo, topico, actualizado_en DESC
)
SELECT
    a.periodo, a.grupo, a.topico,
    a.actualizado_en,
    b.publish_lag_days,
    (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day')::date AS cierre_mes,
    (CURRENT_DATE - (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + (b.publish_lag_days || ' days')::interval)::date) AS dias_desde_esperado,
    EXTRACT(DAY FROM (now() - a.actualizado_en))::int AS dias_desde_ultimo_check
FROM ultimo_por_archivo a
LEFT JOIN baseline_actual b ON b.grupo = a.grupo AND b.topico = a.topico
WHERE a.status = 'no_publicado_sbs'
  -- Ya paso el lag + 3 dias (o sea SBS "debio" haber publicado)
  AND CURRENT_DATE > (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + ((COALESCE(b.publish_lag_days, 30) + 3) || ' days')::interval)::date
  -- Y no hemos re-checkeado en los ultimos 3 dias (rate limit)
  AND a.actualizado_en < now() - INTERVAL '3 days'
ORDER BY a.periodo DESC, a.grupo, a.topico;

COMMENT ON VIEW admin.v_no_publicados_reverificables IS
    'V178: archivos elegibles para auto-reverify diario. Threshold mas laxo '
    'que stale (publish_lag+3 vs +7) + rate limit de 3 dias entre re-checks. '
    'Consumido por scripts/reverify-sbs.ts que encola sync_jobs para todos '
    'estos periodos idempotentemente.';
