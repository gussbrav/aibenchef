-- =========================================================================
-- V015: dw.cuenta_alias — mapeo de nombres alternativos a codigos canonicos
--
-- Problema: SBS usa diferentes nombres para la misma cuenta en distintas
-- epocas/grupos. El plan canonico (extraido del bootstrap 2008-2023) tiene
-- el nombre VIEJO. Los archivos SBS recientes (2024+) usan nombres
-- distintos para algunas cuentas (no truncados, sino RENOMBRADOS).
--
-- Ejemplos detectados:
--   'PROVISIONES PARA CRÉDITOS DIRECTOS'
--     -> codigo 4 'PROVISIONES PARA INCOBRABILIDAD DE CRÉDITOS'
--   'RESULTADO NETO DEL EJERCICIO'
--     -> codigo 17 'UTILIDAD (PÉRDIDA) NETA'
--
-- Tabla cuenta_alias resuelve esto sin tener que tocar dim_cuenta.
-- =========================================================================

CREATE TABLE IF NOT EXISTS dw.cuenta_alias (
    tipo_estado    TEXT NOT NULL,
    alias_norm     TEXT NOT NULL,    -- nombre normalizado del alias
    codigo         TEXT NOT NULL,    -- codigo canonico
    seccion        TEXT,             -- A/B/C para balance, '' para resultados
    fuente         TEXT NOT NULL DEFAULT 'manual',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tipo_estado, alias_norm)
);

CREATE INDEX IF NOT EXISTS idx_cuenta_alias_codigo
    ON dw.cuenta_alias (codigo);

COMMENT ON TABLE dw.cuenta_alias IS
    'Mapea nombres alternativos (de archivos SBS recientes o variantes) a '
    'codigos canonicos de dw.dim_cuenta. Usar antes de matching por nombre.';

-- ============================================================
-- Seed inicial: aliases conocidos detectados en archivos 2024-2026
-- ============================================================

-- Resultados (mismo nombre normalizado lookup)
INSERT INTO dw.cuenta_alias (tipo_estado, alias_norm, codigo, seccion, fuente) VALUES
    ('resultados', 'provisiones para creditos directos',                              '4',  '', 'manual'),
    ('resultados', 'utilidad (perdida) por venta de cartera crediticia',              '8',  '', 'manual'),
    ('resultados', 'resultado antes del impuesto a la renta',                         '14', '', 'manual'),
    ('resultados', 'resultado neto del ejercicio',                                    '17', '', 'manual'),
    ('resultados', 'utilidad neta',                                                   '17', '', 'manual'),
    ('resultados', 'utilidad (perdida) del ejercicio',                                '17', '', 'manual')
ON CONFLICT DO NOTHING;

-- Balance: a medida que detectemos mas, ir agregando aqui.
-- Inversiones netas truncado ya lo capturamos via fuzzy match en el importer.
