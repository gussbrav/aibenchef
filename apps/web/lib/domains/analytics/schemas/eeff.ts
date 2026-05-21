/**
 * Drizzle schemas de las vistas materializadas marts.*
 *
 * Las vistas son auto-generadas por data-platform/scripts/generate_marts_sql.py
 * desde los seeds de cuentas. Aqui definimos solo las columnas DIMENSIONALES y
 * las metricas CANONICAS de ratios. Las ~92 columnas cta_<codigo> del wide
 * format se consumen via raw SQL desde queries.ts cuando son necesarias.
 */

import {
  pgMaterializedView,
  pgSchema,
  text,
  integer,
  date,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

export const martsSchema = pgSchema("marts");

/**
 * marts.mv_eeff_ratios — KPIs canonicos por (periodo, entidad, moneda).
 * Replica los CalculatedMembers del cubo Mondrian legacy + ROA, ROE, apalancamiento.
 */
export const mvEeffRatios = martsSchema.materializedView("mv_eeff_ratios", {
  periodo: integer("periodo").notNull(),
  fechaCierre: date("fecha_cierre").notNull(),
  nombCorreg: text("nomb_correg").notNull(),
  empresaSbs: text("empresa_sbs"),
  tipoEntidad: text("tipo_entidad").notNull(),
  microfinanciera: text("microfinanciera"),
  nacional: text("nacional"),
  moneda: text("moneda").notNull(),

  // Valores base
  totalActivo: numeric("total_activo"),
  totalPasivo: numeric("total_pasivo"),
  patrimonio: numeric("patrimonio"),
  utilidadNeta: numeric("utilidad_neta"),

  // Balance ratios
  carteraBruta: numeric("cartera_bruta"),
  ratioMora: numeric("ratio_mora"),
  ratioCoberturaAtrasados: numeric("ratio_cobertura_atrasados"),
  ratioCoberturaCar: numeric("ratio_cobertura_car"),
  depositosSbs: numeric("depositos_sbs"),
  totalFondeo: numeric("total_fondeo"),
  ratioAhorrosSobreFondeo: numeric("ratio_ahorros_sobre_fondeo"),

  // Resultados ratios
  gastoFondeo: numeric("gasto_fondeo"),
  ingresosTotales: numeric("ingresos_totales"),
  ratioEficiencia: numeric("ratio_eficiencia"),

  // Rentabilidad
  roa: numeric("roa"),
  roe: numeric("roe"),
  apalancamiento: numeric("apalancamiento"),
}).existing();
