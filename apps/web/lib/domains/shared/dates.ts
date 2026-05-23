/**
 * Defensive date conversion para resultados de postgres-js.
 *
 * Postgres-js puede devolver TIMESTAMPTZ como Date O string segun config.
 * Nuestro codigo asumia siempre Date y llamaba .toISOString() — crash
 * con TypeError si era string.
 *
 * Esta funcion acepta cualquiera y siempre devuelve ISO 8601 string.
 */

export function toIso(v: unknown): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  }
  if (typeof v === "number") return new Date(v).toISOString();
  return new Date().toISOString();
}
