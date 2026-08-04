-- =========================================================================
-- Auditoria: detectar entidades canonicas en dw.entidad_maestra que
-- posiblemente son la MISMA entidad real partida por un rename historico.
--
-- Criterios heuristicos:
--   1. Nombres similares (prefijo comun, o tokens compartidos)
--   2. Rangos temporales NO se solapan (una termino antes de que la otra
--      empezara)
--   3. Mismo tipo_entidad_actual
--
-- Uso: correr esta query manualmente para revisar candidatos. Cada match
-- requiere validacion humana antes de escribir una migration V148, V149,
-- etc. como V147__merge_bbva_continental.sql.
-- =========================================================================

WITH rangos AS (
  SELECT em.id,
         em.nomb_correg_canonico,
         em.tipo_entidad_actual,
         em.activa,
         MIN(v.periodo) AS primer_periodo,
         MAX(v.periodo) AS ultimo_periodo
  FROM dw.entidad_maestra em
  JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
  JOIN marts.v_punto_equilibrio_ancho v
    ON LOWER(TRIM(v.nomb_correg)) = LOWER(TRIM(en.nombre))
   AND v.moneda = 'TOTAL'
  GROUP BY em.id, em.nomb_correg_canonico, em.tipo_entidad_actual, em.activa
),
pares AS (
  SELECT
    a.id AS id_a,
    a.nomb_correg_canonico AS nombre_a,
    a.tipo_entidad_actual AS tipo_a,
    a.activa AS activa_a,
    a.primer_periodo AS primer_a,
    a.ultimo_periodo AS ultimo_a,
    b.id AS id_b,
    b.nomb_correg_canonico AS nombre_b,
    b.tipo_entidad_actual AS tipo_b,
    b.activa AS activa_b,
    b.primer_periodo AS primer_b,
    b.ultimo_periodo AS ultimo_b
  FROM rangos a
  JOIN rangos b ON b.id > a.id  -- evitar duplicados (a,b) y (b,a)
  WHERE
    -- Mismo tipo de entidad regulatoria
    a.tipo_entidad_actual = b.tipo_entidad_actual
    -- Rangos NO se solapan (una termino antes que la otra empezara, o al reves)
    AND (a.ultimo_periodo < b.primer_periodo OR b.ultimo_periodo < a.primer_periodo)
    -- Heuristica de similitud: comparten al menos una palabra >= 4 chars
    AND EXISTS (
      SELECT 1
      FROM regexp_split_to_table(LOWER(a.nomb_correg_canonico), '\s+') AS tok_a(t)
      JOIN regexp_split_to_table(LOWER(b.nomb_correg_canonico), '\s+') AS tok_b(t)
        ON tok_a.t = tok_b.t
      WHERE LENGTH(tok_a.t) >= 4
        AND tok_a.t NOT IN ('banco','peru','financiera','caja','del','de','municipal','rural','edpyme')
    )
)
SELECT
  '⚠️ POSIBLE RENAME' AS tipo,
  nombre_a || ' (' || primer_a || '-' || ultimo_a || ')' AS entidad_1,
  nombre_b || ' (' || primer_b || '-' || ultimo_b || ')' AS entidad_2,
  tipo_a AS tipo_entidad,
  CASE
    WHEN activa_a AND activa_b THEN 'ambas activas — decidir cual mantener'
    WHEN NOT activa_a AND activa_b THEN 'A ya inactiva, fusionar en B'
    WHEN activa_a AND NOT activa_b THEN 'B ya inactiva, fusionar en A'
    ELSE 'ambas inactivas — historial fragmentado'
  END AS accion_sugerida
FROM pares
ORDER BY tipo_a, nombre_a;

-- Interpretacion:
--   - Cada fila es un CANDIDATO a rename historico. NO todos son casos
--     reales — puede haber entidades con nombres similares pero distintas
--     (ej. 'Caja Sullana' vs 'Caja Piura' comparten 'Caja').
--   - La heuristica excluye palabras genericas (banco, peru, financiera,
--     caja, etc.) para reducir falsos positivos.
--   - Para cada match confirmado, crear una migration Vxxx__merge_
--     <nombre>_<nombre>.sql siguiendo el patron de V147.
