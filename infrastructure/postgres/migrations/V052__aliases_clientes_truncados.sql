-- =========================================================================
-- V052: Aliases para nombres truncados de clientes (raw.clientes_creditos)
--
-- El .xls de SBS topico 05 (CLIENTES_CREDITO) tiene la columna A muy
-- estrecha y trunca los nombres ("B. BBVA Per�", "B. de Cr�dito del Per�
-- (con sucursales)"). Para que matcheen con las entidades canonicas en
-- dw.entidad_maestra, agregamos cada variante a dw.entidad_nombre como
-- tipo=alias.
-- =========================================================================

-- Helper inline: insertar alias si la entidad canonica existe
DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        ['B. BBVA Per�',                                          'BBVA'],
        ['B. BBVA Peru',                                          'BBVA'],
        ['B. BBVA Perú',                                          'BBVA'],
        ['B. de Cr�dito del Per� (con sucursales en el exterior)','Banco de Credito'],
        ['B. de Cr�dito',                                          'Banco de Credito'],
        ['B. de Credito del Peru',                                 'Banco de Credito'],
        ['B. de Crédito',                                          'Banco de Credito'],
        ['B. Pichincha',                                           'Banco Pichincha'],
        ['B. Falabella Per�',                                      'Banco Falabella'],
        ['B. Falabella Peru',                                      'Banco Falabella'],
        ['B. GNB',                                                 'Banco GNB'],
        ['B. ICBC',                                                'Banco ICBC'],
        ['B. Interamericano de Finanzas',                          'BanBif'],
        ['B. Ripley',                                              'Banco Ripley'],
        ['B. Santander Per�',                                      'Santander Peru'],
        ['B. Santander Peru',                                      'Santander Peru'],
        ['Scotiabank Per�',                                        'Scotiabank Peru'],
        ['BCI Per�',                                               'Banco BCI'],
        ['BCI Peru',                                               'Banco BCI'],
        ['BANCOM',                                                 'Banco de Comercio'],
        -- Edpymes con prefijo "EC"
        ['EC Alternativa',                                         'Alternativa'],
        ['EC Acceso Crediticio',                                   'Acceso Crediticio'],
        ['EC BBVA Consumer',                                       'BBVA Consumer Finance'],
        ['EC Inversiones La Cruz',                                 'Inversiones La Cruz'],
        ['EC Mi Casita',                                           'Mi Casita'],
        ['EC Santander Consumo',                                   'Santander Consumer Bank'],
        ['EC Marcimex',                                            'Marcimex'],
        ['EC Volvo Finance',                                       'Volvo Finance'],
        -- CMAC Lima variants
        ['CMCP Lima',                                              'CMAC Lima']
    ];
    par TEXT[];
    canon_id BIGINT;
BEGIN
    FOREACH par SLICE 1 IN ARRAY pares LOOP
        -- Buscar la entidad maestra canonica
        SELECT id INTO canon_id
        FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = par[2]
        LIMIT 1;

        IF canon_id IS NULL THEN
            RAISE NOTICE 'Canonico "%" no existe en entidad_maestra — alias "%" saltado', par[2], par[1];
            CONTINUE;
        END IF;

        -- Insertar el alias
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V052 — variante truncada en raw.clientes_creditos')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
    END LOOP;
END $$;
