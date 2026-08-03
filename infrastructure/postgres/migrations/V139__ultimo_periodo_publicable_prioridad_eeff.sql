-- =========================================================================
-- V139 — Regla de oro: el dashboard SIEMPRE muestra el ultimo cierre
--       publicable, priorizando EEFF sobre topicos secundarios.
--
-- CONTEXTO:
-- La funcion marts.f_ultimo_periodo_completo() (V129) requeria que TODOS
-- los archivos SBS estuvieran procesados. Problema: SBS publica los EEFF
-- (balance + resultados) en la primera semana del mes+1, pero castigos,
-- tasas activas/pasivas e indicadores prudenciales pueden tardar 2-4
-- semanas mas. Consecuencia: durante ~3 semanas al mes el dashboard
-- muestra el mes anterior aunque el EEFF del mes corriente ya este listo.
--
-- Ejemplo real (2026-08-03):
--   - EEFF de junio 2026: 5/5 grupos procesados desde jul-31
--   - Castigos, tasas, geo de junio 2026: parcial (1-2 grupos aun no
--     publicados por SBS)
--   - f_ultimo_periodo_completo() devuelve 202605 (mayo) durante 3
--     semanas mas hasta que SBS termine de publicar los secundarios
--
-- REGLA CLASE MUNDIAL:
-- El "ultimo cierre" desde la perspectiva del negocio es el ultimo mes
-- con EEFF publicado. Los reportes secundarios (castigos, tasas, geo,
-- indicadores) enriquecen pero NO bloquean el informe.
--
-- Componentes:
--   1. marts.f_ultimo_periodo_publicable(): EEFF completo para al menos
--      4 de los 5 grupos regulados (bancos/cmac/crac/edpyme/financiera).
--      Threshold 4/5 tolera 1 grupo con lag SBS sin bloquear.
--   2. marts.f_ultimo_periodo_completeness_status(periodo): devuelve
--      un JSONB con detalle de que topicos estan publicados vs pendientes,
--      util para mostrar tooltip/badge en la UI ("Datos secundarios
--      pendientes: castigos, tasas").
--   3. La funcion vieja f_ultimo_periodo_completo() queda como
--      f_ultimo_periodo_full_completo() (todos-los-topicos) por si se
--      necesita en algun caso conservador.
-- =========================================================================


-- ============ 1. Renombrar la funcion antigua (backward compat) ============
-- Mantener el comportamiento anterior disponible bajo un nombre nuevo.
CREATE OR REPLACE FUNCTION marts.f_ultimo_periodo_full_completo()
RETURNS INT
LANGUAGE sql
STABLE
AS $$
    -- Version conservadora: exige TODOS los topicos publicados sin ningun
    -- 'no_publicado_sbs'. Usar solo cuando la ausencia de topicos
    -- secundarios (castigos, tasas) invalide la vista.
    WITH periodos_incompletos AS (
        SELECT DISTINCT periodo
        FROM raw.archivos_descargados
        WHERE status = 'no_publicado_sbs'
    ),
    periodos_disponibles AS (
        SELECT DISTINCT periodo
        FROM marts.mv_eeff_resultados_ancho
        WHERE periodo NOT IN (SELECT periodo FROM periodos_incompletos)
    )
    SELECT COALESCE(
        (SELECT MAX(periodo) FROM periodos_disponibles),
        (SELECT MAX(periodo) FROM marts.mv_eeff_resultados_ancho)
    );
$$;

COMMENT ON FUNCTION marts.f_ultimo_periodo_full_completo IS
    'Version conservadora (V129 original): ultimo periodo con TODOS los '
    'topicos publicados sin ningun no_publicado_sbs. Renombrado en V139 '
    'para dar paso a f_ultimo_periodo_publicable() como default.';


-- ============ 2. Nueva funcion default (prioridad EEFF) ============
CREATE OR REPLACE FUNCTION marts.f_ultimo_periodo_publicable()
RETURNS INT
LANGUAGE sql
STABLE
AS $$
    -- Regla de oro V139: el ultimo cierre publicable es el mes mas
    -- reciente donde:
    --   1. EEFF esta procesado para al menos 4 de los 5 grupos regulados
    --      (bancos, cmac, crac, edpyme, financiera). Threshold 4/5 tolera
    --      un grupo con lag SBS sin bloquear el informe.
    --   2. Y el periodo existe en mv_eeff_resultados_ancho (garantiza
    --      que los KPIs anualizados TTM se puedan calcular).
    --
    -- Los topicos secundarios (castigos, tasas, geo, indicadores) no
    -- bloquean. Su estado se puede consultar con
    -- f_ultimo_periodo_completeness_status(periodo) para mostrar aviso.
    WITH eeff_por_periodo AS (
        SELECT periodo, COUNT(DISTINCT grupo) AS n_grupos_eeff
        FROM raw.archivos_descargados
        WHERE topico = 'eeff' AND status = 'procesado'
        GROUP BY periodo
    ),
    candidatos AS (
        SELECT e.periodo
        FROM eeff_por_periodo e
        WHERE e.n_grupos_eeff >= 4
          AND EXISTS (
              SELECT 1 FROM marts.mv_eeff_resultados_ancho m
              WHERE m.periodo = e.periodo
          )
    )
    SELECT COALESCE(
        (SELECT MAX(periodo) FROM candidatos),
        -- Fallback: si por algun motivo raw.archivos_descargados esta
        -- vacio (test env, fresh install), cae al MAX de la MV.
        (SELECT MAX(periodo) FROM marts.mv_eeff_resultados_ancho)
    );
$$;

COMMENT ON FUNCTION marts.f_ultimo_periodo_publicable IS
    'REGLA DE ORO V139: ultimo periodo con EEFF procesado para >=4/5 grupos. '
    'Es el default del /dashboard/informe. Prioriza time-to-insight — no '
    'espera a que SBS publique reportes secundarios (castigos, tasas). '
    'Ver f_ultimo_periodo_completeness_status(periodo) para status detallado.';


-- ============ 3. Metadata detallada para tooltip UI ============
CREATE OR REPLACE FUNCTION marts.f_ultimo_periodo_completeness_status(_periodo INT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    -- Devuelve JSONB con:
    --   periodo             INT
    --   eeff_completo       BOOLEAN     — 5/5 grupos EEFF procesados
    --   topicos_completos   TEXT[]      — topicos con TODOS los grupos OK
    --   topicos_parciales   TEXT[]      — topicos con al menos un no_publicado_sbs
    --   topicos_faltantes   TEXT[]      — topicos sin ningun archivo procesado
    --   grupos_eeff_ok      INT         — cuantos grupos tienen EEFF (max 5)
    WITH agregado AS (
        SELECT topico,
               COUNT(*) FILTER (WHERE status = 'procesado')::int AS ok,
               COUNT(*) FILTER (WHERE status = 'no_publicado_sbs')::int AS pendientes,
               COUNT(*)::int AS total
        FROM raw.archivos_descargados
        WHERE periodo = _periodo
        GROUP BY topico
    )
    SELECT jsonb_build_object(
        'periodo', _periodo,
        'eeff_completo',
            COALESCE((SELECT ok >= 5 FROM agregado WHERE topico = 'eeff'), false),
        'grupos_eeff_ok',
            COALESCE((SELECT ok FROM agregado WHERE topico = 'eeff'), 0),
        'topicos_completos',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado WHERE ok = total AND ok > 0), ARRAY[]::text[]),
        'topicos_parciales',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado WHERE pendientes > 0 AND ok > 0), ARRAY[]::text[]),
        'topicos_faltantes',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado WHERE ok = 0), ARRAY[]::text[])
    );
$$;

COMMENT ON FUNCTION marts.f_ultimo_periodo_completeness_status IS
    'Detalle de que topicos estan completos/parciales/faltantes en un '
    'periodo. Consumir desde /dashboard/informe para mostrar tooltip '
    'del selector de periodo cuando hay topicos con publicacion parcial.';
