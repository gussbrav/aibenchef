-- =========================================================================
-- V060: Completa la cadena de renombres de Edyficar.
-- Edpyme Edyficar (2008/01-2008/02) -> Financiera Edyficar (2008/03-2015/02)
-- -> Mibanco (fusion 2015/03).
--
-- Sin el primer eslabon, el label corto 'Edyficar' matcheaba via
-- razon_social a 'Edpyme Edyficar' (un canonico distinto) y no llegaba
-- a Mibanco. Con la cadena completa, resolver_nomb_correg_canonico
-- itera y termina en 'Mibanco'.
-- =========================================================================

-- Limpiamos el alias-atajo de V059 (era un fix de superficie)
DELETE FROM dw.entidad_nombre
WHERE nombre = 'Edyficar' AND tipo = 'alias' AND fuente LIKE 'V059%';

-- Renombre conversion: Edpyme -> Financiera (2008/03)
INSERT INTO dw.entidad_renombre
    (nomb_correg_anterior, nomb_correg_actual, fecha_cambio, periodo_cambio,
     tipo_cambio, motivo, consolidar_por_default, activo, fuente)
VALUES
    ('Edpyme Edyficar', 'Financiera Edyficar', '2008-03-31', 200803,
     'conversion',
     'Conversion de Edpyme a Empresa Financiera (Resolucion SBS 2008)',
     TRUE, TRUE, 'SBS-conversion-Edyficar-2008')
ON CONFLICT DO NOTHING;
