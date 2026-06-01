-- =========================================================================
-- V126: Participacion en Sistema Financiero (SF) — denominador = todas las
-- entidades reguladas, no solo microfinancieras.
--
-- ROOT CAUSE:
--   V063 creo v_participacion_smf_* con denominador = sum(microfinancieras).
--   Cuando el benchmark incluye un Banco (ej BCP) el ratio sale 0% porque
--   BCP no es SMF. El usuario espera ver el % participacion en el SF
--   completo, no solo en el SMF.
--
-- FIX:
--   Crear las vistas paralelas v_participacion_sf_colocaciones y
--   v_participacion_sf_depositos cuyo denominador es la suma sobre TODAS
--   las entidades (Bancos + Financieras + CMAC + CRAC + Empresas de
--   Creditos), sin filtrar por es_microfinanciera.
--
--   Mantenemos v_participacion_smf_* tal como estan — ambas siguen siendo
--   utiles: SF responde "que tan grande sos en el sistema completo" y SMF
--   responde "que tan grande sos dentro del nicho microfinanciero".
--
-- IMPLICANCIA:
--   - Para un Banco: %_SF tendra valor (>0), %_SMF sera 0.
--   - Para una Caja Municipal: %_SF y %_SMF tendran ambos valor.
--   - El front muestra ambas filas con tooltip explicando la diferencia.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_participacion_sf_colocaciones AS
WITH base AS (
    SELECT periodo, nomb_correg, cartera_total
    FROM marts.v_colocaciones_total_por_entidad
),
totales AS (
    SELECT periodo, SUM(cartera_total) AS total_sf
    FROM base
    GROUP BY periodo
)
SELECT
    b.periodo,
    b.nomb_correg,
    CASE
        WHEN t.total_sf > 0
        THEN ROUND((b.cartera_total / t.total_sf)::numeric, 6)
        ELSE NULL
    END AS pct_participacion_sf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;

COMMENT ON VIEW marts.v_participacion_sf_colocaciones IS
    'Para cada (periodo, entidad) el % de participacion sobre el total de '
    'cartera del Sistema Financiero (denominador = TODAS las entidades, '
    'no solo SMF). Complementaria de v_participacion_smf_colocaciones.';

CREATE OR REPLACE VIEW marts.v_participacion_sf_depositos AS
WITH base AS (
    SELECT periodo, nomb_correg, depositos_total
    FROM marts.v_depositos_total_por_entidad
),
totales AS (
    SELECT periodo, SUM(depositos_total) AS total_sf
    FROM base
    GROUP BY periodo
)
SELECT
    b.periodo,
    b.nomb_correg,
    CASE
        WHEN t.total_sf > 0
        THEN ROUND((b.depositos_total / t.total_sf)::numeric, 6)
        ELSE NULL
    END AS pct_participacion_sf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;

COMMENT ON VIEW marts.v_participacion_sf_depositos IS
    'Para cada (periodo, entidad) el % de participacion sobre el total de '
    'depositos del Sistema Financiero. Complementaria de '
    'v_participacion_smf_depositos.';

-- Versiones historicas (mismo patron que SMF *_historica): se usan cuando
-- el frontend pasa consolidar=false, asi muestran data por nombre vigente
-- en cada periodo en lugar de canonizado.
CREATE OR REPLACE VIEW marts.v_participacion_sf_coloc_historica AS
SELECT * FROM marts.v_participacion_sf_colocaciones;

CREATE OR REPLACE VIEW marts.v_participacion_sf_dep_historica AS
SELECT * FROM marts.v_participacion_sf_depositos;

COMMENT ON VIEW marts.v_participacion_sf_coloc_historica IS
    'Alias historico de v_participacion_sf_colocaciones — el denominador SF '
    'es identico ya canonizado o no, asi que no requiere recalculo separado.';
