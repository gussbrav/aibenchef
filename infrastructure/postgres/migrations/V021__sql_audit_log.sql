-- =========================================================================
-- V021: app.sql_audit_log — registro de cada query ejecutada en el Workbench
--
-- Cumplimiento + observabilidad: para investigaciones de seguridad y
-- analisis de patrones de uso, registramos QUIEN ejecuto QUE query CUANDO
-- y cuanto tardo.
--
-- NO registramos los resultados (PII potencial). Solo el SQL text.
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.sql_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sql_text    TEXT NOT NULL,
    sql_hash    TEXT NOT NULL,            -- sha256 hex truncado a 16 chars
    duracion_ms INT,
    filas       INT,
    truncado    BOOLEAN,
    exitoso     BOOLEAN NOT NULL,
    error_msg   TEXT,
    ip          INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sql_audit_log_user
    ON app.sql_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sql_audit_log_hash
    ON app.sql_audit_log (sql_hash);
CREATE INDEX IF NOT EXISTS idx_sql_audit_log_created
    ON app.sql_audit_log (created_at DESC);

-- Retencion: rotar > 90 dias via cron job (no se hace aqui, queda como tarea)
COMMENT ON TABLE app.sql_audit_log IS
    'Audit log de queries ejecutadas en SQL Workbench. Retencion sugerida '
    '90 dias. No incluye resultados, solo el texto SQL.';
