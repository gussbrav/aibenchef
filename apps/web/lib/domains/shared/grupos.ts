/**
 * Constantes compartidas para grupos de entidades financieras SBS.
 *
 * - Orden visual obligatorio en TODAS las vistas:
 *   1. Bancos (raw: banca_multiple / EEFF: BANCOS)
 *   2. Financieras (raw: financiera / EEFF: FINANCIERAS)
 *   3. Cajas Municipales (raw: cmac / EEFF: CMAC)
 *   4. Cajas Rurales (raw: crac / EEFF: CRAC)
 *   5. Empresas de Créditos (raw: edpyme / EEFF: EDPYMES) — nombre actual SBS
 *
 * "Empresas de Créditos" reemplaza el legacy "Edpymes" en display.
 * En DB la columna `tipo_entidad` sigue siendo 'EDPYMES' por compatibilidad
 * histórica; el cambio es SOLO de etiqueta visual.
 */

/** Orden en formato DB lowercase (archivos_descargados.grupo). */
export const ORDEN_GRUPOS_DB = [
  "banca_multiple",
  "financiera",
  "cmac",
  "crac",
  "edpyme",
  "coopac_n3",
  "coopac_n2b",
  "coopac_n2a",
  "coopac_n1",
] as const;

/** Orden en formato uppercase singular (tipo_entidad en raw.*_observacion). */
export const ORDEN_GRUPOS_UPPER = [
  "BANCOS",
  "FINANCIERAS",
  "CMAC",
  "CRAC",
  "EDPYMES",
  "COOPAC_N3",
  "COOPAC_N2B",
  "COOPAC_N2A",
  "COOPAC_N1",
] as const;

/** Mapping uniforme: cualquier forma del grupo → label display oficial. */
export const GRUPO_DISPLAY: Record<string, string> = {
  // Formas DB
  banca_multiple: "Bancos",
  financiera: "Financieras",
  cmac: "Cajas Municipales",
  crac: "Cajas Rurales",
  edpyme: "Empresas de Créditos",
  coopac_n3: "Cooperativas Nivel 3",
  coopac_n2b: "Cooperativas Nivel 2B",
  coopac_n2a: "Cooperativas Nivel 2A",
  coopac_n1: "Cooperativas Nivel 1",
  // Formas uppercase
  BANCOS: "Bancos",
  FINANCIERAS: "Financieras",
  CMAC: "Cajas Municipales",
  CRAC: "Cajas Rurales",
  EDPYMES: "Empresas de Créditos",
  COOPAC_N3: "Cooperativas Nivel 3",
  COOPAC_N2B: "Cooperativas Nivel 2B",
  COOPAC_N2A: "Cooperativas Nivel 2A",
  COOPAC_N1: "Cooperativas Nivel 1",
};

/** Index del grupo para ORDER BY (BANCOS=0, COOPAC_N1=8, otro=99). */
export function ordenGrupo(grupo: string | null | undefined): number {
  if (!grupo) return 99;
  const upper = grupo.toUpperCase();
  switch (upper) {
    case "BANCOS":
    case "BANCA_MULTIPLE":
      return 0;
    case "FINANCIERAS":
    case "FINANCIERA":
      return 1;
    case "CMAC":
      return 2;
    case "CRAC":
      return 3;
    case "EDPYMES":
    case "EDPYME":
      return 4;
    case "COOPAC_N3":
      return 5;
    case "COOPAC_N2B":
      return 6;
    case "COOPAC_N2A":
      return 7;
    case "COOPAC_N1":
      return 8;
    default:
      return 99;
  }
}

/** Label oficial — usar EN TODA LA UI para mostrar grupos. */
export function labelGrupo(grupo: string | null | undefined): string {
  if (!grupo) return "(sin grupo)";
  return GRUPO_DISPLAY[grupo] ?? GRUPO_DISPLAY[grupo.toUpperCase()] ?? grupo;
}
