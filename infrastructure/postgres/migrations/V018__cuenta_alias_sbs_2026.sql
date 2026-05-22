-- =========================================================================
-- V018: aliases adicionales detectados en archivos SBS 2026.
--
-- SBS publica nombres con variantes (singular/plural, truncados, palabras
-- omitidas). Cada uno necesita un alias para mapear al codigo canonico.
--
-- El listado completo salio de inspeccionar BANCOS/CMAC 202603 con
-- `aibenchef catalog init-maestra --dry-run`.
-- =========================================================================

INSERT INTO dw.cuenta_alias (tipo_estado, alias_norm, codigo, seccion, fuente) VALUES
    -- Balance ACTIVO — renames con palabra omitida o plural
    ('balance',    'rendimientos por cobrar',                                  'A6',    'A', 'sbs_2026'),
    ('balance',    'inmuebles, mobiliario y equipo neto',                      'A8',    'A', 'sbs_2026'),
    ('balance',    'inmuebles, mobiliario y equipo',                           'A8',    'A', 'sbs_2026'),
    ('balance',    'inversiones en subsidiarias, asociadas y negocios',        'A3.6',  'A', 'sbs_2026'),
    ('balance',    'inversiones en subsidiarias y asociadas',                  'A3.6',  'A', 'sbs_2026'),

    -- Balance PASIVO
    ('balance',    'c.t.s.',                                                   'B1.3.3','B', 'sbs_2026'),
    ('balance',    'cts',                                                      'B1.3.3','B', 'sbs_2026'),

    -- Resultados — "DE" vs "DEL", singular/plural
    ('resultados', 'resultado antes de impuesto a la renta',                   '14',    '',  'sbs_2026'),
    ('resultados', 'resultados antes del impuesto a la renta',                 '14',    '',  'sbs_2026'),
    ('resultados', 'impuesto a la renta',                                      '16',    '',  'sbs_2026')
ON CONFLICT (tipo_estado, alias_norm) DO UPDATE SET
    codigo  = EXCLUDED.codigo,
    seccion = EXCLUDED.seccion,
    fuente  = EXCLUDED.fuente;
