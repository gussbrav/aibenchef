-- =========================================================================
-- V058: Corrige renombres cuyo `nomb_correg_actual` no apunta a un
-- canonico real en `dw.entidad_maestra`. Sin esto, la funcion
-- `dw.resolver_nomb_correg_canonico` devuelve un string sin filas en
-- las MVs, y el cuadro resumen queda vacio para esa entidad.
--
-- Regla de oro (vinculada a R15): el `nomb_correg_actual` de cada fila
-- de `dw.entidad_renombre` DEBE existir como canonico en
-- `dw.entidad_maestra.nomb_correg_canonico`.
-- =========================================================================

-- Fix #3: 'Banco Continental' -> 'BBVA' es incorrecto.
-- El canonico real en entidad_maestra es 'Banco BBVA Per�'.
UPDATE dw.entidad_renombre
SET nomb_correg_actual = 'Banco BBVA Perú',
    notas = COALESCE(notas, '') || ' (V058: corregido de "BBVA" -> "Banco BBVA Perú" para apuntar al canonico real)'
WHERE nomb_correg_anterior = 'Banco Continental'
  AND nomb_correg_actual = 'BBVA';


-- CONSTRAINT preventivo: a futuro, todo renombre activo debe apuntar a
-- un canonico existente. Usamos una funcion + trigger porque PostgreSQL
-- no soporta FK cross-tabla con columna no-PK.
CREATE OR REPLACE FUNCTION dw.check_renombre_canonico_existe()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.activo AND NOT EXISTS (
        SELECT 1 FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = NEW.nomb_correg_actual
    ) THEN
        RAISE EXCEPTION 'V058: nomb_correg_actual "%" no existe como canonico en dw.entidad_maestra. '
            'Registra primero la entidad maestra o usa un nombre existente.', NEW.nomb_correg_actual;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_renombre_canonico ON dw.entidad_renombre;
CREATE TRIGGER trg_check_renombre_canonico
    BEFORE INSERT OR UPDATE ON dw.entidad_renombre
    FOR EACH ROW
    EXECUTE FUNCTION dw.check_renombre_canonico_existe();

COMMENT ON FUNCTION dw.check_renombre_canonico_existe() IS
    'Valida que entidad_renombre.nomb_correg_actual exista en '
    'entidad_maestra.nomb_correg_canonico (regla de oro R15).';
