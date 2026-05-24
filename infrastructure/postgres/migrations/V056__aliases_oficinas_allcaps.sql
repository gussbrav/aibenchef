-- =========================================================================
-- V056: Aliases ALL CAPS para raw.creditos_depositos_oficina
-- (los .xls de oficinas vienen con nombres en MAYUSCULAS).
-- =========================================================================

DO $$
DECLARE
    pares TEXT[][] := ARRAY[
        ['BBVA',                          'Banco BBVA Perú'],
        ['SCOTIABANK PERU',               'Scotiabank Perú'],
        ['SANTANDER PERU',                'Banco Santander Perú'],
        ['BANCO BCI',                     'Banco BCI Perú'],
        ['BANK OF CHINA (PERU)',          'Bank of China'],
        ['CITIBANK DEL PERU',             'Citibank'],
        ['BANCOM2',                       'BANCOM'],
        ['EMP.CRED.ALTERNATIVA',          'Edpyme Alternativa'],
        ['EMP.CRED.SANTANDER',            'Edpyme Santander'],
        ['EMP.CRED.VIVELA',               'Vívela'],
        ['FINANC. PROEMPRESA',            'Financiera Proempresa']
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
            RAISE NOTICE 'V056: canonico "%" no existe — alias "%" saltado', par[2], par[1];
            missing_count := missing_count + 1;
            CONTINUE;
        END IF;
        INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
        VALUES (canon_id, par[1], 'alias', TRUE, 'V056 — variantes ALL CAPS de oficinas')
        ON CONFLICT (entidad_id, nombre, tipo) DO NOTHING;
        inserted_count := inserted_count + 1;
    END LOOP;
    RAISE NOTICE 'V056: % aliases procesados, % faltantes', inserted_count, missing_count;
END $$;
