/**
 * Helpers para detectar entidades "obsoletas" (sin data reciente) en los
 * selectores de entidad de todos los dashboards (informe, dupont, punto-
 * equilibrio). Fuente unica de verdad para el threshold y el formato.
 *
 * Contexto: en SBS Peru las entidades cambian de nombre a menudo (fusiones,
 * conversiones de EDPYME a Financiera, cambios de razon social). El
 * "canonico" que se dejo de reportar hace meses sigue apareciendo en la
 * lista de entidades disponibles porque tiene historia. Si el usuario la
 * elige "a ciegas" espera ver data actual y obtiene solo la histórica.
 *
 * El badge de warning previene ese error: le indica al usuario que la
 * entidad ya no reporta y sugiere buscar el canonico sucesor.
 */

/** Threshold en meses. Gap > este valor = "sin data reciente". */
export const FRESHNESS_THRESHOLD_MESES = 3;

/**
 * Diferencia en meses entre dos periodos YYYYMM.
 * Ej: gapEnMeses(202301, 202606) = 41
 */
export function gapEnMeses(desde: number, hasta: number): number {
  const aDesde = Math.floor(desde / 100);
  const mDesde = desde % 100;
  const aHasta = Math.floor(hasta / 100);
  const mHasta = hasta % 100;
  return (aHasta - aDesde) * 12 + (mHasta - mDesde);
}

/** Formatea un periodo YYYYMM como "Jun-26". */
export function fmtPeriodoLabel(codigo: number): string {
  const anio = Math.floor(codigo / 100);
  const mes = codigo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"}-${String(anio).slice(-2)}`;
}

/**
 * Max ultimoPeriodo de una lista de entidades. Usado como "punto de
 * referencia actual" para medir gap por-entidad.
 */
export function computeMaxUltimoPeriodo(
  entidades: ReadonlyArray<{ ultimoPeriodo?: number }>,
): number {
  let max = 0;
  for (const e of entidades) {
    if (e.ultimoPeriodo && e.ultimoPeriodo > max) max = e.ultimoPeriodo;
  }
  return max;
}

/**
 * True si el gap contra el max supera el threshold — la entidad ya no
 * reporta y probablemente cambio de nombre.
 */
export function esObsoleta(
  ultimoPeriodo: number | null | undefined,
  maxDisponible: number,
  thresholdMeses: number = FRESHNESS_THRESHOLD_MESES,
): boolean {
  if (!ultimoPeriodo || !maxDisponible) return false;
  return gapEnMeses(ultimoPeriodo, maxDisponible) > thresholdMeses;
}
