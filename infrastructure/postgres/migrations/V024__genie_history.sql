-- =========================================================================
-- V024: app.genie_history — audit de prompts y SQL generado por Claude
--
-- Para entender que pregunta el usuario, evaluar calidad del NL2SQL,
-- detectar prompts problematicos, y mejorar el prompt master a lo largo
-- del tiempo.
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.genie_history (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt          TEXT NOT NULL,
    sql_generado    TEXT,
    explicacion     TEXT,
    modelo          TEXT,                  -- ej claude-opus-4-6
    tokens_input    INT,
    tokens_output   INT,
    duracion_ms     INT,
    ejecutado       BOOLEAN NOT NULL DEFAULT FALSE,   -- si el usuario lo corrio
    exitoso         BOOLEAN,                          -- resultado de la ejecucion
    error           TEXT,
    feedback        SMALLINT,    -- 1 like, -1 dislike, NULL sin rating
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_genie_history_user
    ON app.genie_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_genie_history_feedback
    ON app.genie_history (feedback) WHERE feedback IS NOT NULL;

COMMENT ON TABLE app.genie_history IS
    'Historial de prompts NL2SQL. Sirve para auditoria, mejora del prompt '
    'master, y feedback loop con thumb up/down del usuario.';
