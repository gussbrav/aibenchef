/**
 * Formatters compartidos por las views de dashboard.
 * Locale es-PE (separador de miles ",", decimal ".").
 */

export function formatPct(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toLocaleString("es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-PE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formato compacto en miles, millones, miles de millones.
 * Ej: 5_171_585 -> "5.17 MM" (millones). Adaptado al tamaño SBS que reporta en
 * miles de soles -> los valores ya vienen en miles.
 */
export function formatNumberCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MM`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)} M`;
  return value.toFixed(0);
}
