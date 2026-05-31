/**
 * Seed canonico del business glossary.
 *
 * Source-of-truth: skill `.claude/skills/aibenchef-sbs/SKILL.md`. Cualquier
 * cambio aca debe sincronizarse con el skill (y viceversa).
 *
 * NO contiene TODAS las cuentas — solo las mas frecuentes y los conceptos
 * de alto nivel. El user puede agregar mas via UI /dashboard/admin/glossary.
 */

import type { GlossaryEntryInput } from "./types";

export const CANONICAL_GLOSSARY_SEED: GlossaryEntryInput[] = [
  // ============== marts.mv_eeff_balance_ancho ==============
  {
    schemaName: "marts",
    tableName: "mv_eeff_balance_ancho",
    columnName: null,
    displayName: "Balance General — Ancho",
    description:
      "Pivot de cuentas del Balance General SBS por entidad y periodo. Una fila por (entidad, periodo, moneda), una columna por cuenta canonica (cta_a1, cta_b1, cta_c1).",
    category: "financial",
    source: "marts/eeff/mv_eeff_balance_ancho.sql",
  },
  {
    schemaName: "marts",
    tableName: "mv_eeff_balance_ancho",
    columnName: "periodo",
    displayName: "Periodo",
    description: "Periodo YYYYMM (entero). Ej. 202403 = marzo 2024.",
    category: "dimension",
  },
  {
    schemaName: "marts",
    tableName: "mv_eeff_balance_ancho",
    columnName: "nomb_correg",
    displayName: "Entidad (nombre canonico)",
    description:
      "Nombre normalizado de la entidad SBS. Ej. 'CMAC Arequipa'. Resuelto via dw.resolver_nomb_correg_canonico().",
    category: "dimension",
  },
  {
    schemaName: "marts",
    tableName: "mv_eeff_balance_ancho",
    columnName: "moneda",
    displayName: "Moneda",
    description: "Moneda nacional (MN), extranjera (ME) o TOTAL.",
    category: "dimension",
  },

  // ============== marts.mv_eeff_resultados_ancho ==============
  {
    schemaName: "marts",
    tableName: "mv_eeff_resultados_ancho",
    columnName: null,
    displayName: "Estado de Resultados — Ancho",
    description:
      "Pivot del Estado de Resultados YTD (acumulado anual desde enero) por entidad y periodo. Para anualizar, ver formula TTM en v_kpis_anuales_entidad.",
    category: "financial",
  },
  {
    schemaName: "marts",
    tableName: "mv_eeff_resultados_ancho",
    columnName: "cta_17",
    displayName: "Utilidad Neta YTD",
    description:
      "Utilidad/perdida neta del ejercicio, acumulada desde enero del anio en curso. NO es mensual ni anualizada.",
    category: "financial",
    formula: "Ingresos - Gastos + Resultados extraordinarios - Impuestos",
    appliesTo: ["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"],
  },
  {
    schemaName: "marts",
    tableName: "mv_eeff_resultados_ancho",
    columnName: "cta_1",
    displayName: "Ingresos Financieros YTD",
    description:
      "Ingresos por intereses, comisiones e ingresos financieros relacionados, acumulados desde enero.",
    category: "financial",
  },
  {
    schemaName: "marts",
    tableName: "mv_eeff_resultados_ancho",
    columnName: "cta_2",
    displayName: "Gastos Financieros YTD",
    description: "Gastos por intereses sobre depositos y obligaciones financieras, acumulados desde enero.",
    category: "financial",
  },

  // ============== marts.v_kpis_anuales_entidad ==============
  {
    schemaName: "marts",
    tableName: "v_kpis_anuales_entidad",
    columnName: null,
    displayName: "KPIs Anualizados por Entidad",
    description:
      "Vista con la utilidad TTM (Trailing Twelve Months) y promedios 12m para calcular ROA, ROE, Eficiencia. Construida con la formula V092.",
    category: "financial",
    source: "infrastructure/postgres/migrations/V092__kpis_anuales_dual_formula_cmac_bug.sql",
  },
  {
    schemaName: "marts",
    tableName: "v_kpis_anuales_entidad",
    columnName: "utilidad_ttm",
    displayName: "Utilidad Neta TTM (12 meses moviles)",
    description:
      "Suma de la utilidad neta de los ultimos 12 meses cerrados en el periodo. Calculado des-acumulando el YTD: TTM(p) = YTD(p) + YTD(dic anio previo) - YTD(mismo mes anio previo). En enero: TTM = YTD(dic anio previo).",
    category: "calculated",
    formula:
      "Si mes != enero: YTD_actual + YTD_diciembre_previo - YTD_mismo_mes_previo. Si enero: YTD_diciembre_previo.",
    exampleUsage: "Sumar utilidad_ttm de todas las CMACs al periodo 202603 da la utilidad TTM del peer group.",
  },
  {
    schemaName: "marts",
    tableName: "v_kpis_anuales_entidad",
    columnName: "patrimonio_prom_12m",
    displayName: "Patrimonio Promedio 12 meses",
    description: "Promedio del patrimonio neto en los 12 meses moviles. Denominador del ROE.",
    category: "calculated",
    formula: "AVG(patrimonio) sobre 12 cierres mensuales previos",
  },
  {
    schemaName: "marts",
    tableName: "v_kpis_anuales_entidad",
    columnName: "activos_prom_12m",
    displayName: "Activos Promedio 12 meses",
    description: "Promedio de los activos en los 12 meses moviles. Denominador del ROA.",
    category: "calculated",
    formula: "AVG(activos) sobre 12 cierres mensuales previos",
  },

  // ============== Ratios y metricas regulatorias ==============
  {
    schemaName: "marts",
    tableName: "indicadores",
    columnName: "roe",
    displayName: "ROE — Return on Equity",
    description: "Rentabilidad sobre patrimonio. Mide la rentabilidad de los accionistas.",
    category: "ratio",
    formula: "Utilidad TTM / Patrimonio promedio 12m",
    exampleUsage: "ROE > 15% es considerado alto en microfinanzas peruanas.",
  },
  {
    schemaName: "marts",
    tableName: "indicadores",
    columnName: "roa",
    displayName: "ROA — Return on Assets",
    description: "Rentabilidad sobre activos. Mide la eficiencia del uso de los activos.",
    category: "ratio",
    formula: "Utilidad TTM / Activos promedio 12m",
  },
  {
    schemaName: "marts",
    tableName: "indicadores",
    columnName: "ratio_mora",
    displayName: "Cartera Atrasada (% Mora)",
    description:
      "Porcentaje de la cartera de creditos que esta en mora (con atraso > 30 dias). Indicador clave de calidad de cartera.",
    category: "ratio",
    formula: "Cartera atrasada / Cartera bruta",
  },
  {
    schemaName: "marts",
    tableName: "indicadores",
    columnName: "cobertura_car",
    displayName: "Cobertura de Cartera de Alto Riesgo",
    description: "Que % de la cartera de alto riesgo (atrasada + refinanciada) esta cubierta por provisiones.",
    category: "ratio",
    formula: "Provisiones / Cartera atrasada y refinanciada",
  },

  // ============== raw schemas — para discoverability ==============
  {
    schemaName: "raw",
    tableName: "eeff_observacion",
    columnName: null,
    displayName: "EEFF — Observaciones crudas",
    description:
      "Una fila por (archivo .xls SBS, entidad, periodo, moneda, cuenta) extraida del parser EEFF. Source de los mv ancho.",
    category: "general",
  },
  {
    schemaName: "raw",
    tableName: "archivos_descargados",
    columnName: null,
    displayName: "Archivos SBS descargados",
    description:
      "Catalogo de los .xls SBS descargados con su estado (pendiente, procesado, error), hash sha256, y tamano.",
    category: "general",
  },

  // ============== gov.audit_log — meta-glossary ==============
  {
    schemaName: "gov",
    tableName: "audit_log",
    columnName: null,
    displayName: "Audit Log (gobernanza)",
    description:
      "Eventos auditables del sistema, append-only. RLS bloquea UPDATE/DELETE. Ver docs/adr/005-data-governance-architecture.md.",
    category: "regulatory",
  },
  {
    schemaName: "gov",
    tableName: "audit_log",
    columnName: "category",
    displayName: "Categoria",
    description:
      "Categoria canonica del evento: auth, billing, data_access, genie, ai_providers, governance, schema, admin.",
    category: "dimension",
  },
];
