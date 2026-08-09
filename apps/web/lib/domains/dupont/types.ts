/**
 * Tipos del Analisis DuPont — descomposicion jerarquica del ROE.
 *
 * Estructura del arbol:
 *   ROE = ROA × Apalancamiento
 *   ROA = Margen Op Neto + Otros Ing Netos + Impuestos    (todos % activo prom)
 *   MON = MFB + ISF Netos + Personal + Generales + Provisiones
 *   MFB = Ing Cartera + Ing Inversion + Gastos Financieros
 *
 * Todos los ratios son TTM (Trailing Twelve Months) normalizados por
 * activos_prom_12m — excepto ROE que usa patrimonio_prom_12m y
 * Apalancamiento que es un ratio adimensional.
 */

export type DupontRow = {
  entidad: string;
  periodo: number;

  // Nivel 1 — Rentabilidad
  roePct: number | null;
  roaPct: number | null;
  apalancamiento: number | null;

  // Nivel 2 — Descomposicion ROA
  margenOpPct: number | null;
  otrosIngPct: number | null;
  impuestosPct: number | null;

  // Nivel 3 — Descomposicion Margen Op Neto
  mfbPct: number | null;
  isfnPct: number | null;
  personalPct: number | null;
  generalesPct: number | null;
  provisionesPct: number | null;

  // Nivel 4 — Descomposicion MFB
  ingCarteraPct: number | null;
  ingInversionPct: number | null;
  gastosFinPct: number | null;
};

export type DupontData = {
  /** Ordenados como el usuario los pidio (respeta drag/drop en URL) */
  entidades: Array<{ nombCorreg: string; labelCorto: string; color: string }>;
  /** Periodos en orden cronologico ascendente (mas viejo primero) */
  periodos: Array<{ codigo: number; label: string }>;
  /** Matriz [entidad][periodo] indexada por (entidad.nombCorreg, periodo.codigo) */
  filas: DupontRow[];
};

export type DupontOpts = {
  entidades: string[];
  periodos: number[];
  consolidar?: boolean;
  colorsOverride?: Map<string, string> | null;
};
