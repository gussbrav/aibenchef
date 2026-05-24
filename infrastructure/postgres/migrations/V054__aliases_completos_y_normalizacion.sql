-- =========================================================================
-- V054: Aliases completos para clientes + personal y normalizacion de
-- marcadores de notas al pie ("*", "1/", "(*)", "**", etc.)
--
-- Problemas detectados:
-- 1) Muchos canonicos en V052 no existian en entidad_maestra (BBVA, BCP, etc.)
-- 2) Los .xls usan marcadores como "*", "**", "1/", "3/", "(p)", "(*)" para
--    notas al pie que rompen el match con aliases existentes.
--
-- Solucion:
-- A) Crear funcion dw.limpiar_nombre_raw() que strippea sufijos comunes.
-- B) Reescribir las vistas marts.v_clientes/personal_por_entidad para usarla.
-- C) Insertar aliases completos para todas las variantes detectadas.
-- =========================================================================

-- ---------- A) FUNCION DE LIMPIEZA ----------
CREATE OR REPLACE FUNCTION dw.limpiar_nombre_raw(raw_nombre TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                COALESCE(raw_nombre, ''),
                -- Quita sufijos de notas al pie al final: " *", " **", " 1/", " (*)", " (p)", "**", "*"
                '\s*(\*+|\([\*p\)]+\)|\d+/|\s\*+)$',
                '',
                'g'
            ),
            -- Tambien limpia sufijos intermedios con espacio: "Foo *", "Foo 1/"
            '\s+(\*+|\d+/)$',
            '',
            'g'
        )
    );
$$;

COMMENT ON FUNCTION dw.limpiar_nombre_raw(TEXT) IS
    'Strippea marcadores de notas al pie ("*", "**", "1/", "(*)", "(p)") del final '
    'de un nombre de entidad raw. Usado por las vistas marts.* para matchear con '
    'aliases canonicos.';


