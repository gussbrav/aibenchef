-- V112b: re-renumerar SIN separar por valido_desde
-- (V112 partition era (tipo_estado, tipo_entidad, valido_desde) que creo
-- multiples grupos con orden=1, en lugar de un solo ordering unificado).

BEGIN;

-- Bump x1000000 para evitar PK conflict
UPDATE dw.cabecera_maestra SET orden = orden + 1000000;

WITH renumbered AS (
    SELECT
        ctid,
        ROW_NUMBER() OVER (
            PARTITION BY tipo_estado, tipo_entidad
            ORDER BY dw.codigo_sort_key(codigo) NULLS LAST, valido_desde, codigo
        ) AS new_orden
      FROM dw.cabecera_maestra
)
UPDATE dw.cabecera_maestra cm
   SET orden = r.new_orden,
       updated_at = now()
  FROM renumbered r
 WHERE cm.ctid = r.ctid;

COMMIT;

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT codigo, orden FROM dw.cabecera_maestra
         WHERE tipo_estado='balance' AND tipo_entidad='CMAC'
           AND codigo IN ('C1','C2','C3','C4','C5','C6','C7','C8','T','A3.5','A3.6')
         ORDER BY orden
    LOOP
        RAISE NOTICE 'V112b verify: orden=% codigo=%', r.orden, r.codigo;
    END LOOP;
END $$;
