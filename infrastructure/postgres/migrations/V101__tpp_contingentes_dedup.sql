-- =========================================================================
-- V101: cabecera_maestra para TOTAL PASIVO Y PATRIMONIO + CONTINGENTES +
-- cleanup de duplicados en quality_checks (issue #40).
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1) Asignar codigo D a CONTINGENTES (es_header, top-level de seccion D)
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET codigo='D', nivel=2, es_header=true, updated_at=now()
 WHERE valido_hasta IS NULL AND codigo IS NULL
   AND tipo_estado='balance'
   AND nombre = 'CONTINGENTES';

INSERT INTO admin.cabecera_audit_log
    (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
     payload_after, performed_by, motivo)
SELECT 'balance', tipo_entidad, 'D', 'CONTINGENTES', orden, 'update',
       jsonb_build_object('es_header', true, 'reason', 'CONTINGENTES tiene valor agregado en xls'),
       'migration:V101', 'Asignar D a header CONTINGENTES (issue #40)'
FROM dw.cabecera_maestra
WHERE codigo='D' AND tipo_estado='balance' AND valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- 2) Asignar codigo T a TOTAL PASIVO Y PATRIMONIO (es_total, gran total)
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET codigo='T', nivel=1, es_total=true, es_header=false, updated_at=now()
 WHERE valido_hasta IS NULL AND codigo IS NULL
   AND tipo_estado='balance'
   AND nombre = 'TOTAL PASIVO Y PATRIMONIO';

INSERT INTO admin.cabecera_audit_log
    (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
     payload_after, performed_by, motivo)
SELECT 'balance', tipo_entidad, 'T', 'TOTAL PASIVO Y PATRIMONIO', orden, 'update',
       jsonb_build_object('es_total', true, 'reason', 'Total final con valor en xls (= B + C)'),
       'migration:V101', 'Asignar T a TOTAL PASIVO Y PATRIMONIO (issue #40)'
FROM dw.cabecera_maestra
WHERE codigo='T' AND tipo_estado='balance' AND valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- 3) DELETE duplicados en admin.data_quality_checks (mantener mas reciente)
-- -------------------------------------------------------------------------
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY periodo, nomb_correg, check_type,
                            COALESCE(cuenta_codigo, '_NULL_')
               ORDER BY detected_at DESC, id DESC
           ) AS rn
    FROM admin.data_quality_checks
    WHERE reviewed_at IS NULL
)
DELETE FROM admin.data_quality_checks
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;
