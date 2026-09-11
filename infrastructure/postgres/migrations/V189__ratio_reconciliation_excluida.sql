-- =========================================================================
-- V189 — Exclusion de entidades en reconciliacion de ratios
--
-- Problema: entidades en liquidacion (ej. CRAC del Centro) publican 0
-- en todos sus indicadores SBS mientras nuestro calculo refleja la
-- realidad negativa → falso CRITICO que contamina el accuracy summary.
--
-- Solucion: columnas excluida + motivo_exclusion en ratio_reconciliation.
-- - Las filas excluidas aparecen en v_ratio_divergences con severidad
--   'excluida' para auditabilidad (nunca desaparecen del historial).
-- - La funcion reconcile_ratios NO modifica estas columnas (no estan en
--   el INSERT ni en el ON CONFLICT SET → se preservan automaticamente).
-- - v_ratio_reconciliation_summary filtra AND NOT r.excluida para que
--   el semaforo de accuracy refleje solo entidades activas.
--
-- Seed inicial: CRAC del Centro (liquidacion confirmada, Portal SBS).
-- =========================================================================

ALTER TABLE gov.ratio_reconciliation
    ADD COLUMN IF NOT EXISTS excluida         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS motivo_exclusion TEXT
        CHECK (motivo_exclusion IS NULL OR motivo_exclusion IN (
            'liquidacion', 'intervencion_sbs', 'fusion_absorcion',
            'metodologia_diferente', 'otro'
        ));

COMMENT ON COLUMN gov.ratio_reconciliation.excluida IS
    'Excluye la entidad del accuracy summary y marca severidad ''excluida'' '
    'en la vista. No afecta la UX del usuario final. Solo admin puede '
    'modificar via /api/v1/admin/reconciliacion/excluir.';

COMMENT ON COLUMN gov.ratio_reconciliation.motivo_exclusion IS
    'Razon de exclusion (enum): liquidacion, intervencion_sbs, '
    'fusion_absorcion, metodologia_diferente, otro. NULL cuando excluida=false.';

CREATE INDEX IF NOT EXISTS idx_ratio_reconciliation_excluida
    ON gov.ratio_reconciliation (excluida)
    WHERE excluida = true;

-- Recrear vista: DROP + CREATE porque CREATE OR REPLACE VIEW no permite
-- insertar columnas nuevas antes de columnas existentes (error 42P16).
-- Nada depende de esta vista por lo que el DROP es seguro.
DROP VIEW IF EXISTS gov.v_ratio_divergences;
CREATE VIEW gov.v_ratio_divergences AS
SELECT
    r.periodo,
    r.nomb_correg,
    r.indicador,
    r.derived_value,
    r.sbs_value,
    r.delta_bps,
    ABS(r.delta_bps)    AS abs_delta_bps,
    r.sbs_seen_at,
    r.last_reconciled_at,
    r.notas,
    r.excluida,
    r.motivo_exclusion,
    CASE
        WHEN r.excluida             THEN 'excluida'
        WHEN ABS(r.delta_bps) > 50 THEN 'critico'
        WHEN ABS(r.delta_bps) > 20 THEN 'alto'
        WHEN ABS(r.delta_bps) > 5  THEN 'leve'
        ELSE 'ok'
    END AS severidad
  FROM gov.ratio_reconciliation r
 WHERE r.sbs_value IS NOT NULL
   AND r.derived_value IS NOT NULL
   AND ABS(r.delta_bps) > 5
 ORDER BY r.excluida ASC, r.periodo DESC, ABS(r.delta_bps) DESC;

COMMENT ON VIEW gov.v_ratio_divergences IS
    'V189: agrega excluida + motivo_exclusion + severidad ''excluida''. '
    'Excluidas flotan al fondo (ORDER BY excluida ASC). El badge admin '
    'ya filtra severidad IN (''alto'',''critico'') por lo que excluidas '
    'no cuentan sin tocar ese query.';

-- Recrear summary: excluye entidades en liquidacion/intervencion para
-- que el semaforo de accuracy no se vea distorsionado por ceros SBS.
CREATE OR REPLACE VIEW gov.v_ratio_reconciliation_summary AS
WITH ultimos AS (
    SELECT DISTINCT periodo
      FROM gov.ratio_reconciliation
     ORDER BY periodo DESC
     LIMIT 12
),
base AS (
    SELECT
        r.indicador,
        COUNT(*) FILTER (
            WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL
        ) AS reconciled,
        COUNT(*) FILTER (
            WHERE sbs_value IS NOT NULL
              AND derived_value IS NOT NULL
              AND ABS(delta_bps) <= 5
        ) AS within_tol,
        AVG(ABS(delta_bps)) FILTER (
            WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL
        ) AS avg_abs_delta_bps,
        MAX(ABS(delta_bps)) FILTER (
            WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL
        ) AS max_abs_delta_bps
      FROM gov.ratio_reconciliation r
     WHERE r.periodo IN (SELECT periodo FROM ultimos)
       AND NOT r.excluida
     GROUP BY r.indicador
)
SELECT
    indicador,
    reconciled,
    within_tol,
    CASE WHEN reconciled = 0 THEN NULL
         ELSE ROUND(within_tol::numeric / reconciled * 100, 2)
    END AS accuracy_pct,
    ROUND(avg_abs_delta_bps, 2) AS avg_abs_delta_bps,
    max_abs_delta_bps
  FROM base
 ORDER BY indicador;

COMMENT ON VIEW gov.v_ratio_reconciliation_summary IS
    'V189: AND NOT r.excluida en el WHERE — entidades en liquidacion '
    'no contaminan el accuracy %. Solo refleja el sistema financiero activo.';

-- Seed: CRAC del Centro en liquidacion (confirmado Portal SBS sep-2026)
UPDATE gov.ratio_reconciliation
   SET excluida         = true,
       motivo_exclusion = 'liquidacion'
 WHERE nomb_correg = 'CRAC del Centro';
