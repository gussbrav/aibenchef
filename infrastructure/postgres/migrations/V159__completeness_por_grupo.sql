-- =========================================================================
-- V159 — Detalle por-grupo en f_ultimo_periodo_completeness_status
--
-- CONTEXTO: la V139 devolvia solo la lista de TOPICOS con publicacion
-- parcial, sin decir CUAL grupo (bancos/financieras/cmac/crac/edpyme)
-- estaba faltando. En el badge del /informe el usuario veia "Indicadores
-- Prudenciales: parcial" y no podia entender de un vistazo si esperar
-- (SBS todavia no publica) o accionar (bug del downloader).
--
-- V159 agrega el campo `topicos_parciales_detalle` — un array de objetos
-- {topico, grupos_faltantes, dias_atraso_max} — asi el UI puede mostrar
-- "Indicadores Prudenciales · falta CRAC (58 dias), EDPYME (58 dias)"
-- y el usuario entiende inmediatamente que hay un problema real vs
-- que hay que esperar a SBS.
-- =========================================================================

CREATE OR REPLACE FUNCTION marts.f_ultimo_periodo_completeness_status(_periodo INT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    WITH agregado_por_topico AS (
        SELECT topico,
               COUNT(*) FILTER (WHERE status = 'procesado')::int AS ok,
               COUNT(*) FILTER (WHERE status = 'no_publicado_sbs')::int AS pendientes,
               COUNT(*)::int AS total
        FROM raw.archivos_descargados
        WHERE periodo = _periodo
        GROUP BY topico
    ),
    detalle_parciales AS (
        -- Para cada topico parcial, expone los grupos individuales
        -- faltantes con dias de atraso (vs el cierre_mes del periodo).
        -- El UI puede leer este detalle para mostrar "falta X (N dias)".
        SELECT
            a.topico,
            jsonb_build_object(
                'topico', a.topico,
                'grupos_faltantes',
                    COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'grupo', ad.grupo,
                            'status', ad.status,
                            'actualizado_en', ad.actualizado_en,
                            'dias_desde_cierre',
                                (CURRENT_DATE - (make_date(_periodo/100, _periodo%100, 1)
                                    + INTERVAL '1 month' - INTERVAL '1 day')::date)
                        ) ORDER BY ad.grupo)
                        FROM raw.archivos_descargados ad
                        WHERE ad.periodo = _periodo
                          AND ad.topico = a.topico
                          AND ad.status <> 'procesado'
                    ), '[]'::jsonb)
            ) AS detalle
        FROM agregado_por_topico a
        WHERE a.pendientes > 0 AND a.ok > 0
    )
    SELECT jsonb_build_object(
        'periodo', _periodo,
        'eeff_completo',
            COALESCE((SELECT ok >= 5 FROM agregado_por_topico WHERE topico = 'eeff'), false),
        'grupos_eeff_ok',
            COALESCE((SELECT ok FROM agregado_por_topico WHERE topico = 'eeff'), 0),
        'topicos_completos',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado_por_topico WHERE ok = total AND ok > 0), ARRAY[]::text[]),
        'topicos_parciales',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado_por_topico WHERE pendientes > 0 AND ok > 0), ARRAY[]::text[]),
        'topicos_faltantes',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado_por_topico WHERE ok = 0), ARRAY[]::text[]),
        -- NUEVO en V159: array de objetos con detalle por-grupo de los
        -- topicos parciales, para que el UI pueda mostrar "falta CRAC (58 dias)".
        'topicos_parciales_detalle',
            COALESCE((SELECT jsonb_agg(detalle ORDER BY topico) FROM detalle_parciales), '[]'::jsonb)
    );
$$;

COMMENT ON FUNCTION marts.f_ultimo_periodo_completeness_status IS
    'V159: agrega topicos_parciales_detalle con grupos individuales faltantes '
    'y dias desde cierre. Permite al UI del /informe mostrar mensaje '
    'accionable ("falta CRAC 58 dias") en vez del generico ("indicadores '
    'parcial") — user entiende si esperar o si hay bug del downloader.';
