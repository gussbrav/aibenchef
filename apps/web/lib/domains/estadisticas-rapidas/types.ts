export type SubsistemasSF =
  | "BANCOS"
  | "FINANCIERAS"
  | "CMAC"
  | "CRAC"
  | "EDPYMES";

export type NivelCOOPAC =
  | "COOPAC_N1"
  | "COOPAC_N2A"
  | "COOPAC_N2B"
  | "COOPAC_N3";

export const LABEL_SUBSISTEMA: Record<SubsistemasSF, string> = {
  BANCOS: "Bancos",
  FINANCIERAS: "Financieras",
  CMAC: "Cajas Municipales",
  CRAC: "Cajas Rurales",
  EDPYMES: "EDPYMES",
};

export const LABEL_NIVEL: Record<NivelCOOPAC, string> = {
  COOPAC_N1: "Nivel 1",
  COOPAC_N2A: "Nivel 2A",
  COOPAC_N2B: "Nivel 2B",
  COOPAC_N3: "Nivel 3",
};

/** Fila de estadísticas para una entidad del Sistema Financiero. */
export type FilaSF = {
  periodo: number;
  nomb_correg: string;
  tipo_entidad: SubsistemasSF;
  /** Cartera de créditos directa bruta (S/) */
  cartera_bruta: number | null;
  /** Depósitos totales (S/) */
  depositos_total: number | null;
  /** Mora atrasados / directos — oficial SBS (0-1) */
  mora_pct: number | null;
  /** Provisiones / cartera atrasada — oficial SBS (0-1) */
  cobertura_pct: number | null;
  /** Castigos acumulados 12 meses (S/) */
  castigos_12m: number | null;
  /** ROE anualizado — oficial SBS (0-1) */
  roe_pct: number | null;
  /** ROA anualizado — oficial SBS (0-1) */
  roa_pct: number | null;
  /** Rendimiento de cartera (% sobre cartera prom TTM) (0-1) */
  rendimiento_pct: number | null;
  /** Costo de fondeo (% sobre cartera prom TTM) (0-1) */
  fondeo_pct: number | null;
};

/** Fila de estadísticas para una entidad COOPAC. */
export type FilaCOOPAC = {
  /** Periodo de cierre de esta fila (puede variar por nivel). */
  periodo: number;
  nomb_correg: string;
  tipo_entidad: NivelCOOPAC;
  /** Créditos directos brutos (S/) */
  cartera_bruta: number | null;
  /** Obligaciones con socios + ahorro (S/) */
  depositos_sbs: number | null;
  /** Total activo (S/) */
  total_activo: number | null;
  /** Patrimonio neto (S/) */
  patrimonio: number | null;
  /** Utilidad neta YTD (S/) */
  utilidad_neta: number | null;
  /** Cartera atrasada / cartera bruta (0-1) */
  mora_pct: number | null;
  /** Provisiones / cartera atrasada (0-1) */
  cobertura_pct: number | null;
  /** ROE = utilidad neta / patrimonio (0-1) */
  roe: number | null;
  /** ROA = utilidad neta / total activo (0-1) */
  roa: number | null;
};

export type PeriodoItem = {
  periodo: number;
  label: string;
};

/**
 * Posición de una entidad en la matriz de trayectoria:
 *   - (x_actual, y_actual) : posición actual en los dos ejes elegidos.
 *   - (x_prev, y_prev)     : posición al periodo de comparación (ventana atrás).
 *   - peso                 : tamaño/importancia (patrimonio) para el radio del dot.
 *
 * Si la entidad no tenía datos en el periodo de comparación, x_prev/y_prev son
 * NULL y se renderiza sólo el punto actual (sin flecha).
 */
export type TrayectoriaEntidad = {
  nomb_correg: string;
  tipo_entidad: NivelCOOPAC | SubsistemasSF;
  x_actual: number;
  y_actual: number;
  x_prev: number | null;
  y_prev: number | null;
  peso: number | null;
  /** Periodo de la medición actual (YYYYMM). */
  periodo_actual: number;
  /** Periodo de la medición previa (YYYYMM), o null si no hay comparación. */
  periodo_prev: number | null;
};

/** Métricas disponibles para los ejes de la matriz. */
export type EjeMetrica = "roe" | "roa" | "mora" | "cobertura";

export const LABEL_EJE: Record<EjeMetrica, string> = {
  roe: "ROE",
  roa: "ROA",
  mora: "Mora",
  cobertura: "Cobertura",
};

/**
 * Definición del eje: label + si el valor "alto" es bueno (invierte interpretación
 * de cuadrantes). Para MORA, alto = malo; para ROE/ROA/COBERTURA, alto = bueno.
 */
export const EJE_ALTO_ES_BUENO: Record<EjeMetrica, boolean> = {
  roe: true,
  roa: true,
  mora: false,
  cobertura: true,
};