-- ---------- B) ALIASES COMPLETOS ----------
DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        -- BANCOS truncados
        ['B. BBVA Perú',                                           'Banco BBVA Perú'],
        ['B. de Crédito del Perú (con sucursales en el exterior)', 'Banco de Crédito con Sucursales en el Exterior'],
        ['B. de Crédito',                                          'Banco de Crédito del Perú'],
        ['B. de Credito del Peru',                                 'Banco de Crédito del Perú'],
        ['B. Falabella Perú',                                      'Banco Falabella Perú'],
        ['B. Falabella Peru',                                      'Banco Falabella Perú'],
        ['B. Santander Perú',                                      'Banco Santander Perú'],
        ['B. Santander Peru',                                      'Banco Santander Perú'],
        ['B. Continental',                                         'Banco Continental'],
        ['B. de Comercio',                                         'Banco de Comercio'],
        ['B. Azteca Perú',                                         'Banco Azteca'],
        ['B. Azteca Peru',                                         'Banco Azteca'],
        ['B. Cencosud',                                            'Banco Cencosud'],
        ['B. del Trabajo',                                         'Banco del Trabajo'],
        ['B. Financiero',                                          'Banco Financiero'],
        ['B. Pichincha',                                           'Banco Pichincha'],
        ['B. Falabella Perú',                                      'Banco Falabella Perú'],
        ['B. GNB',                                                 'Banco GNB'],
        ['B. ICBC',                                                'Banco ICBC'],
        ['B. Interamericano de Finanzas',                          'BanBif'],
        ['B. Ripley',                                              'Banco Ripley'],
        ['BCI Perú',                                               'Banco BCI Perú'],
        ['BCI Peru',                                               'Banco BCI Perú'],
        ['BANCOM',                                                 'BANCOM'],
        ['Interbank (con sucursales en el exterior)',              'Interbank'],
        ['Scotiabank Perú (con sucursales en el exterior)',        'Scotiabank Perú'],
        ['Deutsche Bank Perú',                                     'DeutscheBank'],
        ['Alfin Banco 3/',                                         'Alfin Banco'],
        -- Financieras truncadas/typos
        ['Finaciera TFC S.A.',                                     'Financiera TFC'],
        ['Finaciera TFC S.A. *',                                   'Financiera TFC'],
        ['Financiera TFC S.A.',                                    'Financiera TFC'],
        ['Amérika Financiera',                                     'Financiera Amérika Financiera'],
        ['Financiera Edyficar',                                    'Financiera Edyficar'],
        ['Financiera Qapac',                                       'Financiera Qapaq'],
        ['Solución Financiera de Crédito 1/',                      'Financiera Solución'],
        ['Solución Financiera de Crédito',                         'Financiera Solución'],
        ['Infinance XP',                                           'InFinance XP'],
        ['Santander Consumer Bank',                                'Santander Consumer Bank'],
        -- CMAC/CMCP
        ['CMCP Lima',                                              'CMCP Lima'],
        ['CMAC Lima',                                              'CMCP Lima'],
        -- CRAC
        ['CRAC Cencosud Scotia',                                   'CRAC Censosud Scotia'],
        ['CRAC CAT',                                               'CRAC CAT Perú'],
        ['CRAC Nuestra Gente',                                     'CRAC Nuestra Gente'],
        ['CRAC Señor de Luren',                                    'CRAC Señor de Luren'],
        -- EDPYMES con prefijo "EC" o "EDPYME"
        ['EC Alternativa',                                         'Edpyme Alternativa'],
        ['EC Acceso Crediticio',                                   'Edpyme Acceso Crediticio'],
        ['EDPYME Acceso Crediticio',                               'Edpyme Acceso Crediticio'],
        ['EC BBVA Consumer',                                       'Edpyme BBVA Consumer Finance'],
        ['EDPYME BBVA',                                            'Edpyme BBVA Consumer Finance'],
        ['EDPYME BBVA Consumer Finance',                           'Edpyme BBVA Consumer Finance'],
        ['EC Inversiones La Cruz',                                 'Edpyme Inversiones La Cruz'],
        ['EDPYME Inversiones La Cruz',                             'Edpyme Inversiones La Cruz'],
        ['EC Mi Casita',                                           'Edpyme Micasita'],
        ['EDPYME Micasita',                                        'Edpyme Micasita'],
        ['EC Santander Consumo',                                   'Santander Consumo'],
        ['EC Marcimex',                                            'Edpyme Marcimex'],
        ['EDPYME Marcimex',                                        'Edpyme Marcimex'],
        ['EC Volvo Finance',                                       'Edpyme Volvo Finance'],
        ['EC TOTAL Servicios Financieros',                         'Edpyme Servicios Financieros Total'],
        ['EDPYME Servicios Financieros Total',                     'Edpyme Servicios Financieros Total'],
        ['EC Vívela',                                              'Vívela'],
        ['EDPYME Credijet',                                        'Edpyme Credijet'],
        ['EDPYME GMG',                                             'Edpyme GMG'],
        ['CRAC del Centro',                                        'CRAC del Centro']
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
            RAISE NOTICE 'Canonico "%" no existe en entidad_maestra — alias "%" saltado', par[2], par[1];
            missing_count := missing_count + 1;
            CONTINUE;
        END IF;

        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V054 — variante truncada o typo en raw.*')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
        inserted_count := inserted_count + 1;
    END LOOP;

    RAISE NOTICE 'V054: % aliases procesados, % canonicos faltantes', inserted_count, missing_count;
END $$;


-- ---------- C) REESCRIBIR VISTAS CON LIMPIEZA ----------
CREATE OR REPLACE VIEW marts.v_clientes_por_entidad AS
SELECT
    periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(c.empresa))
         LIMIT 1),
        INITCAP(dw.limpiar_nombre_raw(c.empresa))
    ) AS nomb_correg,
    SUM(c.n_clientes)::int AS n_clientes
FROM raw.clientes_creditos c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.producto = 'TOTAL'
GROUP BY periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(c.empresa))
         LIMIT 1),
        INITCAP(dw.limpiar_nombre_raw(c.empresa))
    );


CREATE OR REPLACE VIEW marts.v_personal_por_entidad AS
SELECT
    periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(p.empresa_sbs))
         LIMIT 1),
        INITCAP(dw.limpiar_nombre_raw(p.empresa_sbs))
    ) AS nomb_correg,
    SUM(p.total)::int AS n_personal
FROM raw.personal_observacion p
WHERE p.empresa_sbs IS NOT NULL
  AND LOWER(TRIM(p.empresa_sbs)) NOT IN ('total general', 'total', '')
  AND p.total IS NOT NULL
GROUP BY periodo,
    COALESCE(
        (SELECT em.nomb_correg_canonico
         FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
         WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(p.empresa_sbs))
         LIMIT 1),
        INITCAP(dw.limpiar_nombre_raw(p.empresa_sbs))
    );


-- Vistas consolidadas (recrear porque dependen de las base)
CREATE OR REPLACE VIEW marts.v_clientes_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_clientes)::int AS n_clientes
FROM marts.v_clientes_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

CREATE OR REPLACE VIEW marts.v_personal_por_entidad_canonico AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(n_personal)::int AS n_personal
FROM marts.v_personal_por_entidad
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);
