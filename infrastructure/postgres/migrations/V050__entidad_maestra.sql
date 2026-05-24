-- =========================================================================
-- V050: Tabla maestra de entidades financieras + tabla de nombres historicos
--
-- Consolida lo que hoy esta disperso en 3 tablas:
--   - dw.dim_entidad      (1 fila por nomb_correg actual)
--   - dw.entidad_alias    (lookups string -> nomb_correg)
--   - dw.entidad_renombre (historia de cambios temporales, V048)
--
-- Nueva estructura:
--   - dw.entidad_maestra: 1 fila por entidad CONCEPTUAL (no por nombre)
--   - dw.entidad_nombre:  N nombres por entidad (canonico, historico, alias,
--                         razon social, mayusculas, con anotaciones, etc.)
--                         con vigencia temporal y flag consolidar.
--
-- Diseno:
--   * entidad_maestra.id es la identidad estable de una entidad
--   * entidad_nombre.nombre es CUALQUIER string que apunte a esa entidad
--   * Para cada nombre, vigente_desde/vigente_hasta define cuando fue valido
--   * Lookup: dw.lookup_entidad_canonica(raw, periodo) -> nomb_correg actual
--
-- Compatibilidad: NO borramos dim_entidad / entidad_alias / entidad_renombre.
-- Quedan como tablas legacy + sus datos se backfillean a la nueva estructura.
-- =========================================================================

