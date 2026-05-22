-- =========================================================================
-- V028: aliases para renames SBS de abril 2023 (limpieza masiva)
--
-- En abr 2023 SBS hizo un re-naming general. Cada par tiene cero overlap
-- de periodos = misma entidad renombrada. Verificado antes de aplicar.
--
-- Pares fusionados:
--   'Banco Falabella'         (200801-202303) -> 'Banco Falabella Perú'
--   'Compartamos Financiera'  (202304-202412) -> 'Financiera Compartamos'
--   'Financiera Oh'           (201610-202303) -> 'Financiera Oh!'
--   'Acceso Crediticio'       (202304-202307) -> 'Edpyme Acceso Crediticio'
--
-- NO fusionado intencionalmente:
--   'Compartamos Banco' (202501-202603) — cambio de tipo_entidad
--   FINANCIERAS -> BANCOS (upgrade regulatorio real, no rename estetico).
-- =========================================================================

INSERT INTO dw.entidad_alias (alias, nomb_correg, fuente) VALUES
    ('Banco Falabella',        'Banco Falabella Perú',     'sbs_rename_202304'),
    ('Compartamos Financiera', 'Financiera Compartamos',   'sbs_rename_202304'),
    ('Financiera Oh',          'Financiera Oh!',           'sbs_rename_202304'),
    ('Acceso Crediticio',      'Edpyme Acceso Crediticio', 'sbs_rename_202304')
ON CONFLICT (alias) DO UPDATE SET
    nomb_correg = EXCLUDED.nomb_correg,
    fuente = EXCLUDED.fuente;

-- Aplicar los aliases a la data existente
UPDATE raw.eeff_observacion SET nomb_correg = 'Banco Falabella Perú'
    WHERE nomb_correg = 'Banco Falabella';
UPDATE raw.eeff_observacion SET nomb_correg = 'Financiera Compartamos'
    WHERE nomb_correg = 'Compartamos Financiera';
UPDATE raw.eeff_observacion SET nomb_correg = 'Financiera Oh!'
    WHERE nomb_correg = 'Financiera Oh';
UPDATE raw.eeff_observacion SET nomb_correg = 'Edpyme Acceso Crediticio'
    WHERE nomb_correg = 'Acceso Crediticio';

-- Limpiar dim_entidad de las entradas viejas (ya no referenciadas)
DELETE FROM dw.dim_entidad
WHERE nomb_correg IN ('Banco Falabella', 'Compartamos Financiera',
                      'Financiera Oh', 'Acceso Crediticio')
  AND NOT EXISTS (
    SELECT 1 FROM raw.eeff_observacion r
    WHERE r.nomb_correg = dw.dim_entidad.nomb_correg
  );

-- Asegurar que los canonicos existan en dim_entidad
INSERT INTO dw.dim_entidad (nomb_correg, tipo_entidad, microfinanciera, activa)
VALUES
    ('Banco Falabella Perú',     'BANCOS',      FALSE, TRUE),
    ('Financiera Compartamos',   'FINANCIERAS', TRUE,  TRUE),
    ('Financiera Oh!',           'FINANCIERAS', FALSE, TRUE),
    ('Edpyme Acceso Crediticio', 'EDPYMES',     TRUE,  TRUE)
ON CONFLICT (nomb_correg) DO NOTHING;
