/**
 * Tipos publicos del domain analytics — lo que la UI / API consumen.
 */

export type Moneda = "MN" | "ME" | "TOTAL";

export type TipoEntidad =
  | "BANCOS"
  | "FINANCIERAS"
  | "CMAC"
  | "CRAC"
  | "EDPYMES";

export interface Entidad {
  nombCorreg: string;
  empresaSbs: string | null;
  tipoEntidad: TipoEntidad | string;
  microfinanciera: boolean;
  nacional: string | null;
  primerPeriodo: number;
  ultimoPeriodo: number;
}

export interface RatioEeff {
  periodo: number;
  fechaCierre: string;
  nombCorreg: string;
  empresaSbs: string | null;
  tipoEntidad: string;
  microfinanciera: string | null;
  nacional: string | null;
  moneda: Moneda;

  totalActivo: number | null;
  totalPasivo: number | null;
  patrimonio: number | null;
  utilidadNeta: number | null;

  carteraBruta: number | null;
  ratioMora: number | null;
  ratioCoberturaAtrasados: number | null;
  ratioCoberturaCar: number | null;
  depositosSbs: number | null;
  totalFondeo: number | null;
  ratioAhorrosSobreFondeo: number | null;

  gastoFondeo: number | null;
  ingresosTotales: number | null;
  ratioEficiencia: number | null;

  roa: number | null;
  roe: number | null;
  apalancamiento: number | null;
}

export interface BalanceCuenta {
  codigo: string;
  nombre: string;
  nivel: number;
  parentCodigo: string | null;
  valor: number | null;
}

export interface BalanceEntidadPeriodo {
  periodo: number;
  nombCorreg: string;
  moneda: Moneda;
  cuentas: BalanceCuenta[];
}
