-- =========================================================================
-- V071: Aliases para nombres truncados de Compartamos en raw.oficinas
-- + limpieza de alias duplicado de "Financiera Compartamos" que apuntaba
-- a dos entidades distintas (Compartamos Banco y Financiera Compartamos).
--
-- Hallazgo: en raw.creditos_depositos_oficina el .xls SBS trunca el nombre
-- a 20 caracteres → "Compartamos Financie". Sin alias, raw_to_vigente
-- devolvia el INITCAP truncado como nomb_correg distinto a las demas
-- vistas (que usan "Financiera Compartamos").
-- =========================================================================

-- Limpieza: eliminar duplicado de "Financiera Compartamos" → "Compartamos Banco"
-- en entidad_nombre. El registro correcto debe ser "Financiera Compartamos"
-- → entidad Financiera Compartamos (la cadena de renombres maneja el salto
-- a "Compartamos Banco" via entidad_renombre).
DELETE FROM dw.entidad_nombre
WHERE nombre = 'Financiera Compartamos'
  AND entidad_id = (SELECT id FROM dw.entidad_maestra WHERE nomb_correg_canonico = 'Compartamos Banco' LIMIT 1);

-- Aliases de variantes truncadas o variantes alternativas
DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        ['Compartamos Financie',  'Financiera Compartamos'],
        ['Compartamos Financiera','Financiera Compartamos']
    ];
    par TEXT[];
    canon_id BIGINT;
BEGIN
    FOREACH par SLICE 1 IN ARRAY pares LOOP
        SELECT id INTO canon_id FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = par[2] LIMIT 1;
        IF canon_id IS NULL THEN CONTINUE; END IF;
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V071 — variante truncada/orden Compartamos')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
    END LOOP;
END $$;
