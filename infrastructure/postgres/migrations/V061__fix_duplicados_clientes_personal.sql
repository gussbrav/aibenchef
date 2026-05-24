-- =========================================================================
-- V061: Elimina filas duplicadas en raw.clientes_creditos y
-- raw.personal_observacion + fortalece constraints UNIQUE para tratar
-- NULL como valor.
--
-- Bug detectado: en raw.clientes_creditos el constraint UNIQUE incluye
-- (periodo, empresa, producto, clasificacion) pero NULL <> NULL en
-- PostgreSQL, asi que el ON CONFLICT no atrapa duplicados cuando
-- clasificacion IS NULL. Mibanco aparecia 2 veces para Abr 2019.
-- =========================================================================

-- ---------- DEDUP CLIENTES ----------
-- Mantener UNA sola fila por (periodo, empresa, producto, clasificacion)
-- preservando la mas reciente (mayor loaded_at).
DELETE FROM raw.clientes_creditos a USING raw.clientes_creditos b
WHERE a.id < b.id
  AND a.periodo = b.periodo
  AND a.empresa = b.empresa
  AND a.producto IS NOT DISTINCT FROM b.producto
  AND a.clasificacion IS NOT DISTINCT FROM b.clasificacion;


-- ---------- DEDUP PERSONAL ----------
DELETE FROM raw.personal_observacion a USING raw.personal_observacion b
WHERE a.id < b.id
  AND a.periodo = b.periodo
  AND a.empresa_sbs = b.empresa_sbs;


-- ---------- FORTALECER CONSTRAINTS (NULL-aware) ----------
-- Postgres soporta UNIQUE NULLS NOT DISTINCT desde 15+
-- (tratará NULL como un valor unico para el constraint).
ALTER TABLE raw.clientes_creditos
    DROP CONSTRAINT IF EXISTS raw_clientes_creditos_periodo_empresa_producto_clasifica_key,
    DROP CONSTRAINT IF EXISTS clientes_creditos_unique;

-- Recrear como UNIQUE NULLS NOT DISTINCT (PG15+)
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        ALTER TABLE raw.clientes_creditos
            ADD CONSTRAINT clientes_creditos_unique
            UNIQUE NULLS NOT DISTINCT (periodo, empresa, producto, clasificacion);
    ELSE
        -- Fallback PG14-: usar COALESCE en un indice
        CREATE UNIQUE INDEX IF NOT EXISTS clientes_creditos_unique_idx
            ON raw.clientes_creditos
            (periodo, empresa, COALESCE(producto,''), COALESCE(clasificacion,''));
    END IF;
END $$;

COMMENT ON CONSTRAINT clientes_creditos_unique ON raw.clientes_creditos IS
    'Una fila por (periodo, empresa, producto, clasificacion). NULL-aware: '
    'NULLs son tratados como un valor unico para el constraint.';
