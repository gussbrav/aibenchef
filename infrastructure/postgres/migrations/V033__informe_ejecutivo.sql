-- =========================================================================
-- V033: Soporte para "Informe Ejecutivo Aibenchef"
--
-- Base de datos para el producto principal: dashboard interactivo que
-- replica el deliverable Caja Arequipa (45 secciones) con opcion de
-- exportar a PPT/PDF como add-on.
--
-- Crea:
--   - schema config.* con cliente, peer_group, branding, comentarios
--   - marts.dim_kpi con el catalogo de KPIs derivados
--   - marts.fact_kpis_mensuales como contenedor long-format
--   - Seeds con cliente demo "Caja Arequipa" y su peer group
--
-- Ver docs/PRODUCT_VISION.md para el roadmap completo.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS config;

-- ----------------------------------------------------------------------
-- config.cliente: institucion que paga el SaaS (no usuario individual)
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config.cliente (
    id                          BIGSERIAL PRIMARY KEY,
    slug                        TEXT NOT NULL UNIQUE,
    nombre                      TEXT NOT NULL,
    nombre_corto                TEXT NOT NULL,
    entidad_propia_nomb_correg  TEXT NOT NULL,
    con_ifis                    BOOLEAN NOT NULL DEFAULT TRUE,
    activo                      BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_inicio_contrato       DATE,
    notas                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE config.cliente IS 'Institucion financiera que paga el SaaS Aibenchef.';
COMMENT ON COLUMN config.cliente.entidad_propia_nomb_correg IS 'nomb_correg en dw.dim_entidad que representa al cliente.';
COMMENT ON COLUMN config.cliente.con_ifis IS 'Si TRUE, los EEFF consolidan subsidiarias/ifis.';

-- ----------------------------------------------------------------------
-- config.peer_group: los competidores del cliente para el benchmark
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config.peer_group (
    cliente_id                BIGINT NOT NULL REFERENCES config.cliente(id) ON DELETE CASCADE,
    competidor_nomb_correg    TEXT NOT NULL,
    orden                     INT NOT NULL,
    color_hex                 TEXT NOT NULL,
    label_corto               TEXT,
    PRIMARY KEY (cliente_id, competidor_nomb_correg)
);

CREATE INDEX IF NOT EXISTS idx_peer_group_cliente ON config.peer_group (cliente_id, orden);

COMMENT ON TABLE config.peer_group IS 'Competidores del cliente que aparecen en su informe ejecutivo.';
COMMENT ON COLUMN config.peer_group.color_hex IS 'Color de serie en charts. Incluye al cliente con su color brand.';

-- ----------------------------------------------------------------------
-- config.cliente_branding: logo + paleta para personalizar la UI
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config.cliente_branding (
    cliente_id        BIGINT PRIMARY KEY REFERENCES config.cliente(id) ON DELETE CASCADE,
    logo_url          TEXT,
    color_primary     TEXT NOT NULL DEFAULT '#0F2A5E',
    color_secondary   TEXT NOT NULL DEFAULT '#FFB300',
    color_acento      TEXT NOT NULL DEFAULT '#2563EB',
    font_family       TEXT NOT NULL DEFAULT 'Inter',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE config.cliente_branding IS 'Branding visual del cliente para dashboard y PPT exportado.';

-- ----------------------------------------------------------------------
-- config.comentario_ejecutivo: las cajas azules con texto al lado de
-- cada slide. Editables por admin del cliente (o generados por IA).
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config.comentario_ejecutivo (
    id              BIGSERIAL PRIMARY KEY,
    cliente_id      BIGINT NOT NULL REFERENCES config.cliente(id) ON DELETE CASCADE,
    periodo         INT NOT NULL,
    seccion         TEXT NOT NULL,
    texto           TEXT NOT NULL,
    generado_por    TEXT NOT NULL DEFAULT 'manual' CHECK (generado_por IN ('manual', 'ia')),
    publicado       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cliente_id, periodo, seccion)
);

CREATE INDEX IF NOT EXISTS idx_comentario_cliente_periodo
    ON config.comentario_ejecutivo (cliente_id, periodo);

COMMENT ON TABLE config.comentario_ejecutivo IS 'Texto editorial en la caja azul al lado de cada seccion.';
COMMENT ON COLUMN config.comentario_ejecutivo.seccion IS 'cuadro_resumen | punto_equilibrio | margen_neto_waterfall | mora_global | etc.';

-- ----------------------------------------------------------------------
-- marts.dim_kpi: catalogo de KPIs derivados
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marts.dim_kpi (
    codigo         TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    unidad         TEXT NOT NULL CHECK (unidad IN ('pct', 'numero', 'numero_miles', 'moneda_mm', 'moneda_miles', 'pp')),
    formato        TEXT NOT NULL DEFAULT '0.00%',
    signo          INT NOT NULL DEFAULT 1 CHECK (signo IN (-1, 1)),
    seccion        TEXT NOT NULL,
    orden          INT NOT NULL,
    descripcion    TEXT,
    formula        TEXT
);

COMMENT ON TABLE marts.dim_kpi IS 'Catalogo de KPIs derivados usados en el informe ejecutivo.';
COMMENT ON COLUMN marts.dim_kpi.signo IS '+1 si valor alto es bueno (rendimiento), -1 si es malo (costos, mora).';
COMMENT ON COLUMN marts.dim_kpi.unidad IS 'pct = porcentaje; pp = puntos porcentuales (delta); numero = unidades; numero_miles; moneda_mm = millones soles.';

-- ----------------------------------------------------------------------
-- marts.fact_kpis_mensuales: long-format de KPIs precomputados
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marts.fact_kpis_mensuales (
    periodo        INT NOT NULL,
    nomb_correg    TEXT NOT NULL,
    moneda         TEXT NOT NULL DEFAULT 'TOTAL' CHECK (moneda IN ('MN', 'ME', 'TOTAL')),
    kpi_codigo     TEXT NOT NULL REFERENCES marts.dim_kpi(codigo),
    valor          NUMERIC(20, 8),
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (periodo, nomb_correg, moneda, kpi_codigo)
);

CREATE INDEX IF NOT EXISTS idx_fact_kpis_periodo
    ON marts.fact_kpis_mensuales (periodo);
CREATE INDEX IF NOT EXISTS idx_fact_kpis_codigo
    ON marts.fact_kpis_mensuales (kpi_codigo, periodo);
CREATE INDEX IF NOT EXISTS idx_fact_kpis_entidad
    ON marts.fact_kpis_mensuales (nomb_correg, periodo);

COMMENT ON TABLE marts.fact_kpis_mensuales IS 'KPIs derivados precomputados (long-format). 1 fila por (periodo, entidad, moneda, kpi).';

-- ----------------------------------------------------------------------
-- Seed dim_kpi: catalogo inicial basado en el benchmark Caja Arequipa
-- ----------------------------------------------------------------------

INSERT INTO marts.dim_kpi (codigo, nombre, unidad, formato, signo, seccion, orden, descripcion, formula) VALUES
    -- Punto de Equilibrio (slide 6 del PPT) - los 10 indicadores
    ('pe_rendimiento_cartera', '%Rendimiento de Cartera', 'pct', '0.00%', 1, 'punto_equilibrio', 1,
     'Ingresos por creditos directos sobre cartera promedio 12m',
     '(ER_1_4 trailing 12m) / cartera_promedio_12m'),
    ('pe_costo_fondeo', '%Costo Fondeo', 'pct', '0.00%', -1, 'punto_equilibrio', 2,
     'Gasto financiero anualizado sobre cartera promedio',
     '-(ER_2 trailing 12m) / cartera_promedio_12m'),
    ('pe_costo_provisiones', '%Costo Provisiones Creditos', 'pct', '0.00%', -1, 'punto_equilibrio', 3,
     'Provisiones para incobrabilidad sobre cartera promedio',
     '-(ER_4 trailing 12m) / cartera_promedio_12m'),
    ('pe_gastos_operacionales', '%Gastos Operacionales', 'pct', '0.00%', -1, 'punto_equilibrio', 4,
     'Gastos admin + depr + amort sobre cartera promedio',
     '-(ER_10 + ER_12_7 + ER_12_8) trailing 12m / cartera_promedio_12m'),
    ('pe_gastos_personal', '%Gastos de Personal', 'pct', '0.00%', -1, 'punto_equilibrio', 5,
     'Subcomponente de gastos operacionales',
     '-(ER_10_1) trailing 12m / cartera_promedio_12m'),
    ('pe_gastos_generales', '%Gastos Generales', 'pct', '0.00%', -1, 'punto_equilibrio', 6,
     'Servicios terceros + impuestos',
     '-(ER_10_3 + ER_10_4) trailing 12m / cartera_promedio_12m'),
    ('pe_deprec_amortiz', '%Deprec. y Amortiz.', 'pct', '0.00%', -1, 'punto_equilibrio', 7,
     'Depreciacion y amortizacion del periodo',
     '-(ER_12_7 + ER_12_8) trailing 12m / cartera_promedio_12m'),
    ('pe_otros_ing_egr', '%Otros Ingresos (Egresos)', 'pct', '0.00%', 1, 'punto_equilibrio', 8,
     'Ingresos y gastos no financieros netos',
     '+(ER_6 - ER_7 + ER_8 + ER_13) trailing 12m / cartera_promedio_12m'),
    ('pe_punto_equilibrio', '%Punto de Equilibrio', 'pct', '0.00%', -1, 'punto_equilibrio', 9,
     'Suma de costos: fondeo + provisiones + gastos op (negativo)',
     'pe_costo_fondeo + pe_costo_provisiones + pe_gastos_operacionales'),
    ('pe_margen_neto', '%Margen Neto', 'pct', '0.00%', 1, 'punto_equilibrio', 10,
     'Resultado economico del negocio sobre cartera',
     'pe_rendimiento_cartera + pe_punto_equilibrio + pe_otros_ing_egr'),

    -- Cuadro Resumen (slide 5) - subset critico
    ('cr_n_oficinas', 'N de agencias', 'numero', '0,0', 1, 'cuadro_resumen', 1,
     'Numero de agencias/oficinas (reporte SBS Oficinas)', NULL),
    ('cr_n_clientes', 'N de Clientes (Miles)', 'numero_miles', '0,0', 1, 'cuadro_resumen', 2,
     'Miles de clientes de credito', NULL),
    ('cr_n_personal', 'N de personal', 'numero', '0,0', 1, 'cuadro_resumen', 3,
     'Empleados totales (reporte SBS Personal)', NULL),
    ('cr_part_colocaciones', '% Part. Colocaciones en SMF', 'pct', '0.00%', 1, 'cuadro_resumen', 4,
     'Market share del cliente en colocaciones del Sistema Microfinanciero',
     'cartera_bruta / total_smf'),
    ('cr_part_depositos', '% Part. Depositos en SMF', 'pct', '0.00%', 1, 'cuadro_resumen', 5,
     'Market share del cliente en depositos del SMF',
     'depositos_total / depositos_smf'),
    ('cr_cartera_bruta', 'Cartera Bruta (MM S/)', 'moneda_mm', '0,0', 1, 'cuadro_resumen', 6,
     'Saldo cartera bruta en millones de soles', NULL),
    ('cr_crec_cartera_bruta', 'Crec. Cartera Bruta (%)', 'pct', '0.00%', 1, 'cuadro_resumen', 7,
     'Crecimiento interanual de cartera bruta',
     '(cartera_M / cartera_M-12) - 1'),
    ('cr_cartera_mype', 'Cartera MYPE (%)', 'pct', '0.00%', 1, 'cuadro_resumen', 8,
     'Cartera MYPE sobre cartera total',
     'cartera_mype / cartera_bruta'),
    ('cr_credito_prom', 'Credito Prom. por Cliente (Miles S/)', 'moneda_miles', '0,0', 1, 'cuadro_resumen', 9,
     'Credito promedio por cliente',
     'cartera_bruta / n_clientes'),
    ('cr_mora_global', '% Mora Global', 'pct', '0.00%', -1, 'cuadro_resumen', 10,
     'Cartera atrasada / cartera bruta', NULL),
    ('cr_mora_global_con_vc', '% Mora Global (con v/c)', 'pct', '0.00%', -1, 'cuadro_resumen', 11,
     'Mora ajustada incluyendo venta de cartera', NULL),
    ('cr_cobertura_car', 'Cobertura Cartera Alto Riesgo (%)', 'pct', '0.00%', 1, 'cuadro_resumen', 12,
     'Provisiones / cartera alto riesgo', NULL),
    ('cr_gastos_op_mg_bruto', 'Gastos Oper./ Margen Bruto', 'pct', '0.00%', -1, 'cuadro_resumen', 13,
     'Ratio de eficiencia',
     'gastos_op_anual / margen_bruto_anual'),
    ('cr_inof_neto_ing_fin', '% INOF Neto/ Ingreso Financiero', 'pct', '0.00%', 1, 'cuadro_resumen', 14,
     'Ingresos no operativos netos sobre ingreso financiero',
     '(ER_6 - ER_7) / ER_1'),
    ('cr_cartera_x_agencia', 'Cartera x Agencia (Miles S/)', 'moneda_miles', '0,0', 1, 'cuadro_resumen', 15,
     'Cartera bruta dividida por numero de agencias',
     'cartera_bruta / n_oficinas'),
    ('cr_cartera_x_empleado', 'Cartera x Empleado (Miles S/)', 'moneda_miles', '0,0', 1, 'cuadro_resumen', 16,
     'Cartera bruta dividida por numero de personal',
     'cartera_bruta / n_personal'),
    ('cr_n_clientes_x_empleado', 'N Clientes x Empleado', 'numero', '0,0', 1, 'cuadro_resumen', 17,
     'Clientes por empleado',
     'n_clientes / n_personal'),
    ('cr_utilidad', 'Utilidad (MM S/)', 'moneda_mm', '0,0', 1, 'cuadro_resumen', 18,
     'Utilidad neta anualizada en MM S/', NULL),
    ('cr_roe', 'ROE (%)', 'pct', '0.00%', 1, 'cuadro_resumen', 19,
     'Return on Equity',
     'utilidad_anual / patrimonio_promedio'),
    ('cr_roa', 'ROA (%)', 'pct', '0.00%', 1, 'cuadro_resumen', 20,
     'Return on Assets',
     'utilidad_anual / activos_promedio')
ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    unidad = EXCLUDED.unidad,
    formato = EXCLUDED.formato,
    signo = EXCLUDED.signo,
    seccion = EXCLUDED.seccion,
    orden = EXCLUDED.orden,
    descripcion = EXCLUDED.descripcion,
    formula = EXCLUDED.formula;

-- ----------------------------------------------------------------------
-- Seed: cliente demo "Caja Arequipa" basado en el benchmark de referencia
-- ----------------------------------------------------------------------

INSERT INTO config.cliente (slug, nombre, nombre_corto, entidad_propia_nomb_correg, con_ifis, activo)
VALUES ('caja-arequipa', 'Caja Municipal de Ahorro y Credito Arequipa', 'Caja Arequipa', 'CMAC Arequipa', TRUE, TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO config.cliente_branding (cliente_id, color_primary, color_secondary, color_acento)
SELECT id, '#0F2A5E', '#FFB300', '#2563EB' FROM config.cliente WHERE slug = 'caja-arequipa'
ON CONFLICT (cliente_id) DO NOTHING;

INSERT INTO config.peer_group (cliente_id, competidor_nomb_correg, orden, color_hex, label_corto)
SELECT c.id, comp.nomb, comp.ord, comp.color, comp.label
FROM config.cliente c
CROSS JOIN (VALUES
    ('Financiera Compartamos', 1, '#E91E63', 'Compartamos'),
    ('Mibanco', 2, '#4CAF50', 'Mibanco'),
    ('CMAC Arequipa', 3, '#0F2A5E', 'Caja Arequipa'),
    ('CMAC Huancayo', 4, '#F44336', 'CMAC Huancayo'),
    ('CMAC Cusco', 5, '#8D6E63', 'CMAC Cusco'),
    ('CMAC Piura', 6, '#42A5F5', 'CMAC Piura')
) AS comp(nomb, ord, color, label)
WHERE c.slug = 'caja-arequipa'
ON CONFLICT (cliente_id, competidor_nomb_correg) DO NOTHING;
