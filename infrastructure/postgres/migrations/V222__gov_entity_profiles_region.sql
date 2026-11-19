-- V222__gov_entity_profiles_region.sql
-- Agrega columna `region` normalizada a gov.entity_profiles.
--
-- Por que: el `ubicacion` es texto libre ("Arequipa, Peru", "Lima" o cualquier
-- variante) y no se puede usar como join key para calcular promedios regionales.
-- Esta columna normaliza al nombre del departamento (Arequipa, Lima, Cusco,
-- La Libertad, Puno, etc.) o 'nacional' si la entidad no tiene foco regional.
--
-- Se usa para: enrichment del punto-equilibrio calcula promedios de mora/ROE
-- filtrados por tipo_entidad + region, para que el analisis compare la
-- entidad propia contra sus pares REGIONALES (mas apples-to-apples) en vez
-- de contra todas las COOPAC del universo.

ALTER TABLE gov.entity_profiles
    ADD COLUMN IF NOT EXISTS region TEXT;

COMMENT ON COLUMN gov.entity_profiles.region IS
    'Departamento peruano normalizado (Arequipa, Lima, Cusco, La Libertad, Piura, etc) o "nacional". Permite calcular promedios regionales al comparar entidades. Derivado del `ubicacion` + research.';

CREATE INDEX IF NOT EXISTS idx_entity_profiles_region
    ON gov.entity_profiles (region)
 WHERE region IS NOT NULL;
