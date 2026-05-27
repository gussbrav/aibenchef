-- =========================================================================
-- V094: Vista marts.v_entidades_delta — detecta entidades nuevas o
-- desaparecidas comparando los últimos 2 periodos de raw.eeff_observacion.
--
-- Cierra G5 del audit de observabilidad (docs/design/pipeline-observability-v1.md).
-- Usado por /dashboard/admin/pipeline para alertar al operador cuando SBS
-- introduce una entidad financiera nueva (caso real: bancos digitales,
-- fintechs licenciadas) o cuando una entidad deja de publicar.
--
-- Output esperado:
--   periodo_actual | tipo_entidad | nomb_correg          | accion        | en_maestra
--   ---------------+--------------+----------------------+---------------+-----------
--   202604         | BANCOS       | Banco Falabella Perú | nueva         | false
--   202604         | FIN          | FIN Confianza         | desaparecida  | true
--
-- Casos detectados:
--   nueva        — presente en periodo N, ausente en N-1
--   desaparecida — presente en N-1, ausente en N (puede ser falsa alarma si
--                  SBS aún no publicó ese tópico para N)
--
-- "Canonizadas" (rename ya conocido por dw.entidad_maestra) NO aparecen
-- porque resolver_nomb_correg_canonico() las normaliza antes del INSERT.
-- Si aparecen es porque el rename NO está en dw.entidad_nombre — es la señal
-- de alarma que queremos.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_entidades_delta AS
WITH ultimos_dos_periodos AS (
    -- Tomamos los 2 periodos más recientes con data en eeff.
    -- LIMIT 2 después de DISTINCT para que sean los DOS más nuevos, no
    -- 2 filas cualquiera.
    SELECT DISTINCT periodo
    FROM raw.eeff_observacion
    ORDER BY periodo DESC
    LIMIT 2
),
poblacion AS (
    SELECT
        eo.periodo,
        eo.tipo_entidad,
        eo.nomb_correg
    FROM raw.eeff_observacion eo
    JOIN ultimos_dos_periodos u USING (periodo)
    GROUP BY eo.periodo, eo.tipo_entidad, eo.nomb_correg
),
periodo_actual AS (
    SELECT MAX(periodo) AS p FROM ultimos_dos_periodos
),
periodo_previo AS (
    SELECT MIN(periodo) AS p FROM ultimos_dos_periodos
),
actuales AS (
    SELECT p.tipo_entidad, p.nomb_correg
    FROM poblacion p, periodo_actual pa
    WHERE p.periodo = pa.p
),
previos AS (
    SELECT p.tipo_entidad, p.nomb_correg
    FROM poblacion p, periodo_previo pp
    WHERE p.periodo = pp.p
),
delta AS (
    SELECT
        COALESCE(a.tipo_entidad, p.tipo_entidad) AS tipo_entidad,
        COALESCE(a.nomb_correg,  p.nomb_correg)  AS nomb_correg,
        CASE
            WHEN a.nomb_correg IS NOT NULL AND p.nomb_correg IS NULL THEN 'nueva'
            WHEN a.nomb_correg IS NULL AND p.nomb_correg IS NOT NULL THEN 'desaparecida'
        END AS accion
    FROM actuales a
    FULL OUTER JOIN previos p
      ON a.nomb_correg  = p.nomb_correg
     AND a.tipo_entidad = p.tipo_entidad
    WHERE a.nomb_correg IS NULL OR p.nomb_correg IS NULL
)
SELECT
    (SELECT p FROM periodo_actual) AS periodo_actual,
    (SELECT p FROM periodo_previo) AS periodo_previo,
    d.tipo_entidad,
    d.nomb_correg,
    d.accion,
    -- ¿el nombre tiene entry en dw.entidad_nombre? Si sí, ya está mapeado
    -- a una entidad canónica conocida y no es alarma.
    EXISTS (
        SELECT 1 FROM dw.entidad_nombre en
        WHERE en.nombre = d.nomb_correg
    ) AS en_maestra
FROM delta d;

COMMENT ON VIEW marts.v_entidades_delta IS
    'Detecta entidades nuevas o desaparecidas comparando los últimos 2 periodos
     de raw.eeff_observacion. Una fila por entidad detectada con accion.
     en_maestra = TRUE indica que el nombre ya está mapeado en dw.entidad_nombre
     (no es alarma). Usado por /dashboard/admin/pipeline. Issue #18.';
