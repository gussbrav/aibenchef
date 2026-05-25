/**
 * Domain: Estado de Resultados Acumulado (replica visual del PPT directorio).
 *
 * Los EEFF mensuales SBS ya vienen acumulados YTD (estandar contable peruano:
 * cada mes es la sumatoria desde enero). Por tanto basta con:
 *   1. Query directo a mv_eeff_resultados_ancho por (entidad, periodo)
 *   2. Mismo query para periodo-12 (mismo mes anio anterior)
 *   3. Calcular Var S/, Var %, AV% (vs Ingresos Financieros = cta_1)
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError } from "@/lib/domains/shared";

export type ERFila = {
  codigo: string;            // "1", "2.1", "10.3", etc.
  nombre: string;            // "INGRESOS FINANCIEROS"
  nivel: number;             // 1 = subtotal/seccion principal, 2 = detalle
  esSubtotal: boolean;       // si true -> negrita
  esCalculado: boolean;      // si true -> calculado en codigo (no viene de SBS directo)
  // Valores
  saldoActual: number | null;
  saldoPrev: number | null;
  varAbs: number | null;     // Var S/. = actual - prev
  varPct: number | null;     // Var % = (actual - prev) / abs(prev)
  avActualPct: number | null; // % vs Ingresos Financieros del periodo actual
  avPrevPct: number | null;   // idem periodo previo
};

export type ERAcumuladoData = {
  entidad: string;           // nomb_correg
  periodoActual: { codigo: number; label: string }; // YYYYMM
  periodoPrev: { codigo: number; label: string };
  moneda: "MN" | "ME" | "TOTAL";
  filas: ERFila[];
  source: "marts.mv_eeff_resultados_ancho";
};

// Mapping codigo SBS -> info de display (label + level + subtotal).
// El orden de este array define el orden de las filas.
type FilaSpec = {
  codigo: string;             // codigo SBS ("1", "2.1", "calc:mfb_neto_ig", etc)
  nombre: string;
  nivel: number;
  esSubtotal: boolean;
  // Si es calculada, formula: array de codigos para sumar (+ por defecto) o restar (con prefijo "-")
  // Ej: ["5", "6", "-7"] = cta_5 + cta_6 - cta_7
  formula?: string[];
};

const ER_LAYOUT: FilaSpec[] = [
  { codigo: "1",    nombre: "INGRESOS FINANCIEROS",                          nivel: 1, esSubtotal: true  },
  { codigo: "1.4",  nombre: "Ingresos de Cartera (Creditos Directos)",      nivel: 2, esSubtotal: false },
  { codigo: "1.1",  nombre: "Ingresos por Disponible",                       nivel: 2, esSubtotal: false },
  { codigo: "1.3",  nombre: "Ingresos por Inversiones",                      nivel: 2, esSubtotal: false },
  { codigo: "1.2",  nombre: "Ingresos por Fondos Interbancarios",            nivel: 2, esSubtotal: false },
  { codigo: "1.7",  nombre: "Diferencia de Cambio",                          nivel: 2, esSubtotal: false },
  { codigo: "1.10", nombre: "Otros Ingresos Financieros",                    nivel: 2, esSubtotal: false },

  { codigo: "2",    nombre: "GASTOS FINANCIEROS",                            nivel: 1, esSubtotal: true  },
  { codigo: "2.1",  nombre: "Obligaciones con el Publico",                   nivel: 2, esSubtotal: false },
  { codigo: "2.4",  nombre: "Adeudos y Obligaciones Financieras",            nivel: 2, esSubtotal: false },
  { codigo: "2.2",  nombre: "Depositos del Sistema Financiero",              nivel: 2, esSubtotal: false },
  { codigo: "2.5",  nombre: "Obligaciones en Circulacion no Subordinadas",   nivel: 2, esSubtotal: false },
  { codigo: "2.6",  nombre: "Obligaciones en Circulacion Subordinadas",      nivel: 2, esSubtotal: false },
  { codigo: "2.13", nombre: "Otros Gastos Financieros",                      nivel: 2, esSubtotal: false },

  { codigo: "3",    nombre: "MARGEN FINANCIERO BRUTO",                       nivel: 1, esSubtotal: true  },

  { codigo: "4",    nombre: "Provisiones para Creditos Directos",            nivel: 2, esSubtotal: false },

  { codigo: "5",    nombre: "MARGEN FINANCIERO NETO",                        nivel: 1, esSubtotal: true  },

  { codigo: "6",    nombre: "Ingresos por Servicios Financieros",            nivel: 2, esSubtotal: false },
  { codigo: "7",    nombre: "Gastos por Servicios Financieros",              nivel: 2, esSubtotal: false },

  // Calculados — no existen directo en SBS pero son standard de reporting
  { codigo: "calc:mfn_serv", nombre: "MARGEN FINANCIERO NETO DE INGR. Y GASTOS POR SERV.", nivel: 1, esSubtotal: true,
    formula: ["5", "6", "-7"] },

  { codigo: "8",    nombre: "Resultado por Venta de Cartera",                nivel: 2, esSubtotal: false },

  { codigo: "9",    nombre: "MARGEN OPERACIONAL",                            nivel: 1, esSubtotal: true  },

  { codigo: "10",   nombre: "GASTOS DE ADMINISTRACION",                      nivel: 1, esSubtotal: true  },
  { codigo: "10.1", nombre: "Personal",                                      nivel: 2, esSubtotal: false },
  { codigo: "10.3", nombre: "Servicios Recibidos de Terceros",               nivel: 2, esSubtotal: false },
  { codigo: "10.4", nombre: "Impuestos y Contribuciones",                    nivel: 2, esSubtotal: false },
  { codigo: "10.2", nombre: "Directorio",                                    nivel: 2, esSubtotal: false },

  { codigo: "11",   nombre: "MARGEN OPERACIONAL NETO",                       nivel: 1, esSubtotal: true  },

  { codigo: "12.7", nombre: "Depreciacion",                                  nivel: 2, esSubtotal: false },
  { codigo: "12.8", nombre: "Amortizacion",                                  nivel: 2, esSubtotal: false },

  { codigo: "calc:resultado_op", nombre: "RESULTADO DE OPERACION",          nivel: 1, esSubtotal: true,
    formula: ["11", "-12.7", "-12.8"] },

  { codigo: "13",   nombre: "Otros Ingresos y Gastos",                       nivel: 2, esSubtotal: false },

  { codigo: "14",   nombre: "RESULTADO ANTES DE IMPUESTO A LA RENTA",       nivel: 1, esSubtotal: true  },

  { codigo: "15",   nombre: "Participacion de Trabajadores",                 nivel: 2, esSubtotal: false },
  { codigo: "16",   nombre: "Impuesto a la Renta",                           nivel: 2, esSubtotal: false },

  { codigo: "17",   nombre: "RESULTADO NETO DEL EJERCICIO",                  nivel: 1, esSubtotal: true  },
];

function codigoToColumn(codigo: string): string {
  // "1" -> "cta_1", "2.1" -> "cta_2_1", "10.3" -> "cta_10_3"
  return `cta_${codigo.replace(/\./g, "_")}`;
}

function periodoLabel(periodo: number): string {
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${meses[mes - 1] ?? mes}-${String(anio).slice(2)}`;
}

function periodoMismoMesAnioPrev(periodo: number): number {
  return periodo - 100;
}

function varPct(actual: number | null, prev: number | null): number | null {
  if (actual === null || prev === null || prev === 0) return null;
  return (actual - prev) / Math.abs(prev);
}

function avPct(valor: number | null, base: number | null): number | null {
  if (valor === null || base === null || base === 0) return null;
  return valor / Math.abs(base);
}

export async function getEstadoResultadosAcumulado(opts: {
  entidad: string;
  periodo: number;
  moneda?: "MN" | "ME" | "TOTAL";
}): Promise<ERAcumuladoData> {
  const moneda = opts.moneda ?? "TOTAL";
  const periodoPrev = periodoMismoMesAnioPrev(opts.periodo);

  // Fetch ambos periodos en paralelo
  const [actualRows, prevRows] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      SELECT *
      FROM marts.mv_eeff_resultados_ancho
      WHERE nomb_correg = ${opts.entidad}
        AND periodo = ${opts.periodo}
        AND moneda = ${moneda}
      LIMIT 1
    `),
    db.execute<Record<string, unknown>>(sql`
      SELECT *
      FROM marts.mv_eeff_resultados_ancho
      WHERE nomb_correg = ${opts.entidad}
        AND periodo = ${periodoPrev}
        AND moneda = ${moneda}
      LIMIT 1
    `),
  ]);

  if (actualRows.length === 0) {
    throw new NotFoundError(
      `No hay datos ER para ${opts.entidad} en ${opts.periodo} (${moneda})`,
      { entidad: opts.entidad, periodo: opts.periodo, moneda },
    );
  }

  const rowActual = actualRows[0]!;
  const rowPrev = prevRows[0] ?? {};

  // Helper: leer un valor crudo o calcular formula
  const getVal = (row: Record<string, unknown>, spec: FilaSpec): number | null => {
    if (!spec.formula) {
      const col = codigoToColumn(spec.codigo);
      const v = row[col];
      if (v === null || v === undefined) return null;
      return Number(v);
    }
    // Calculo: sumar/restar segun signo
    let total = 0;
    let hasAny = false;
    for (const item of spec.formula) {
      const negative = item.startsWith("-");
      const codigo = negative ? item.slice(1) : item;
      const col = codigoToColumn(codigo);
      const v = row[col];
      if (v !== null && v !== undefined) {
        total += (negative ? -1 : 1) * Number(v);
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  };

  // Base para AV%: Ingresos Financieros (cta_1)
  const baseActual = Number(rowActual["cta_1"] ?? 0) || null;
  const basePrev = Number(rowPrev["cta_1"] ?? 0) || null;

  const filas: ERFila[] = ER_LAYOUT.map((spec) => {
    const saldoActual = getVal(rowActual, spec);
    const saldoPrev = getVal(rowPrev, spec);
    return {
      codigo: spec.codigo,
      nombre: spec.nombre,
      nivel: spec.nivel,
      esSubtotal: spec.esSubtotal,
      esCalculado: !!spec.formula,
      saldoActual,
      saldoPrev,
      varAbs: saldoActual !== null && saldoPrev !== null ? saldoActual - saldoPrev : null,
      varPct: varPct(saldoActual, saldoPrev),
      avActualPct: avPct(saldoActual, baseActual),
      avPrevPct: avPct(saldoPrev, basePrev),
    };
  });

  return {
    entidad: opts.entidad,
    periodoActual: { codigo: opts.periodo, label: periodoLabel(opts.periodo) },
    periodoPrev: { codigo: periodoPrev, label: periodoLabel(periodoPrev) },
    moneda,
    filas,
    source: "marts.mv_eeff_resultados_ancho",
  };
}
