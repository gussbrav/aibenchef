-- =========================================================================
-- V097: UNIQUE INDEX parcial sobre dw.cabecera_maestra (issue #30)
--
-- Previene codigos duplicados como el detectado en CMAC/CRAC/EDPYMES donde
-- existian dos filas distintas con codigo='2.7' (Pérdida por Valorización
-- y Pérdida por Inversiones en Subsidiarias). La segunda debia ser 2.8.
--
-- El constraint es PARCIAL — solo aplica a filas con:
--   - valido_hasta IS NULL (cabecera vigente, no historica)
--   - codigo IS NOT NULL (filas marker/seccion sin codigo siguen permitidas)
--
-- Esto evita romper datos historicos que podrian tener duplicados legitimos
-- y permite multiples filas con codigo NULL (headers de seccion, totales,
-- footnotes, etc).
-- =========================================================================

-- Verificar que NO haya duplicados antes de crear el INDEX (defensive).
DO $$
DECLARE
    v_dup_count INT;
BEGIN
    SELECT COUNT(*) INTO v_dup_count
    FROM (
        SELECT tipo_estado, tipo_entidad, codigo, COUNT(*) AS n
        FROM dw.cabecera_maestra
        WHERE valido_hasta IS NULL AND codigo IS NOT NULL
        GROUP BY tipo_estado, tipo_entidad, codigo
        HAVING COUNT(*) > 1
    ) dups;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'V097 abortada: existen % codigos duplicados en cabecera vigente. Corrige antes de aplicar este index.', v_dup_count;
    END IF;
END $$;

-- INDEX parcial: codigos unicos por (tipo_estado, tipo_entidad) cuando vigente
CREATE UNIQUE INDEX IF NOT EXISTS uq_cabecera_codigo_vigente
    ON dw.cabecera_maestra (tipo_estado, tipo_entidad, codigo)
    WHERE valido_hasta IS NULL AND codigo IS NOT NULL;

COMMENT ON INDEX dw.uq_cabecera_codigo_vigente IS
    'Previene codigos duplicados en cabecera vigente. Issue #30.
     Permite multiples filas con codigo NULL (marker/seccion/footnote).';
