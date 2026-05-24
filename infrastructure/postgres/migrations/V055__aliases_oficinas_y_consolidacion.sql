-- =========================================================================
-- V055: Aliases para raw.creditos_depositos_oficina (Oficinas)
-- + reescribe v_oficinas_por_entidad para usar entidad_nombre como
-- clientes y personal (consistencia entre las 3 vistas).
--
-- Problema: v_oficinas_por_entidad usaba dim_entidad (legacy) y no
-- consolidaba 'Banco de Crédito' con su canonico. Como resultado el
-- LEFT JOIN del cuadro resumen fallaba para BCP.
-- =========================================================================

-- ---------- ALIASES PARA OFICINAS RAW ----------
DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        -- BCP variantes que aparecen en raw.creditos_depositos_oficina
        ['Banco de Crédito',                                       'Banco de Crédito con Sucursales en el Exterior'],
        ['Banco de Credito',                                       'Banco de Crédito con Sucursales en el Exterior'],
        ['Banco de Crédito del Perú',                              'Banco de Crédito con Sucursales en el Exterior']
    ];
    par TEXT[];
    canon_id BIGINT;
    inserted_count INT := 0;
    missing_count INT := 0;
BEGIN
    FOREACH par SLICE 1 IN ARRAY pares LOOP
        SELECT id INTO canon_id
        FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = par[2]
        LIMIT 1;
        IF canon_id IS NULL THEN
            missing_count := missing_count + 1;
            CONTINUE;
        END IF;
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V055 — alias BCP para vistas oficinas')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
        inserted_count := inserted_count + 1;
    END LOOP;
    RAISE NOTICE 'V055: % aliases procesados, % faltantes', inserted_count, missing_count;
END $$;


-- ---------- REESCRIBIR vista de oficinas usando entidad_nombre ----------
-- Mantiene el conteo de codigo_oficina DISTINCT pero resuelve el nombre
-- via JOIN con entidad_nombre (como clientes y personal).
DROP VIEW IF EXISTS marts.v_oficinas_por_entidad_canonico;
DROP VIEW IF EXISTS marts.v_oficinas_por_entidad;
CREATE VIEW marts.v_oficinas_por_entidad AS
WITH base AS (
    SELECT
        o.periodo,
        o.codigo_oficina,
        COALESCE(
            (SELECT em.nomb_correg_canonico
             FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
             WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(o.empresa_sbs))
             LIMIT 1),
            (SELECT em.nomb_correg_canonico
             FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
             WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(o.empresa))
             LIMIT 1),
            INITCAP(dw.limpiar_nombre_raw(o.empresa_sbs))
        ) AS nomb_correg
    FROM raw.creditos_depositos_oficina o
    WHERE o.empresa_sbs IS NOT NULL
      AND LOWER(TRIM(o.empresa_sbs)) NOT IN ('total general', 'total', '')
)
SELECT
    periodo,
    nomb_correg,
    COUNT(DISTINCT codigo_oficina) FILTER (WHERE codigo_oficina IS NOT NULL)::int AS n_oficinas
FROM base
WHERE nomb_correg IS NOT NULL AND nomb_correg <> ''
GROUP BY periodo, nomb_correg;

CREATE VIEW marts.v_oficinas_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_oficinas)::int AS n_oficinas
FROM marts.v_oficinas_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);
