-- =========================================================================
-- V014: dw.dim_entidad + dw.entidad_alias + funcion normalizar_entidad()
--
-- Problema observado:
--   La SBS publica el mismo nombre de entidad con variantes (asteriscos,
--   superindices, sufijos "1/", "2/" como referencia a notas al pie):
--     Citibank, Citibank***, Citibank 1/, Citibank¹
--   Y ademas hay renombres legales (Banco Azteca renombrado a Banco Alfin
--   en 2024).
--
-- Solucion:
--   1. dw.dim_entidad: catalogo canonico de entidades (1 fila por entidad)
--   2. dw.entidad_alias: mapeo alias -> nombre_canonico (1 fila por variante)
--   3. dw.normalizar_entidad(text): funcion que devuelve nombre canonico,
--      aplicando primero alias y despues normalization heuristica
--      (asteriscos, superindices, sufijos N/).
--
-- El importer hace lookup de cada nombre en la funcion antes de guardar
-- en raw.eeff_observacion.
-- =========================================================================

-- ============================================================
-- Tabla principal: dim_entidad
-- ============================================================
CREATE TABLE IF NOT EXISTS dw.dim_entidad (
    nomb_correg     TEXT PRIMARY KEY,           -- nombre canonico
    tipo_entidad    TEXT NOT NULL CHECK (tipo_entidad IN
                       ('BANCOS', 'FINANCIERAS', 'CMAC', 'CRAC', 'EDPYMES')),
    empresa_sbs     TEXT,                       -- nombre legal completo
    codigo_sbs      TEXT,                       -- codigo regulatorio si existe
    microfinanciera BOOLEAN NOT NULL DEFAULT FALSE,
    nacional        TEXT,                       -- LOCAL / EXTRANJERO / ...
    es_total        BOOLEAN NOT NULL DEFAULT FALSE,
                                                -- true para "TOTAL Banca Multiple",
                                                -- "TOTAL Servicios Financieros", etc.
                                                -- Estas se excluyen del selector.
    es_sucursal     BOOLEAN NOT NULL DEFAULT FALSE,
                                                -- true para sub-vistas como
                                                -- "Banco de Credito - Sucursales".
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_baja      DATE,                       -- cuando dejo de operar (si activa=false)
    fecha_renombre  DATE,                       -- cuando cambio de nombre
    nombre_anterior TEXT,                       -- ej "Banco Azteca" antes de Alfin
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dim_entidad_tipo
    ON dw.dim_entidad (tipo_entidad);
CREATE INDEX IF NOT EXISTS idx_dim_entidad_activa
    ON dw.dim_entidad (activa) WHERE activa = TRUE;
CREATE INDEX IF NOT EXISTS idx_dim_entidad_total
    ON dw.dim_entidad (es_total);

COMMENT ON TABLE dw.dim_entidad IS
    'Catalogo canonico de entidades del sistema financiero peruano. Filtros '
    'es_total/es_sucursal/activa permiten al UI ocultar agregados, sub-vistas, '
    'o entidades cerradas.';

-- ============================================================
-- Tabla de aliases (variantes que SBS publica)
-- ============================================================
CREATE TABLE IF NOT EXISTS dw.entidad_alias (
    alias           TEXT PRIMARY KEY,           -- exactamente como aparece en SBS
    nomb_correg     TEXT NOT NULL REFERENCES dw.dim_entidad (nomb_correg)
                       ON UPDATE CASCADE ON DELETE CASCADE,
    fuente          TEXT NOT NULL DEFAULT 'manual',
                                                -- 'manual' / 'sbs_eeff' / 'sbs_indicadores'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entidad_alias_canonico
    ON dw.entidad_alias (nomb_correg);

COMMENT ON TABLE dw.entidad_alias IS
    'Mapeo de variantes/aliases del nombre de entidad al canonico. Captura '
    'casos como "Citibank***" -> "Citibank", "Banco Azteca" -> "Banco Alfin".';

-- ============================================================
-- Funcion normalizadora: aplica alias + heuristica
-- ============================================================
CREATE OR REPLACE FUNCTION dw.normalizar_entidad(input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    canonico TEXT;
    cleaned  TEXT;
BEGIN
    IF input IS NULL OR TRIM(input) = '' THEN
        RETURN NULL;
    END IF;

    -- 1. Lookup exacto en alias (case-sensitive, mas confiable)
    SELECT nomb_correg INTO canonico
    FROM dw.entidad_alias
    WHERE alias = input;
    IF canonico IS NOT NULL THEN
        RETURN canonico;
    END IF;

    -- 2. Heuristica de limpieza: quitar asteriscos, superindices, sufijos N/
    cleaned := TRIM(input);
    -- Quitar asteriscos finales (***)
    cleaned := REGEXP_REPLACE(cleaned, '\*+$', '');
    -- Quitar superindices Unicode al final (¹²³⁴⁵⁶⁷⁸⁹⁰)
    cleaned := REGEXP_REPLACE(cleaned, '[¹²³⁰-⁹]+$', '');
    -- Quitar sufijos " N/" o "N/" donde N es 1-3 digitos
    cleaned := REGEXP_REPLACE(cleaned, '\s*\d{1,3}/\s*$', '');
    cleaned := TRIM(cleaned);

    -- 3. Lookup del cleaned en alias por si esa version mas limpia esta mapeada
    SELECT nomb_correg INTO canonico
    FROM dw.entidad_alias
    WHERE alias = cleaned;
    IF canonico IS NOT NULL THEN
        RETURN canonico;
    END IF;

    -- 4. Si la version limpia matchea exactamente un nomb_correg canonico, usarla
    IF EXISTS (SELECT 1 FROM dw.dim_entidad WHERE nomb_correg = cleaned) THEN
        RETURN cleaned;
    END IF;

    -- 5. Fallback: devolver la version limpia (no esta en catalogo pero al menos
    --    normalizada). Se loggea para revisar manualmente.
    RETURN cleaned;
END;
$$;

COMMENT ON FUNCTION dw.normalizar_entidad(TEXT) IS
    'Normaliza nombre de entidad SBS: aplica alias + heuristica '
    '(asteriscos/superindices/sufijos N/). Usar antes de insertar en raw o '
    'al consultar joins por nombre.';

-- ============================================================
-- Backfill inicial: poblar dim_entidad con los nomb_correg actuales
-- en raw.eeff_observacion, deduplicando por nombre normalizado.
-- ============================================================
INSERT INTO dw.dim_entidad (nomb_correg, tipo_entidad, empresa_sbs, microfinanciera, nacional, es_total)
SELECT
    -- Aplicar normalizacion basica (sin alias todavia, eso lo hara el seed)
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(nomb_correg, '\*+$', ''), '\s*\d{1,3}/\s*$', '')) AS nomb_correg_norm,
    COALESCE(MAX(tipo_entidad), 'BANCOS')   AS tipo_entidad_norm,
    MAX(empresa_sbs)                        AS empresa_sbs_norm,
    COALESCE(BOOL_OR(microfinanciera = 'SI'), FALSE) AS microfinanciera_norm,
    MAX(nacional)                           AS nacional_norm,
    -- es_total = true si el nombre comienza con TOTAL
    COALESCE(BOOL_OR(UPPER(nomb_correg) LIKE 'TOTAL %'), FALSE) AS es_total_norm
FROM raw.eeff_observacion
WHERE nomb_correg IS NOT NULL
GROUP BY 1
ON CONFLICT (nomb_correg) DO NOTHING;

-- Para los renombres conocidos, marcar es_sucursal en los que tengan "- Sucursales"
UPDATE dw.dim_entidad
SET es_sucursal = TRUE
WHERE nomb_correg LIKE '%- Sucursales%'
   OR nomb_correg LIKE '% Sucursales';