-- ----------------------------------------------------------------------
-- Tabla 1: entidad_maestra
-- 1 fila por entidad financiera conceptual (independiente del nombre).
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.entidad_maestra (
    id                      BIGSERIAL PRIMARY KEY,
    nomb_correg_canonico    TEXT NOT NULL UNIQUE,
    razon_social_actual     TEXT,
    tipo_entidad_actual     TEXT NOT NULL
                            CHECK (tipo_entidad_actual IN
                                ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES','BANCO_NACION','OTRO')),
    codigo_sbs              TEXT,
    es_microfinanciera      BOOLEAN NOT NULL DEFAULT FALSE,
    nacional                TEXT,
    activa                  BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_constitucion      DATE,
    fecha_baja              DATE,
    notas                   TEXT,
    metadata                JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entidad_maestra_tipo
    ON dw.entidad_maestra (tipo_entidad_actual) WHERE activa;
CREATE INDEX IF NOT EXISTS idx_entidad_maestra_codigo
    ON dw.entidad_maestra (codigo_sbs) WHERE codigo_sbs IS NOT NULL;

COMMENT ON TABLE dw.entidad_maestra IS
    'Tabla maestra: 1 fila por entidad financiera conceptual. Independiente '
    'del nombre — una entidad puede haber tenido muchos nombres a lo largo '
    'del tiempo, pero es UNA sola fila aqui. nomb_correg_canonico es el '
    'nombre vigente HOY.';

COMMENT ON COLUMN dw.entidad_maestra.nomb_correg_canonico IS
    'Nombre canonico VIGENTE. Cuando cambia (ej. Financiera Compartamos -> '
    'Compartamos Banco), se actualiza esta columna y se agrega el anterior '
    'como historico en dw.entidad_nombre.';

-- ----------------------------------------------------------------------
-- Tabla 2: entidad_nombre
-- N nombres por entidad. Cada nombre tiene tipo, vigencia y flag consolidar.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.entidad_nombre (
    id                  BIGSERIAL PRIMARY KEY,
    entidad_id          BIGINT NOT NULL REFERENCES dw.entidad_maestra(id) ON DELETE CASCADE,
    nombre              TEXT NOT NULL,
    tipo                TEXT NOT NULL
                        CHECK (tipo IN
                            ('canonico','razon_social','historico','alias','mayusculas',
                             'con_anotacion','raw_sbs','rebranding','typo')),
    vigente_desde       DATE,
    vigente_hasta       DATE,
    consolidar          BOOLEAN NOT NULL DEFAULT TRUE,
    fuente              TEXT,
    notas               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entidad_id, nombre, tipo)
);

CREATE INDEX IF NOT EXISTS idx_entidad_nombre_lookup
    ON dw.entidad_nombre (LOWER(TRIM(nombre)));
CREATE INDEX IF NOT EXISTS idx_entidad_nombre_entidad
    ON dw.entidad_nombre (entidad_id);
CREATE INDEX IF NOT EXISTS idx_entidad_nombre_vigencia
    ON dw.entidad_nombre (vigente_desde, vigente_hasta) WHERE vigente_desde IS NOT NULL;

COMMENT ON TABLE dw.entidad_nombre IS
    'Todos los nombres conocidos de una entidad: canonico actual, razon '
    'social legal, historicos, alias, variantes en mayusculas, con '
    'asteriscos o superindices, typos comunes. Permite lookup desde '
    'cualquier string crudo al nomb_correg canonico.';

COMMENT ON COLUMN dw.entidad_nombre.tipo IS
    'canonico: el nombre actual oficial (1 por entidad). '
    'razon_social: nombre legal completo en SBS. '
    'historico: nombre que tuvo en el pasado. '
    'alias: variante comun (ej. sigla). '
    'mayusculas: como aparece en raw del .xls SBS. '
    'con_anotacion: con * o N/ al final. '
    'raw_sbs: como aparece en el campo empresa_sbs raw. '
    'rebranding: cambio de marca pero misma entidad legal. '
    'typo: error tipografico que apareció en algún reporte.';

COMMENT ON COLUMN dw.entidad_nombre.vigente_desde IS
    'Periodo desde el cual este nombre fue valido. NULL = desde siempre.';

COMMENT ON COLUMN dw.entidad_nombre.vigente_hasta IS
    'Periodo hasta el cual este nombre fue valido. NULL = vigente actualmente.';

COMMENT ON COLUMN dw.entidad_nombre.consolidar IS
    'Si TRUE, este nombre se trata como equivalente al canonico en queries '
    'que pidan consolidar=true. Util para suprimir typos o variantes '
    'erradas (consolidar=FALSE) sin borrar el registro.';

-- ----------------------------------------------------------------------
-- Funcion: lookup_entidad_canonica
-- Dado un string crudo y un periodo opcional, devuelve el nomb_correg
-- canonico de la entidad. Aplica:
--   1. Match exacto contra entidad_nombre.nombre
--   2. Match exacto contra LOWER(TRIM(nombre)) (case-insensitive)
--   3. Si el match tiene vigencia, verificar que _periodo este en rango
--   4. Devolver el nomb_correg_canonico de la entidad_maestra asociada
-- Si no hay match, devuelve el raw input.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dw.lookup_entidad_canonica(_raw TEXT, _periodo INT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    _periodo_date DATE;
    _result TEXT;
BEGIN
    IF _raw IS NULL OR TRIM(_raw) = '' THEN
        RETURN _raw;
    END IF;

    -- Convertir periodo YYYYMM a date para comparar con vigencias
    IF _periodo IS NOT NULL AND _periodo BETWEEN 200001 AND 210012 THEN
        _periodo_date := (TO_CHAR(_periodo / 100, 'FM0000') || '-' ||
                          TO_CHAR(_periodo % 100, 'FM00') || '-01')::date;
    END IF;

    -- Match con vigencia temporal si se dio periodo
    IF _periodo_date IS NOT NULL THEN
        SELECT em.nomb_correg_canonico INTO _result
        FROM dw.entidad_nombre en
        JOIN dw.entidad_maestra em ON em.id = en.entidad_id
        WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(_raw))
          AND en.consolidar
          AND (en.vigente_desde IS NULL OR en.vigente_desde <= _periodo_date)
          AND (en.vigente_hasta IS NULL OR en.vigente_hasta >= _periodo_date)
        ORDER BY
          -- Preferir match con vigencia explicita
          (en.vigente_desde IS NOT NULL OR en.vigente_hasta IS NOT NULL) DESC,
          en.id
        LIMIT 1;
    END IF;

    -- Fallback: match sin considerar vigencia
    IF _result IS NULL THEN
        SELECT em.nomb_correg_canonico INTO _result
        FROM dw.entidad_nombre en
        JOIN dw.entidad_maestra em ON em.id = en.entidad_id
        WHERE LOWER(TRIM(en.nombre)) = LOWER(TRIM(_raw))
          AND en.consolidar
        ORDER BY
          CASE en.tipo
            WHEN 'canonico' THEN 1
            WHEN 'historico' THEN 2
            WHEN 'razon_social' THEN 3
            ELSE 9
          END,
          en.id
        LIMIT 1;
    END IF;

    RETURN COALESCE(_result, TRIM(_raw));
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION dw.lookup_entidad_canonica IS
    'Resuelve un nombre crudo al nomb_correg canonico de la entidad maestra. '
    'Si _periodo se proporciona, considera la vigencia temporal del nombre. '
    'Fallback al raw si no hay match.';

-- ----------------------------------------------------------------------
-- Vista: dw.v_entidad_maestra_completa
-- JOIN de maestra + nombres en JSON agg, util para UI admin.
-- ----------------------------------------------------------------------
CREATE OR REPLACE VIEW dw.v_entidad_maestra_completa AS
SELECT
    em.id,
    em.nomb_correg_canonico,
    em.razon_social_actual,
    em.tipo_entidad_actual,
    em.codigo_sbs,
    em.es_microfinanciera,
    em.activa,
    em.fecha_constitucion,
    em.fecha_baja,
    em.notas,
    em.updated_at,
    COALESCE(
        (SELECT json_agg(
            json_build_object(
                'id', en.id,
                'nombre', en.nombre,
                'tipo', en.tipo,
                'vigente_desde', en.vigente_desde,
                'vigente_hasta', en.vigente_hasta,
                'consolidar', en.consolidar,
                'fuente', en.fuente
            ) ORDER BY
                CASE en.tipo WHEN 'canonico' THEN 1 WHEN 'razon_social' THEN 2
                             WHEN 'historico' THEN 3 ELSE 9 END,
                en.vigente_desde DESC NULLS LAST
         ) FROM dw.entidad_nombre en WHERE en.entidad_id = em.id),
        '[]'::json
    ) AS nombres
FROM dw.entidad_maestra em;

COMMENT ON VIEW dw.v_entidad_maestra_completa IS
    'Cada entidad maestra con todos sus nombres en un array JSON. '
    'Consumido por el dashboard admin /dashboard/admin/renombres.';

-- ----------------------------------------------------------------------
-- BACKFILL desde las tablas legacy
-- ----------------------------------------------------------------------

-- Backfill 1: crear una entrada en entidad_maestra por cada nomb_correg
-- en dim_entidad (activas y no totales/sucursales)
INSERT INTO dw.entidad_maestra
    (nomb_correg_canonico, razon_social_actual, tipo_entidad_actual,
     codigo_sbs, es_microfinanciera, nacional, activa)
SELECT
    nomb_correg,
    NULLIF(empresa_sbs, nomb_correg),
    tipo_entidad,
    NULL,  -- codigo_sbs no esta poblado historicamente
    microfinanciera,
    nacional,
    activa
FROM dw.dim_entidad
WHERE NOT es_total AND NOT es_sucursal
ON CONFLICT (nomb_correg_canonico) DO NOTHING;

-- Backfill 2: por cada entidad_maestra, agregar el nombre canonico
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
SELECT em.id, em.nomb_correg_canonico, 'canonico', TRUE, 'backfill V050'
FROM dw.entidad_maestra em
ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;

-- Backfill 3: razon_social (empresa_sbs) si difiere del canonico
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
SELECT em.id, de.empresa_sbs, 'razon_social', TRUE, 'backfill V050 from dim_entidad'
FROM dw.entidad_maestra em
JOIN dw.dim_entidad de ON de.nomb_correg = em.nomb_correg_canonico
WHERE de.empresa_sbs IS NOT NULL
  AND de.empresa_sbs <> em.nomb_correg_canonico
ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;

-- Backfill 4: aliases de la tabla legacy dw.entidad_alias
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
SELECT em.id, ea.alias, 'alias', TRUE, COALESCE('legacy: ' || ea.fuente, 'backfill V050 from entidad_alias')
FROM dw.entidad_alias ea
JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = ea.nomb_correg
ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;

-- Backfill 5: nombres historicos desde dw.entidad_renombre (V048)
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, vigente_hasta, consolidar, fuente, notas)
SELECT
    em.id,
    er.nomb_correg_anterior,
    'historico',
    er.fecha_cambio,
    er.consolidar_por_default,
    COALESCE(er.fuente, 'backfill V050 from entidad_renombre'),
    er.motivo
FROM dw.entidad_renombre er
JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = er.nomb_correg_actual
WHERE er.activo
ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;

-- Backfill 6: variantes en MAYUSCULAS que vienen del raw del .xls SBS
-- (sólo si hay matches obvios via UPPER/lower)
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
SELECT DISTINCT
    em.id,
    raw_name,
    'raw_sbs',
    TRUE,
    'backfill V050 from raw.creditos_depositos_oficina'
FROM (
    SELECT DISTINCT empresa_sbs AS raw_name
    FROM raw.creditos_depositos_oficina
    WHERE empresa_sbs IS NOT NULL
      AND LOWER(TRIM(empresa_sbs)) NOT IN ('total general', 'total', '')
) raw_names
JOIN dw.entidad_maestra em ON
    UPPER(TRIM(em.nomb_correg_canonico)) = UPPER(TRIM(raw_names.raw_name))
    OR UPPER(TRIM(em.razon_social_actual)) = UPPER(TRIM(raw_names.raw_name))
ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
