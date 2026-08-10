-- =========================================================================
-- V157 — Data Quality: detectar 'no_publicado_sbs' viejos como faltantes
--
-- CONTEXTO: V136 introdujo admin.check_missing_files que cuenta
-- 'no_publicado_sbs' como "encontrado" para no generar ruido en meses
-- recientes (asumiendo que SBS solo tarda un poco). PERO si un archivo
-- lleva 40+ dias marcado como 'no_publicado_sbs' aunque SBS YA lo
-- publico (bug del downloader que guardo HTML basura como .xls y
-- skip_if_exists lo bloquea eternamente), el sistema NO alerta.
--
-- CASO REAL (2026-08): Indicadores CRAC y EDPYME del periodo 202606
-- ya estaban publicados en sbs.gob.pe pero nuestro raw.archivos_
-- descargados los tenia como 'no_publicado_sbs' desde julio. Usuario
-- lo detecto por casualidad al ver el badge amarillo del /informe;
-- data-quality dashboard mostraba 0 alertas porque NO cuentan como
-- overdue.
--
-- FIX: 'no_publicado_sbs' con actualizado_en < (fecha_esperada + lag/2)
-- se considera "stale" y NO cuenta como encontrado. Asi is_overdue=true
-- se dispara y /dashboard/admin/data-quality lo muestra en critical.
--
-- FALLBACK: si actualizado_en es reciente (< lag*1.5 desde cierre_mes),
-- sigue contando como encontrado — asi no generamos ruido en meses
-- que estan legitimamente esperando publicacion.
-- =========================================================================

CREATE OR REPLACE FUNCTION admin.check_missing_files(_periodo INT)
RETURNS TABLE(
    grupo            TEXT,
    topico           TEXT,
    n_esperados      INT,
    n_encontrados    INT,
    n_faltantes      INT,
    publish_lag_days INT,
    fecha_esperada   DATE,
    is_overdue       BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    WITH periodo_info AS (
        SELECT
            _periodo AS periodo,
            (make_date(_periodo / 100, _periodo % 100, 1)
                + INTERVAL '1 month' - INTERVAL '1 day')::date AS cierre_mes
    ),
    baseline_con_stale AS (
        -- Precalculo del threshold: si un no_publicado_sbs fue actualizado
        -- HACE mas tiempo que fecha_esperada + lag/2, es stale (probable
        -- bug del downloader) y no cuenta como encontrado.
        SELECT
            b.grupo,
            b.topico,
            b.n_archivos_esperados,
            b.publish_lag_days,
            b.valid_from,
            b.valid_to,
            (p.cierre_mes + (b.publish_lag_days || ' days')::interval)::date AS fecha_esperada,
            (p.cierre_mes + ((b.publish_lag_days * 1.5)::int || ' days')::interval)::date AS stale_threshold
        FROM admin.expected_files_baseline b
        CROSS JOIN periodo_info p
        WHERE b.valid_from <= _periodo
          AND (b.valid_to IS NULL OR b.valid_to >= _periodo)
    ),
    encontrados AS (
        -- 'procesado' y 'sospechoso' siempre cuentan.
        -- 'no_publicado_sbs' cuenta solo si es reciente (actualizado despues
        -- del stale_threshold — o sea todavia esperamos que SBS publique).
        -- Si es viejo, es sintoma de bug — no cuenta y dispara alerta.
        SELECT a.grupo, a.topico, COUNT(*) AS n_encontrados
        FROM raw.archivos_descargados a
        LEFT JOIN baseline_con_stale b ON b.grupo = a.grupo AND b.topico = a.topico
        WHERE a.periodo = _periodo
          AND (
            a.status IN ('procesado', 'sospechoso')
            OR (
                a.status = 'no_publicado_sbs'
                AND a.actualizado_en >= b.stale_threshold::timestamptz
            )
          )
        GROUP BY a.grupo, a.topico
    )
    SELECT
        b.grupo,
        b.topico,
        b.n_archivos_esperados AS n_esperados,
        COALESCE(e.n_encontrados, 0) AS n_encontrados,
        GREATEST(b.n_archivos_esperados - COALESCE(e.n_encontrados, 0), 0) AS n_faltantes,
        b.publish_lag_days,
        b.fecha_esperada,
        (CURRENT_DATE > b.fecha_esperada
         AND COALESCE(e.n_encontrados, 0) < b.n_archivos_esperados) AS is_overdue
    FROM baseline_con_stale b
    LEFT JOIN encontrados e ON e.grupo = b.grupo AND e.topico = b.topico
    ORDER BY is_overdue DESC, n_faltantes DESC, b.grupo, b.topico;
$$;

COMMENT ON FUNCTION admin.check_missing_files IS
    'V157: mejora sobre V136 — trata no_publicado_sbs viejo (actualizado_en '
    '< fecha_esperada + lag*1.5) como faltante, no como encontrado. Asi el '
    '/dashboard/admin/data-quality dispara alerta critical cuando el downloader '
    'quedo bloqueado y SBS ya publico. Meses recientes que legitimamente estan '
    'esperando publicacion (dentro del lag) siguen sin ruido.';


-- ============ Vista helper: no_publicado_sbs stale por revisar ============
-- Lista archivos marcados como no_publicado_sbs que YA excedieron el lag
-- esperado — candidatos a force-redownload o revision manual.
--
-- Consumir desde:
--   - /dashboard/admin/data-quality (nueva seccion "Descargas atascadas")
--   - Alerta email/log del cron diario
--   - CLI: `aibenchef sbs recheck-stale-no-publicados`

CREATE OR REPLACE VIEW admin.v_no_publicados_stale AS
WITH baseline_actual AS (
    SELECT
        grupo,
        topico,
        publish_lag_days
    FROM admin.expected_files_baseline
    WHERE valid_to IS NULL OR valid_to >= (SELECT MAX(periodo) FROM raw.archivos_descargados)
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
FROM raw.archivos_descargados a
LEFT JOIN baseline_actual b ON b.grupo = a.grupo AND b.topico = a.topico
WHERE a.status = 'no_publicado_sbs'
  AND CURRENT_DATE > (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + ((COALESCE(b.publish_lag_days, 30) * 1.5)::int || ' days')::interval)::date
ORDER BY dias_stale DESC, a.periodo DESC, a.grupo, a.topico;

COMMENT ON VIEW admin.v_no_publicados_stale IS
    'V157: archivos SBS marcados no_publicado_sbs que ya excedieron 1.5x el '
    'lag esperado — candidatos a force-redownload por bug del downloader '
    '(HTML basura guardado como .xls) o publicacion tardia de SBS.';
