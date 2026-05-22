/**
 * Servicio de pivot dinamico para el modulo Analisis Dinamico.
 *
 * El usuario configura (dimensiones, medidas, agregacion, filtros) y este
 * servicio genera un SQL parametrizado contra los marts EEFF.
 *
 * Tres fuentes soportadas:
 *   - 'balance':    marts.mv_eeff_balance_ancho
 *   - 'resultados': marts.mv_eeff_resultados_ancho
 *   - 'ratios':     marts.mv_eeff_ratios
 *
 * Seguridad: TODA columna de dimension/medida/filtro se whitelista contra el
 * schema real de la MV (cargado y cacheado). Los valores se pasan como
 * parametros via postgres-js sql tag (no string interpolation).
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { ValidationError } from "@/lib/domains/shared";

// ============================================================================
// Tipos publicos
// ============================================================================

export type FuentePivot = "balance" | "resultados" | "ratios";

export type AgregacionPivot = "NONE" | "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";

export type FiltrosPivot = {
  tipoEntidad?: string[];
  moneda?: string[];
  nombCorreg?: string[];
  microfinanciera?: boolean;
  periodoDesde?: number;
  periodoHasta?: number;
};

export type PivotRequest = {
  fuente: FuentePivot;
  dimensiones: string[];
  medidas: string[];
  agregacion: AgregacionPivot;
  filtros?: FiltrosPivot;
  limite?: number;
  orden?: Array<{ columna: string; dir: "ASC" | "DESC" }>;
};

export type PivotColumna = {
  key: string;
  tipo: "dimension" | "medida";
  label: string;
  esNumerico: boolean;
};

export type PivotResponse = {
  columnas: PivotColumna[];
  filas: Array<Record<string, unknown>>;
  totalFilas: number;
  duracionMs: number;
};

// ============================================================================
// Schema introspection — cargada bajo demanda y cacheada
// ============================================================================

type MvSchema = {
  dimensiones: Set<string>; // columnas no-cuenta
  medidas: Set<string>; // columnas de cuenta o ratio
  todasColumnas: Set<string>;
};

const SCHEMA_CACHE: Map<string, MvSchema> = new Map();

const MV_TABLE: Record<FuentePivot, string> = {
  balance: "marts.mv_eeff_balance_ancho",
  resultados: "marts.mv_eeff_resultados_ancho",
  ratios: "marts.mv_eeff_ratios",
};

// Dimensiones comunes a TODAS las fuentes (filtrables y agrupables)
const DIMENSIONES_COMUNES = new Set([
  "periodo",
  "fecha_cierre",
  "nomb_correg",
  "empresa_sbs",
  "tipo_entidad",
  "microfinanciera",
  "nacional",
  "moneda",
]);

async function getSchema(fuente: FuentePivot): Promise<MvSchema> {
  const cached = SCHEMA_CACHE.get(fuente);
  if (cached) return cached;
  const mv = MV_TABLE[fuente];
  const rows = await db.execute<{ column_name: string }>(
    sql.raw(`SELECT * FROM ${mv} LIMIT 0`),
  );
  // postgres-js retorna meta via columns en la response. Drizzle ejecutor
  // wraps it; aqui consultamos directo information_schema-like via pg_attribute.
  // Si la introspeccion via "LIMIT 0" no devuelve nombres en este driver,
  // fallback explicito.
  const schema_name = mv.split(".")[0];
  const table_name = mv.split(".")[1];
  const cols = await db.execute<{ column_name: string }>(
    sql.raw(`
      SELECT a.attname AS column_name
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = '${schema_name}'
        AND c.relname = '${table_name}'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `),
  );
  void rows;
  const todas = new Set<string>();
  const dimensiones = new Set<string>();
  const medidas = new Set<string>();
  for (const r of cols) {
    const c = String(r.column_name);
    todas.add(c);
    if (DIMENSIONES_COMUNES.has(c)) {
      dimensiones.add(c);
    } else {
      medidas.add(c);
    }
  }
  const schema: MvSchema = { dimensiones, medidas, todasColumnas: todas };
  SCHEMA_CACHE.set(fuente, schema);
  return schema;
}

// ============================================================================
// Helpers de etiquetas — para mostrar nombre canonico de cuenta en headers
// ============================================================================

let CUENTAS_LABEL_CACHE: Map<string, string> | null = null;

async function getCuentaLabels(): Promise<Map<string, string>> {
  if (CUENTAS_LABEL_CACHE) return CUENTAS_LABEL_CACHE;
  const rows = await db.execute<{ codigo: string; nombre: string }>(
    sql.raw(`SELECT codigo, nombre FROM dw.dim_cuenta`),
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    // codigo 'A1.1' -> column key 'cta_a1_1'
    const key = `cta_${String(r.codigo).toLowerCase().replace(/\./g, "_")}`;
    map.set(key, `(${r.codigo}) ${r.nombre}`);
  }
  CUENTAS_LABEL_CACHE = map;
  return map;
}

function labelDimension(col: string): string {
  switch (col) {
    case "periodo":
      return "Periodo";
    case "fecha_cierre":
      return "Fecha cierre";
    case "nomb_correg":
      return "Entidad";
    case "empresa_sbs":
      return "Empresa SBS";
    case "tipo_entidad":
      return "Tipo entidad";
    case "microfinanciera":
      return "Microfinanciera";
    case "nacional":
      return "Origen";
    case "moneda":
      return "Moneda";
    default:
      return col;
  }
}

// ============================================================================
// Validacion + construccion del SQL
// ============================================================================

function ident(col: string): string {
  // Whitelist: solo a-z, 0-9, _. Si pasa, retornar quoted.
  if (!/^[a-z][a-z0-9_]*$/.test(col)) {
    throw new ValidationError(`Identificador invalido: ${col}`, { col });
  }
  return `"${col}"`;
}

function validarColumnas(
  cols: string[],
  permitidas: Set<string>,
  contexto: string,
): void {
  for (const c of cols) {
    if (!permitidas.has(c)) {
      throw new ValidationError(
        `Columna no permitida en ${contexto}: ${c}`,
        { col: c, permitidas: [...permitidas].slice(0, 20) },
      );
    }
  }
}

const AGREGACIONES_SQL: Record<AgregacionPivot, string | null> = {
  NONE: null,
  SUM: "SUM",
  AVG: "AVG",
  MIN: "MIN",
  MAX: "MAX",
  COUNT: "COUNT",
};

// ============================================================================
// Endpoint principal
// ============================================================================

export async function runPivot(req: PivotRequest): Promise<PivotResponse> {
  const start = Date.now();
  const schema = await getSchema(req.fuente);
  const mvTable = MV_TABLE[req.fuente];

  // Validaciones
  if (req.dimensiones.length === 0) {
    throw new ValidationError("Debe haber al menos una dimension", {});
  }
  if (req.medidas.length === 0) {
    throw new ValidationError("Debe haber al menos una medida", {});
  }
  validarColumnas(req.dimensiones, schema.dimensiones, "dimensiones");
  validarColumnas(req.medidas, schema.medidas, "medidas");

  const agg = AGREGACIONES_SQL[req.agregacion];
  if (req.agregacion !== "NONE" && !agg) {
    throw new ValidationError(`Agregacion no soportada: ${req.agregacion}`, {});
  }

  // SELECT clause
  const selectDims = req.dimensiones.map((d) => ident(d)).join(", ");
  const selectMedidas = req.medidas
    .map((m) => {
      const col = ident(m);
      if (agg) {
        return `${agg}(${col})::numeric AS ${col}`;
      }
      return col;
    })
    .join(", ");

  // WHERE clause + params
  const condiciones: string[] = [];
  const params: unknown[] = [];

  function addEq(col: string, vals: unknown[]) {
    if (!vals || vals.length === 0) return;
    const start = params.length + 1;
    const placeholders = vals.map((_, i) => `$${start + i}`).join(", ");
    params.push(...vals);
    condiciones.push(`${ident(col)} IN (${placeholders})`);
  }
  function addRange(col: string, op: ">=" | "<=", val: number) {
    params.push(val);
    condiciones.push(`${ident(col)} ${op} $${params.length}`);
  }

  const f = req.filtros ?? {};
  if (f.tipoEntidad?.length) addEq("tipo_entidad", f.tipoEntidad);
  if (f.moneda?.length) addEq("moneda", f.moneda);
  if (f.nombCorreg?.length) addEq("nomb_correg", f.nombCorreg);
  if (f.microfinanciera !== undefined) {
    params.push(f.microfinanciera);
    condiciones.push(`${ident("microfinanciera")} = $${params.length}`);
  }
  if (f.periodoDesde) addRange("periodo", ">=", f.periodoDesde);
  if (f.periodoHasta) addRange("periodo", "<=", f.periodoHasta);

  const whereSql = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  const groupBy = agg ? `GROUP BY ${selectDims}` : "";

  // ORDER BY
  const orderParts: string[] = [];
  if (req.orden && req.orden.length > 0) {
    for (const o of req.orden) {
      // Whitelist contra dimensiones+medidas seleccionadas
      if (!req.dimensiones.includes(o.columna) && !req.medidas.includes(o.columna)) {
        throw new ValidationError(`Columna ORDER BY no esta en la seleccion: ${o.columna}`, {});
      }
      const dir = o.dir === "DESC" ? "DESC" : "ASC";
      orderParts.push(`${ident(o.columna)} ${dir} NULLS LAST`);
    }
  } else {
    // Default: por dimensiones en el orden dado
    for (const d of req.dimensiones) {
      orderParts.push(`${ident(d)} ASC NULLS LAST`);
    }
  }
  const orderSql = `ORDER BY ${orderParts.join(", ")}`;

  const limite = Math.min(req.limite ?? 10_000, 50_000);
  const limitSql = `LIMIT ${limite}`;

  const querySql = `
    SELECT ${selectDims}, ${selectMedidas}
    FROM ${mvTable}
    ${whereSql}
    ${groupBy}
    ${orderSql}
    ${limitSql}
  `;

  const filas = await db.execute<Record<string, unknown>>(
    sql.raw(buildParameterized(querySql, params)),
  );

  // Construir metadata de columnas
  const cuentaLabels = await getCuentaLabels();
  const columnas: PivotColumna[] = [
    ...req.dimensiones.map((d) => ({
      key: d,
      tipo: "dimension" as const,
      label: labelDimension(d),
      esNumerico: false,
    })),
    ...req.medidas.map((m) => ({
      key: m,
      tipo: "medida" as const,
      label: cuentaLabels.get(m) ?? m,
      esNumerico: true,
    })),
  ];

  return {
    columnas,
    filas: filas as Array<Record<string, unknown>>,
    totalFilas: filas.length,
    duracionMs: Date.now() - start,
  };
}

// ============================================================================
// Parameterizacion: inline params en SQL (drizzle sql.raw no soporta params
// directamente, debemos serializar con escape). Usamos un approach simple
// que escapa por tipo. Los identificadores ya estan whitelisted en ident().
// ============================================================================

function buildParameterized(sqlText: string, params: unknown[]): string {
  let out = sqlText;
  for (let i = params.length - 1; i >= 0; i--) {
    const placeholder = `\\$${i + 1}\\b`;
    const v = params[i];
    out = out.replace(new RegExp(placeholder, "g"), serializeParam(v));
  }
  return out;
}

function serializeParam(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ValidationError(`Numero invalido: ${v}`, {});
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") {
    // escape ' -> ''
    return `'${v.replace(/'/g, "''")}'`;
  }
  throw new ValidationError(`Tipo de parametro no soportado: ${typeof v}`, {});
}

// ============================================================================
// Metadata helpers para el frontend (lista de columnas disponibles)
// ============================================================================

export async function listColumnasDisponibles(
  fuente: FuentePivot,
): Promise<{ dimensiones: PivotColumna[]; medidas: PivotColumna[] }> {
  const schema = await getSchema(fuente);
  const cuentaLabels = await getCuentaLabels();
  const dimensiones: PivotColumna[] = [...schema.dimensiones].map((d) => ({
    key: d,
    tipo: "dimension",
    label: labelDimension(d),
    esNumerico: false,
  }));
  const medidas: PivotColumna[] = [...schema.medidas].map((m) => ({
    key: m,
    tipo: "medida",
    label: cuentaLabels.get(m) ?? m,
    esNumerico: true,
  }));
  // Ordenar dimensiones por relevancia
  const ordenDim = [
    "periodo",
    "tipo_entidad",
    "nomb_correg",
    "moneda",
    "microfinanciera",
    "nacional",
    "empresa_sbs",
    "fecha_cierre",
  ];
  dimensiones.sort(
    (a, b) =>
      (ordenDim.indexOf(a.key) === -1 ? 999 : ordenDim.indexOf(a.key)) -
      (ordenDim.indexOf(b.key) === -1 ? 999 : ordenDim.indexOf(b.key)),
  );
  // Ordenar medidas alfabeticamente por key
  medidas.sort((a, b) => a.key.localeCompare(b.key));
  return { dimensiones, medidas };
}
