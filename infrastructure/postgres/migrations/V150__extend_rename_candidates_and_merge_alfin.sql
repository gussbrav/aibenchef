-- V150 — Extender detector de renames + fusionar Alfin Banco / Banco Azteca
--
-- 1. Actualiza dw.v_entidad_rename_candidates para detectar DOS tipos de
--    candidatos, no solo el rename secuencial:
--    - TIPO A (secuencial): rangos NO se solapan, gap chico (ex: Continental
--      terminó 202303 → BBVA empezó 202304).
--    - TIPO B (duplicado con solapamiento): rangos SE solapan pero uno
--      termina antes que el otro (ex: Alfin 200801-202606, Azteca 200801-
--      202303 — ambos empiezan igual pero solo uno sigue reportando).
--
-- 2. Fusiona Alfin Banco (canonico actual) + Banco Azteca (historico)
--    usando la helper function dw.merge_entidad_maestra() de V149.
--
-- Idempotente.

-- =========================================================================
-- VIEW extendida: detecta 2 tipos de candidatos
--
-- Postgres NO permite CREATE OR REPLACE VIEW cuando cambian las columnas
-- (agregamos tipo_candidato en el medio). Hay que DROP + CREATE. CASCADE
-- por si algo depende (nada deberia — es admin panel read-only).
-- =========================================================================
DROP VIEW IF EXISTS dw.v_entidad_rename_candidates CASCADE;

CREATE VIEW dw.v_entidad_rename_candidates AS
WITH rangos AS (
    SELECT em.id,
           em.nomb_correg_canonico,
           em.tipo_entidad_actual,
           em.activa,
           MIN(v.periodo) AS primer_periodo,
           MAX(v.periodo) AS ultimo_periodo,
           COUNT(DISTINCT v.periodo) AS periodos_con_data
    FROM dw.entidad_maestra em
    JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
    JOIN marts.v_punto_equilibrio_ancho v
      ON LOWER(TRIM(v.nomb_correg)) = LOWER(TRIM(en.nombre))
     AND v.moneda = 'TOTAL'
    GROUP BY em.id, em.nomb_correg_canonico, em.tipo_entidad_actual, em.activa
),
pares AS (
    SELECT
      a.id AS id_a, a.nomb_correg_canonico AS nombre_a,
      a.tipo_entidad_actual AS tipo, a.activa AS activa_a,
      a.primer_periodo AS primer_a, a.ultimo_periodo AS ultimo_a,
      b.id AS id_b, b.nomb_correg_canonico AS nombre_b,
      b.activa AS activa_b,
      b.primer_periodo AS primer_b, b.ultimo_periodo AS ultimo_b,
      CASE
          WHEN a.ultimo_periodo >= b.ultimo_periodo THEN a.nomb_correg_canonico
          ELSE b.nomb_correg_canonico
      END AS canonico_sugerido_actual,
      CASE
          WHEN a.ultimo_periodo >= b.ultimo_periodo THEN b.nomb_correg_canonico
          ELSE a.nomb_correg_canonico
      END AS canonico_sugerido_historico,
      -- Detectar tipo de candidato
      CASE
          -- TIPO A: rangos secuenciales (no se solapan)
          WHEN a.ultimo_periodo < b.primer_periodo OR b.ultimo_periodo < a.primer_periodo
              THEN 'secuencial'
          -- TIPO B: rangos solapados pero uno termina antes que el otro
          WHEN a.ultimo_periodo != b.ultimo_periodo
              THEN 'duplicado'
          ELSE NULL
      END AS tipo_candidato,
      -- Gap en meses para tipo secuencial, diferencia de ultimo_periodo para tipo duplicado
      CASE
          WHEN a.ultimo_periodo < b.primer_periodo THEN b.primer_periodo - a.ultimo_periodo
          WHEN b.ultimo_periodo < a.primer_periodo THEN a.primer_periodo - b.ultimo_periodo
          ELSE ABS(a.ultimo_periodo - b.ultimo_periodo)
      END AS gap_periodos
    FROM rangos a
    JOIN rangos b ON b.id > a.id
    WHERE
      a.tipo_entidad_actual = b.tipo_entidad_actual
      AND (
          -- Secuenciales sin solape
          a.ultimo_periodo < b.primer_periodo OR b.ultimo_periodo < a.primer_periodo
          OR
          -- Duplicados: mismo primer_periodo o rangos muy solapados con distinto ultimo
          (a.primer_periodo = b.primer_periodo AND a.ultimo_periodo != b.ultimo_periodo)
      )
      AND EXISTS (
          SELECT 1
          FROM regexp_split_to_table(LOWER(a.nomb_correg_canonico), '\s+') AS tok_a(t)
          JOIN regexp_split_to_table(LOWER(b.nomb_correg_canonico), '\s+') AS tok_b(t)
            ON tok_a.t = tok_b.t
          WHERE LENGTH(tok_a.t) >= 4
            AND tok_a.t NOT IN ('banco','peru','financiera','caja','municipal','rural','edpyme','del','con','sucursales','exterior','crédito','credito','ahorro','crediticio')
      )
)
SELECT
    id_a, nombre_a, primer_a, ultimo_a, activa_a,
    id_b, nombre_b, primer_b, ultimo_b, activa_b,
    tipo,
    canonico_sugerido_actual,
    canonico_sugerido_historico,
    tipo_candidato,
    gap_periodos,
    CASE
        WHEN tipo_candidato = 'secuencial' AND gap_periodos <= 3 THEN 'alta'
        WHEN tipo_candidato = 'duplicado' AND gap_periodos >= 12 THEN 'alta'
        WHEN gap_periodos <= 12 THEN 'media'
        ELSE 'baja'
    END AS confianza
FROM pares
WHERE tipo_candidato IS NOT NULL
ORDER BY
    CASE tipo_candidato WHEN 'secuencial' THEN 0 ELSE 1 END,
    CASE
        WHEN tipo_candidato = 'secuencial' AND gap_periodos <= 3 THEN 0
        WHEN tipo_candidato = 'duplicado' AND gap_periodos >= 12 THEN 0
        WHEN gap_periodos <= 12 THEN 1
        ELSE 2
    END,
    tipo, nombre_a;

COMMENT ON VIEW dw.v_entidad_rename_candidates IS
    'Detecta candidatos a fusion. tipo_candidato=secuencial: rangos NO se solapan (rename historico). ' ||
    'tipo_candidato=duplicado: rangos solapados pero uno termino antes (mismo entity registrado 2 veces).';

-- =========================================================================
-- MERGE: Alfin Banco (canonico actual) + Banco Azteca (historico)
--
-- Banco Azteca opero en Peru desde 2007 y fue renombrado a Alfin Banco
-- en 2023. En la maestra estan como 2 canonicos separados pero son la
-- misma entidad real. Fusionamos manteniendo 'Alfin Banco' como actual.
-- =========================================================================
SELECT * FROM dw.merge_entidad_maestra(
    _canonico_actual := 'Alfin Banco',
    _canonico_historico := 'Banco Azteca',
    _fecha_rename := '2023-03-31'::date
);
