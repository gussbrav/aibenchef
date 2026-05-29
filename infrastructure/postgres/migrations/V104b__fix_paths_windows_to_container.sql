-- V104b: fix de paths Windows -> container (V104 step2 fallo por escape de \).
BEGIN;

UPDATE raw.archivos_descargados
   SET path_local = REPLACE(
        REPLACE(
            path_local,
            E'D:\\PROYECTO\\SBS\\aibenchef\\data-platform\\local-data\\raw\\',
            '/app/local-data/raw/'
        ),
        E'\\',
        '/'
    ),
    actualizado_en = now()
 WHERE starts_with(path_local, 'D:');

DO $$
DECLARE v_app INT; v_d INT;
BEGIN
    SELECT count(*) INTO v_app FROM raw.archivos_descargados WHERE starts_with(path_local, '/app/');
    SELECT count(*) INTO v_d FROM raw.archivos_descargados WHERE starts_with(path_local, 'D:');
    RAISE NOTICE 'V104b: % paths con /app/, % paths con D: remaining', v_app, v_d;
END $$;

COMMIT;
