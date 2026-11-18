-- =========================================================================
-- V219: Agregar check_type 'fila_sin_match_cabecera' a admin.data_quality_checks
--
-- CONTEXTO
--   El bug COOPAC Sep 2026 reveló que los imports pueden procesar silenciosa-
--   mente filas del XLS que NO matchean ningún código en dw.cabecera_maestra.
--   Antes del hardening del parser, el fallback posicional silencioso asignaba
--   códigos incorrectos. Después del hardening (parser COOPAC post-fix),
--   esas filas quedan con codigo=NULL y emiten WARN structlog.
--
--   Pero los logs structlog son volátiles y no sirven para gobernanza:
--   no se pueden listar, no están en un dashboard, no generan alertas,
--   nadie los revisa periódicamente.
--
-- OBJETIVO
--   Persistir las filas sin match en admin.data_quality_checks con check_type
--   nuevo 'fila_sin_match_cabecera'. Eso las hace:
--     - Visibles en /dashboard/admin/data-quality
--     - Listables vía SQL para auditoría
--     - Sujetas al auto-resolve pattern (si re-import corrige, se marca resuelto)
--     - Trazables por carga_log_id para saber qué run las detectó
--
-- DISEÑO
--   Reusamos admin.data_quality_checks en lugar de crear una tabla separada:
--     - 1 fila por (periodo, tipo_entidad, tipo_estado, sheet) con count + payload
--     - nomb_correg = '__SHEET__' (convención para checks a nivel de sheet,
--       no por entidad individual)
--     - payload JSONB contiene: {sheet, source_file, tipo_estado, muestra, count}
--     - status = 'warning' si count ≤ 5, 'critical' si count > 5
--
--   Alternativa descartada: tabla separada admin.import_unmatched_rows.
--   Motivos: (a) duplica infra de auto-resolve, (b) el dashboard ya lee
--   data_quality_checks, (c) menos tablas = menos mantenimiento.
--
-- IDEMPOTENCIA
--   DROP + ADD del constraint es atómico dentro de una transacción.
-- =========================================================================

BEGIN;

ALTER TABLE admin.data_quality_checks
    DROP CONSTRAINT data_quality_checks_check_type_check;

ALTER TABLE admin.data_quality_checks
    ADD CONSTRAINT data_quality_checks_check_type_check
    CHECK (check_type = ANY (ARRAY[
        'balance_contable',
        'outlier_zscore',
        'suma_subcuentas',
        'fila_sin_match_cabecera'
    ]));

COMMENT ON COLUMN admin.data_quality_checks.check_type IS
    'Tipo de chequeo: balance_contable (A=P+PATR), outlier_zscore (desvío vs 11m), '
    'suma_subcuentas (padre=SUM(hijos)), fila_sin_match_cabecera (XLS trae filas '
    'desconocidas por dw.cabecera_maestra — V219).';

COMMIT;
