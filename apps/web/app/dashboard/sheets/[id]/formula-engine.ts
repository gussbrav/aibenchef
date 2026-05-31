/**
 * Motor de formulas para Sheets — soporta sintaxis tipo Excel.
 *
 * Soporta:
 * - Operadores: + - * / ( )
 * - Referencias de celda: A1, BA42 (mayusculas)
 * - Rangos: A1:A10 (lineal mismo col, mismo row, o bidimensional)
 * - Funciones agregadas: SUM, AVG, MIN, MAX, COUNT
 * - Recursion para formulas que referencian otras formulas (max depth 10)
 *
 * Seguridad: solo aritmetica simple via Function() con whitelist regex.
 */

export type CellRawValue = string | number | boolean | null | undefined;

export type FormulaResult = number | string;

const COL_RE = /^([A-Z]+)(\d+)$/;

function colLetterToIdx(letter: string): number {
  let n = 0;
  for (const ch of letter) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function idxToColLetter(idx: number): string {
  let s = "";
  let i = idx + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function parseRef(ref: string): { col: string; colIdx: number; row: number } | null {
  const m = ref.match(COL_RE);
  if (!m) return null;
  const col = m[1]!;
  return { col, colIdx: colLetterToIdx(col), row: Number(m[2]) };
}

/**
 * Expande un rango A1:B5 a todas las celdas individuales.
 * Soporta misma col, mismo row, o rectangulo bidimensional.
 */
function expandRange(start: string, end: string): string[] {
  const s = parseRef(start);
  const e = parseRef(end);
  if (!s || !e) return [];

  const minCol = Math.min(s.colIdx, e.colIdx);
  const maxCol = Math.max(s.colIdx, e.colIdx);
  const minRow = Math.min(s.row, e.row);
  const maxRow = Math.max(s.row, e.row);

  const refs: string[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      refs.push(`${idxToColLetter(c)}${r}`);
    }
  }
  return refs;
}

/**
 * Evalua una formula completa. Si no empieza con "=", devuelve el valor
 * tal cual (no es formula).
 *
 * @param raw - el valor crudo de la celda (puede ser "=A1+B1", 42, "texto")
 * @param getRaw - funcion que devuelve el valor crudo de cualquier celda
 *                 por referencia (ej "A1" -> 42, o "B2" -> "=C1+1")
 * @param depth - control de recursion para evitar ciclos infinitos
 */
export function evaluateFormula(
  raw: CellRawValue,
  getRaw: (ref: string) => CellRawValue,
  depth = 0,
): FormulaResult {
  if (depth > 10) return "#REF!";
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") return raw;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw !== "string") return String(raw);

  const trimmed = raw.trim();
  if (!trimmed.startsWith("=")) {
    // No es formula — devolver tal cual
    return raw;
  }

  // Normalizamos a mayusculas para aceptar refs en cualquier caso
  // (=c2+d2 == =C2+D2). Sin esto, el regex de Paso 2 no matcheaba las
  // refs lowercase y caian al whitelist como letras sueltas -> #ERROR.
  // Como la sintaxis no admite strings literales, el upcase es safe.
  let expr = trimmed.slice(1).trim().toUpperCase();

  // Paso 1: funciones agregadas con rango. SUM(A1:A5), AVG(A1:B10), etc.
  expr = expr.replace(
    /(SUM|AVG|AVERAGE|MIN|MAX|COUNT)\s*\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)/gi,
    (_m, fn: string, start: string, end: string) => {
      const refs = expandRange(start, end);
      const values: number[] = [];
      for (const ref of refs) {
        const v = resolveValueAsNumber(ref, getRaw, depth + 1);
        if (v !== null) values.push(v);
      }
      const F = fn.toUpperCase();
      if (values.length === 0) {
        return F === "COUNT" ? "0" : "0";
      }
      if (F === "SUM") return String(values.reduce((a, b) => a + b, 0));
      if (F === "AVG" || F === "AVERAGE") {
        return String(values.reduce((a, b) => a + b, 0) / values.length);
      }
      if (F === "MIN") return String(Math.min(...values));
      if (F === "MAX") return String(Math.max(...values));
      if (F === "COUNT") return String(values.length);
      return "0";
    },
  );

  // Paso 2: referencias individuales A1, B2, etc.
  expr = expr.replace(/[A-Z]+\d+/g, (ref) => {
    const v = resolveValueAsNumber(ref, getRaw, depth + 1);
    return v !== null ? String(v) : "0";
  });

  // Paso 3: whitelist — solo digitos, operadores, parentesis, punto, espacio
  if (!/^[\d+\-*/().\s]+$/.test(expr)) {
    return "#ERROR";
  }
  if (expr.trim().length === 0) return 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(`"use strict"; return (${expr})`);
    const result = fn();
    if (typeof result !== "number" || !Number.isFinite(result)) return "#ERROR";
    return result;
  } catch {
    return "#ERROR";
  }
}

function resolveValueAsNumber(
  ref: string,
  getRaw: (ref: string) => CellRawValue,
  depth: number,
): number | null {
  const raw = getRaw(ref);
  if (raw === null || raw === undefined || raw === "") return null;
  // Si es formula, evaluarla recursivamente
  if (typeof raw === "string" && raw.trim().startsWith("=")) {
    const result = evaluateFormula(raw, getRaw, depth);
    const n = typeof result === "number" ? result : Number(result);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
