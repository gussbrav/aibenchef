-- =========================================================================
-- V048: dw.entidad_renombre + vista canonica para gestion de historial
--
-- Problema: las entidades cambian de nombre/tipo en el tiempo.
--   - "Financiera Compartamos" se convirtio en "Compartamos Banco" (Mar 2023)
--   - "Banco Azteca" se renombro a "Banco Alfin" (~2022)
--   - "Banco Continental" → "BBVA" (rebranding antiguo)
--
-- Si tratamos los nombres como atomicos, los reportes pierden continuidad
-- temporal (la columna "Mibanco" tiene data 2010-2026, pero "Compartamos"
-- aparece partida en 2 chunks).
--
-- Si los unificamos sin metadata, perdemos el rastro de CUANDO cambio.
--
-- Solucion: tabla dw.entidad_renombre con historial + vista canonica que
-- resuelve "el nombre actual" para cualquier nomb_correg historico.
-- Aplicable bajo demanda (parametro consolidar=true|false en el informe).
-- =========================================================================

-- ----------------------------------------------------------------------
-- Tabla principal: dw.entidad_renombre
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.entidad_renombre (
    id                      BIGSERIAL PRIMARY KEY,
    nomb_correg_anterior    TEXT NOT NULL,
    nomb_correg_actual      TEXT NOT NULL,
    fecha_cambio            DATE,
    periodo_cambio          INT,
    tipo_cambio             TEXT NOT NULL DEFAULT 'renombre'
                            CHECK (tipo_cambio IN ('renombre', 'fusion', 'conversion', 'spin_off', 'rebranding')),
    motivo                  TEXT,
    consolidar_por_default  BOOLEAN NOT NULL DEFAULT TRUE,
    activo                  BOOLEAN NOT NULL DEFAULT TRUE,
    fuente                  TEXT,
    notas                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nomb_correg_anterior, nomb_correg_actual)
);

CREATE INDEX IF NOT EXISTS idx_entidad_renombre_anterior
    ON dw.entidad_renombre (nomb_correg_anterior) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_entidad_renombre_actual
    ON dw.entidad_renombre (nomb_correg_actual) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_entidad_renombre_periodo
    ON dw.entidad_renombre (periodo_cambio);

COMMENT ON TABLE dw.entidad_renombre IS
    'Historial de renombres/fusiones/conversiones de entidades reguladas. '
    'Permite consolidar series temporales bajo el nombre actual sin perder '
    'el rastro de cuando ocurrio el cambio.';

COMMENT ON COLUMN dw.entidad_renombre.tipo_cambio IS
    'renombre: cambio cosmetico de nombre. '
    'fusion: 2+ entidades se unen en 1 (multiples filas anteriores -> 1 actual). '
    'conversion: cambio de tipo regulatorio (ej. Financiera -> Banco). '
    'spin_off: 1 entidad se parte en 2+ (1 anterior -> multiples actuales). '
    'rebranding: cambio de marca comercial, misma entidad legal.';

COMMENT ON COLUMN dw.entidad_renombre.consolidar_por_default IS
    'Si TRUE, las queries que pidan consolidar=true (default) trataran '
    'las series como continuas. Si FALSE, hay que pedir consolidar=true '
    'explicitamente (caso de entidades muy distintas que comparten nombre).';

-- ----------------------------------------------------------------------
-- Funcion recursiva: dado un nomb_correg historico, devuelve el actual
-- ----------------------------------------------------------------------
-- Aplica la cadena de renombres hasta que ya no hay siguiente:
--   "Financiera Compartamos" -> "Compartamos Banco" -> (no hay mas) -> "Compartamos Banco"
-- Con max_depth=10 para evitar loops infinitos.
CREATE OR REPLACE FUNCTION dw.resolver_nomb_correg_canonico(_raw TEXT)
RETURNS TEXT AS $$
DECLARE
    _current TEXT := _raw;
    _next TEXT;
    _depth INT := 0;
