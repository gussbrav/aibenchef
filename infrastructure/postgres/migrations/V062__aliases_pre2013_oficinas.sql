-- =========================================================================
-- V062: Aliases para nombres pre-2013 en raw.creditos_depositos_oficina.
-- Los .xls pre-2013 de BANCOS/FINANCIERAS usan nombres truncados o
-- razon social abreviada en MAYUSCULAS (ej "CREDITO", "B B V A BANCO
-- CONTIN", "AZTECA DEL PERU"). Sin alias, marts.v_oficinas_por_entidad
-- los muestra como INITCAP("Credito") y no consolida.
-- =========================================================================

DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        ['CREDITO',               'Banco de Crédito con Sucursales en el Exterior'],
        ['FINANC DE CREDITO',     'Financiera Credinka'],
        ['B B V A BANCO CONTIN',  'Banco BBVA Perú'],
        ['AZTECA DEL PERU',       'Alfin Banco'],
        ['BANCO INTERAMERICANO',  'BanBif'],
        ['BANCO RIPLEY PERU SA',  'Banco Ripley'],
        ['BANCO RIPLEY S A',      'Banco Ripley'],
        ['CITIBANK PERU',         'Citibank'],
        ['COMERCIO',              'Banco de Comercio'],
        ['CREDISCOTIA',           'Financiera Crediscotia'],
        ['CREDISCOTIA FINANC',    'Financiera Crediscotia'],
        ['DEUTSCHE BANK PERU',    'DeutscheBank'],
        ['FALABELLA PERÚ S A',    'Banco Falabella Perú'],
        ['FALABELLA PER S A',     'Banco Falabella Perú'],
        ['FINANCIERA CREAR ARE',  'Financiera Crear'],
        ['FINANCIERA TFC S A',    'Financiera TFC'],
        ['FINANCIERA UNO S A',    'Financiera UNO'],
        ['FINANCIERO',            'Banco Financiero'],
        ['FINAN. PROEMPRESA',     'Financiera Proempresa'],
        ['HSBC BANK PERU',        'Banco HSBC'],
        ['MITSUI A.FINANCE PER',  'Mitsui Auto Finance'],
        ['SOLUCION',              'Financiera Solución'],
        ['TRABAJO',               'Banco del Trabajo']
    ];
    par TEXT[];
    canon_id BIGINT;
    inserted_count INT := 0;
BEGIN
    FOREACH par SLICE 1 IN ARRAY pares LOOP
        SELECT id INTO canon_id FROM dw.entidad_maestra
        WHERE nomb_correg_canonico = par[2] LIMIT 1;
        IF canon_id IS NULL THEN
            RAISE NOTICE 'V062: canonico "%" no existe — alias "%" saltado', par[2], par[1];
            CONTINUE;
        END IF;
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V062 — nombres pre-2013 abreviados/CAPS')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
        inserted_count := inserted_count + 1;
    END LOOP;
    RAISE NOTICE 'V062: % aliases procesados', inserted_count;
END $$;
