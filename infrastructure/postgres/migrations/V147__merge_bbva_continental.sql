-- V147 — Fusionar 'Banco Continental' con 'Banco BBVA Perú'
--
-- Contexto: Banco Continental fue renombrado a BBVA Perú en Feb-Mar 2023.
-- Actualmente en dw.entidad_maestra existen como 2 filas canonicas separadas,
-- lo que hace que la historia aparezca partida en el UI (200801-202303 bajo
-- Continental, 202304-202606 bajo BBVA Peru).
--
-- Fix: mantener BBVA Peru como el canonico VIGENTE, mover todos los nombres
-- historicos de Continental a apuntar al canonico BBVA, marcar Continental
-- como fecha_baja + inactivo. La data en v_punto_equilibrio_ancho y todas
-- las MVs sigue igual (por nomb_correg raw), pero el LOOKUP canonico ahora
-- fusiona ambas historias bajo BBVA Peru.
--
-- Idempotente: si BBVA ya no existe o si Continental ya fue fusionado, no
-- hace nada.

DO $$
DECLARE
    bbva_id         BIGINT;
    continental_id  BIGINT;
    fecha_rename    DATE := '2023-03-31'; -- ultimo periodo activo como Continental
BEGIN
    SELECT id INTO bbva_id
    FROM dw.entidad_maestra
    WHERE nomb_correg_canonico = 'Banco BBVA Perú';

    SELECT id INTO continental_id
    FROM dw.entidad_maestra
    WHERE nomb_correg_canonico = 'Banco Continental'
      AND activa = TRUE;  -- si ya se desactivo antes, skip

    IF bbva_id IS NULL THEN
        RAISE NOTICE 'V147: Banco BBVA Peru no existe en la maestra — skip';
        RETURN;
    END IF;

    IF continental_id IS NULL THEN
        RAISE NOTICE 'V147: Banco Continental ya fue fusionado o no existe — skip';
        RETURN;
    END IF;

    RAISE NOTICE 'V147: fusionando Banco Continental (id=%) -> Banco BBVA Peru (id=%)',
                 continental_id, bbva_id;

    -- 1. Reasignar nombres de Continental a BBVA. Evitar conflictos con la
    --    constraint UNIQUE (entidad_id, nombre, tipo): primero los que NO
    --    causarian duplicado, luego borramos los duplicados restantes.
    --    El nombre canonico viejo 'Banco Continental' se convierte en
    --    tipo='historico' con vigente_hasta=fecha_rename para reflejar
    --    que ya no es el nombre actual.
    UPDATE dw.entidad_nombre AS en_old
    SET entidad_id = bbva_id,
        tipo = CASE WHEN en_old.tipo = 'canonico' THEN 'historico' ELSE en_old.tipo END,
        vigente_hasta = CASE
            WHEN en_old.tipo = 'canonico' AND en_old.vigente_hasta IS NULL
                THEN fecha_rename
            ELSE en_old.vigente_hasta
        END,
        notas = COALESCE(en_old.notas || E'\n', '') || 'V147: reasignado desde Banco Continental'
    WHERE en_old.entidad_id = continental_id
      AND NOT EXISTS (
          SELECT 1 FROM dw.entidad_nombre en_new
          WHERE en_new.entidad_id = bbva_id
            AND LOWER(TRIM(en_new.nombre)) = LOWER(TRIM(en_old.nombre))
            AND en_new.tipo = CASE WHEN en_old.tipo = 'canonico' THEN 'historico' ELSE en_old.tipo END
      );

    -- 2. Borrar los nombres restantes de Continental (los que causaban
    --    duplicado ya existen en BBVA con el mismo tipo).
    DELETE FROM dw.entidad_nombre
    WHERE entidad_id = continental_id;

    -- 3. Marcar la entidad Continental como con fecha de baja + inactiva.
    --    Preservada para auditoria — no borramos la fila.
    UPDATE dw.entidad_maestra
    SET fecha_baja = fecha_rename,
        activa = FALSE,
        notas = COALESCE(notas || E'\n', '') ||
                'V147 (2026-08): fusionada a Banco BBVA Peru (id=' || bbva_id || '). ' ||
                'Renombrada desde 2023-04. Data historica preservada bajo el nomb_correg raw.'
    WHERE id = continental_id;

    -- 4. Actualizar la entidad BBVA con nota de merge para trazabilidad.
    UPDATE dw.entidad_maestra
    SET notas = COALESCE(notas || E'\n', '') ||
                'V147: absorbio historicos de Banco Continental (id=' || continental_id ||
                '), rename efectivo desde 2023-04.',
        updated_at = now()
    WHERE id = bbva_id;

    RAISE NOTICE 'V147: merge completado';
END $$;
