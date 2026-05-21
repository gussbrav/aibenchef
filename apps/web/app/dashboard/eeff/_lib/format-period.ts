/**
 * Helpers para formatear periodos YYYYMM.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const MESES_CORTOS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export function formatPeriod(p: number | undefined): string {
  if (!p) return "—";
  const year = Math.floor(p / 100);
  const month = p % 100;
  return `${MESES[month - 1]} ${year}`;
}

export function formatPeriodShort(p: number | undefined): string {
  if (!p) return "—";
  const year = Math.floor(p / 100);
  const month = p % 100;
  return `${MESES_CORTOS[month - 1]} ${String(year).slice(-2)}`;
}