BEGIN
    IF _raw IS NULL OR _raw = '' THEN
        RETURN _raw;
    END IF;
    LOOP
        SELECT nomb_correg_actual INTO _next
        FROM dw.entidad_renombre
        WHERE nomb_correg_anterior = _current
          AND activo
          AND consolidar_por_default
        LIMIT 1;
        EXIT WHEN _next IS NULL OR _next = _current OR _depth >= 10;
        _current := _next;
        _depth := _depth + 1;
    END LOOP;
    RETURN _current;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION dw.resolver_nomb_correg_canonico IS
    'Resuelve un nomb_correg historico al nombre canonico actual aplicando '
    'la cadena de renombres consolidables. Si no hay renombre, devuelve el '
    'mismo input. Idempotente: f(f(x)) = f(x).';

-- ----------------------------------------------------------------------
-- Vista: lista de aliases canonicos por entidad
-- ----------------------------------------------------------------------
-- Util para UI: dado un nomb_correg canonico, listar todos los nombres
-- historicos que se consolidan en el.
CREATE OR REPLACE VIEW dw.v_entidad_aliases AS
WITH RECURSIVE chain AS (
    -- Anclas: cada renombre como punto de partida
    SELECT
        nomb_correg_anterior AS raw,
        nomb_correg_actual    AS canon,
        ARRAY[nomb_correg_anterior, nomb_correg_actual] AS path,
        1 AS depth
    FROM dw.entidad_renombre
    WHERE activo AND consolidar_por_default

    UNION ALL

    -- Extender la cadena
    SELECT
        c.raw,
        r.nomb_correg_actual,
        c.path || r.nomb_correg_actual,
        c.depth + 1
    FROM chain c
    JOIN dw.entidad_renombre r ON r.nomb_correg_anterior = c.canon
    WHERE r.activo AND r.consolidar_por_default
      AND c.depth < 10
      AND NOT (r.nomb_correg_actual = ANY(c.path))  -- evitar loops
)
SELECT DISTINCT
    canon AS nomb_correg_actual,
    raw   AS nomb_correg_historico,
    depth
FROM chain
ORDER BY canon, depth;

COMMENT ON VIEW dw.v_entidad_aliases IS
    'Lista de todos los nombres historicos que se consolidan en el actual. '
    'Util para mostrar al user "Compartamos Banco" + chip "Antes: Financiera Compartamos".';

-- ----------------------------------------------------------------------
-- Seeds iniciales — casos conocidos del mercado peruano
-- ----------------------------------------------------------------------
INSERT INTO dw.entidad_renombre
    (nomb_correg_anterior, nomb_correg_actual, fecha_cambio, periodo_cambio, tipo_cambio, motivo, consolidar_por_default, fuente, activo)
VALUES
    -- Compartamos paso de Financiera a Banco en Marzo 2023
    ('Financiera Compartamos', 'Compartamos Banco', '2023-03-31', 202303, 'conversion',
     'Conversion de Empresa Financiera a Banco Multiple (Resolucion SBS)',
     TRUE, 'SBS Resolucion 2023', TRUE),

    -- Banco Azteca se renombro a Banco Alfin (~2022, fecha aproximada)
    ('Banco Azteca', 'Alfin Banco', '2022-09-30', 202209, 'rebranding',
     'Rebranding completo (cambio de marca comercial, misma entidad legal)',
     TRUE, 'Comunicado de prensa Alfin', TRUE),

    -- BBVA Continental se simplifico a BBVA en ~2019
    ('Banco Continental', 'BBVA', '2019-04-30', 201904, 'rebranding',
     'Cambio de marca de "Banco Continental BBVA" a solo "BBVA"',
     TRUE, 'BBVA Peru', TRUE),

    -- ICBC Peru Bank: variaciones del nombre
    ('ICBC PERU BANK S.A.', 'Banco ICBC', '2018-01-01', 201801, 'renombre',
     'Estandarizacion de razon social en reportes SBS',
     TRUE, NULL, TRUE)
ON CONFLICT (nomb_correg_anterior, nomb_correg_actual) DO UPDATE SET
    fecha_cambio           = EXCLUDED.fecha_cambio,
    periodo_cambio         = EXCLUDED.periodo_cambio,
    tipo_cambio            = EXCLUDED.tipo_cambio,
    motivo                 = EXCLUDED.motivo,
    consolidar_por_default = EXCLUDED.consolidar_por_default,
    fuente                 = EXCLUDED.fuente,
    activo                 = EXCLUDED.activo,
    updated_at             = now();
