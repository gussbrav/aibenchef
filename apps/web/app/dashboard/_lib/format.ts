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

// ============================================================================
// Tipo de entidad — label oficial vigente SBS
// ============================================================================
//
// SBS renombra grupos de entidades periodicamente (anuncia el cambio via nota
// al pie en sus publicaciones). El codigo interno (raw.eeff_observacion.tipo_entidad)
// se mantiene estable para no romper queries historicas, pero la UI siempre
// muestra el NOMBRE OFICIAL ACTUAL.
//
// Cambios conocidos:
// - EDPYMES -> "Empresas de Créditos" (renombre vigente desde 2025)
//
// Cuando SBS publique otro renombre, actualizar este mapa.
const TIPO_ENTIDAD_LABEL: Record<string, string> = {
  BANCOS: "Bancos",
  FINANCIERAS: "Financieras",
  CMAC: "Cajas Municipales",
  CRAC: "Cajas Rurales",
  EDPYMES: "Empresas de Créditos",
};

export function tipoEntidadLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return TIPO_ENTIDAD_LABEL[code] ?? code;
}

// Orden canonico para ordenar listas/tablas por grupo (mayor escala primero).
export const TIPO_ENTIDAD_ORDER: Record<string, number> = {
  BANCOS: 1,
  FINANCIERAS: 2,
  CMAC: 3,
  CRAC: 4,
  EDPYMES: 5,
};
