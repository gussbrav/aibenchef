-- =========================================================================
-- V016: dw.cabecera_maestra — replica el approach de la macro Excel de Gus.
--
-- El usuario tenia un proceso historico en Caja Arequipa donde:
--   1. Mantenia una cabecera maestra fija en columna A de un Excel
--   2. Cargaba el archivo SBS descargado en columnas B+
--   3. Una macro alineaba ambas cabeceras INSERTANDO FILAS donde habia
--      diferencias estructurales
--   4. El resultado era un archivo donde la posicion N de cualquier grupo
--      corresponde a la MISMA cuenta semantica
--
-- Esto es mucho mas robusto que el matching por nombre + fuzzy + aliases
-- que tengo hoy (frágil con renames sutiles de SBS).
--
-- Estructura:
--   - 1 fila por (tipo_estado, tipo_entidad, orden, periodo_vigencia)
--   - orden = numero de fila en la cabecera (1-based)
--   - codigo = el canonico (A1, A1.1, etc.)
--   - nombre = como aparece literal en el archivo SBS de ese grupo
--
-- Versionado: cuando SBS publique una cuenta nueva, agregar fila con
-- valido_desde = primer YYYYMM en que aparece. La fila vieja en esa
-- posicion se cierra con valido_hasta = YYYYMM - 1.
-- =========================================================================

CREATE TABLE IF NOT EXISTS dw.cabecera_maestra (
    tipo_estado    TEXT NOT NULL CHECK (tipo_estado IN ('balance', 'resultados')),
    tipo_entidad   TEXT NOT NULL CHECK (tipo_entidad IN
                       ('BANCOS', 'FINANCIERAS', 'CMAC', 'CRAC', 'EDPYMES')),
    orden          INT  NOT NULL,
    codigo         TEXT NOT NULL,
    nombre         TEXT NOT NULL,
    nivel          INT  NOT NULL DEFAULT 0,    -- 1/2/3 (jerarquia)
    es_header      BOOLEAN NOT NULL DEFAULT FALSE,
    es_total       BOOLEAN NOT NULL DEFAULT FALSE,
    es_seccion     BOOLEAN NOT NULL DEFAULT FALSE,
    valido_desde   INT  NOT NULL DEFAULT 200801,
    valido_hasta   INT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tipo_estado, tipo_entidad, orden, valido_desde)
);

CREATE INDEX IF NOT EXISTS idx_cabecera_maestra_codigo
    ON dw.cabecera_maestra (tipo_estado, tipo_entidad, codigo);
CREATE INDEX IF NOT EXISTS idx_cabecera_maestra_vigente
    ON dw.cabecera_maestra (tipo_estado, tipo_entidad)
    WHERE valido_hasta IS NULL;

COMMENT ON TABLE dw.cabecera_maestra IS
    'Plantilla maestra que replica el approach historico de Gus: una cabecera '
    'canonica por (tipo_estado, tipo_entidad) que define la estructura '
    'esperada de los archivos SBS mensuales. El importer matchea por '
    'POSICION (orden), no por nombre — robusto ante renames sutiles de SBS.';

-- =========================================================================
-- Funcion helper: dado un nombre + posicion en un archivo SBS, devuelve el
-- codigo canonico. Se usa para matching robusto desde el importer.
-- =========================================================================
CREATE OR REPLACE FUNCTION dw.lookup_codigo_por_orden(
    p_tipo_estado  TEXT,
    p_tipo_entidad TEXT,
    p_orden        INT,
    p_periodo      INT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_codigo TEXT;
BEGIN
    SELECT codigo INTO v_codigo
    FROM dw.cabecera_maestra
    WHERE tipo_estado  = p_tipo_estado
      AND tipo_entidad = p_tipo_entidad
      AND orden        = p_orden
      AND valido_desde <= p_periodo
      AND (valido_hasta IS NULL OR valido_hasta >= p_periodo)
    ORDER BY valido_desde DESC
    LIMIT 1;
    RETURN v_codigo;
END;
$$;

COMMENT ON FUNCTION dw.lookup_codigo_por_orden(TEXT, TEXT, INT, INT) IS
    'Resuelve codigo canonico segun (tipo_estado, tipo_entidad, orden) y '
    'periodo de vigencia. Reemplaza el matching por nombre + fuzzy del '
    'MonthlyEeffImporter por una busqueda exacta por posicion.';
