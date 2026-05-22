-- =========================================================================
-- V017: pulir cabecera_maestra y agregar aliases nuevos detectados.
--
-- 1) Permitir codigo NULL en cabecera_maestra. La idea: cuando init-maestra
--    no puede resolver una fila a un codigo canonico (ej Avales, footnotes),
--    en vez de meter '???_balance_74' insertamos NULL. El importer ignora
--    rows con codigo NULL.
--
-- 2) Aliases nuevos detectados en 202603:
--    balance/C: "resultado neto del ejercicio" -> C8
--    resultados: "disponible" -> 1.1 (canonico es plural "Disponibles")
--    resultados: "provisiones para bienes realizados, recidos en pago" -> 12.5
--      (SBS trunca "Realizables" como "Realizados" en algunos archivos)
-- =========================================================================

ALTER TABLE dw.cabecera_maestra
    ALTER COLUMN codigo DROP NOT NULL;

COMMENT ON COLUMN dw.cabecera_maestra.codigo IS
    'Codigo canonico de dw.dim_cuenta. NULL = fila no mapeable (footnote, '
    'off-balance, total redundante). Importer ignora estas filas.';

-- ============================================================
-- Aliases nuevos
-- ============================================================

INSERT INTO dw.cuenta_alias (tipo_estado, alias_norm, codigo, seccion, fuente) VALUES
    ('balance',    'resultado neto del ejercicio',                           'C8',  'C', 'sbs_2026'),
    ('balance',    'resultados netos del ejercicio',                         'C8',  'C', 'sbs_2026'),
    ('resultados', 'disponible',                                             '1.1', '',  'sbs_2026'),
    ('resultados', 'provisiones para bienes realizados, recidos en pago',    '12.5','',  'sbs_2026'),
    ('resultados', 'provisiones para bienes realizables, recibidos en pago', '12.5','',  'sbs_2026'),
    ('resultados', 'provisiones para bienes realizados',                     '12.5','',  'sbs_2026')
ON CONFLICT (tipo_estado, alias_norm) DO UPDATE SET
    codigo  = EXCLUDED.codigo,
    seccion = EXCLUDED.seccion,
    fuente  = EXCLUDED.fuente;
