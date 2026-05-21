-- =========================================================================
-- V004: Fact table universal (skinny-long), particionada por anio
-- =========================================================================

CREATE TABLE IF NOT EXISTS dw.fact_observacion (
  id                  BIGSERIAL,
  periodo_id          INT NOT NULL REFERENCES dw.dim_tiempo(id),
  entidad_id          INT NOT NULL REFERENCES dw.dim_entidad(id),
  cuenta_id           INT NOT NULL REFERENCES dw.dim_cuenta(id),
  moneda_id           SMALLINT NOT NULL REFERENCES dw.dim_moneda(id),
  geografia_id        INT REFERENCES dw.dim_geografia(id),
  tipo_credito_id     SMALLINT REFERENCES dw.dim_tipo_credito(id),
  tipo_deposito_id    SMALLINT REFERENCES dw.dim_tipo_deposito(id),
  valor               NUMERIC(20, 2) NOT NULL,
  loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  loaded_by_run_id    UUID,
  PRIMARY KEY (id, periodo_id)
) PARTITION BY RANGE (periodo_id);

-- Particiones por anio (manual por ahora; pg_partman cuando crezca)
-- Cada particion cubre YYYYMM 1..12
DO $$
DECLARE
  yr INT;
  start_id INT;
  end_id INT;
BEGIN
  FOR yr IN 2010..2027 LOOP
    start_id := yr * 100 + 1;
    end_id := (yr + 1) * 100 + 1;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS dw.fact_observacion_%s PARTITION OF dw.fact_observacion FOR VALUES FROM (%s) TO (%s)',
      yr, start_id, end_id
    );
  END LOOP;
END$$;

-- Indices sobre la tabla padre (se propagan a particiones)
CREATE INDEX IF NOT EXISTS idx_fact_obs_entidad_periodo
  ON dw.fact_observacion (entidad_id, periodo_id);

CREATE INDEX IF NOT EXISTS idx_fact_obs_cuenta_periodo
  ON dw.fact_observacion (cuenta_id, periodo_id);

CREATE INDEX IF NOT EXISTS idx_fact_obs_periodo
  ON dw.fact_observacion (periodo_id);

-- Constraint logica: una observacion es unica por combinacion de dims
CREATE UNIQUE INDEX IF NOT EXISTS uq_fact_observacion
  ON dw.fact_observacion (
    periodo_id, entidad_id, cuenta_id, moneda_id,
    COALESCE(geografia_id, 0),
    COALESCE(tipo_credito_id, 0::smallint),
    COALESCE(tipo_deposito_id, 0::smallint)
  );
