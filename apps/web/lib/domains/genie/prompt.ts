/**
 * Prompt master del Genie NL2SQL.
 *
 * Diseno:
 *  - Incluye SOLO el contexto necesario (descripciones de marts/dw, columnas
 *    de las MVs principales)
 *  - Reglas estrictas: SELECT-only, schemas permitidos, sin EXPLAIN/SET/etc
 *  - Few-shot examples para reforzar formato de respuesta JSON
 *  - Output: { sql: "...", explicacion: "..." }
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

let CATALOG_CACHE: string | null = null;
let CATALOG_CACHE_AT = 0;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function getCatalogSnapshot(): Promise<string> {
  if (CATALOG_CACHE && Date.now() - CATALOG_CACHE_AT < CATALOG_CACHE_TTL_MS) {
    return CATALOG_CACHE;
  }

  // Marts + dim_cuenta — solo lo que el LLM necesita para generar SQL util.
  const tablas = await db.execute<{
    schema: string;
    tabla: string;
    comentario: string | null;
  }>(
    sql.raw(`
      SELECT n.nspname AS schema, c.relname AS tabla,
             obj_description(c.oid, 'pg_class') AS comentario
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname IN ('marts', 'dw')
        AND c.relkind IN ('r','v','m')
      ORDER BY n.nspname, c.relname
    `),
  );

  const partes: string[] = [];
  for (const t of tablas) {
    // Cargar columnas
    const cols = await db.execute<{ column_name: string; data_type: string }>(
      sql.raw(`
        SELECT a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = '${t.schema}'
          AND c.relname = '${t.tabla}'
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
      `),
    );
    partes.push(`## ${t.schema}.${t.tabla}`);
    if (t.comentario) partes.push(`Descripcion: ${t.comentario}`);
    partes.push("Columnas:");
    for (const c of cols) {
      partes.push(`  - ${c.column_name} (${c.data_type})`);
    }
    partes.push("");
  }

  // Plan de cuentas canonico (top L1/L2) para que el LLM entienda lo que es A1, B2, 17, etc
  const cuentas = await db.execute<{
    codigo: string;
    nombre: string;
    tipo_estado: string;
  }>(
    sql.raw(`
      SELECT codigo, nombre, tipo_estado
      FROM dw.dim_cuenta
      WHERE nivel <= 2
      ORDER BY tipo_estado, codigo
    `),
  );
  partes.push("## Plan de cuentas (nivel 1-2):");
  for (const c of cuentas) {
    partes.push(`  - ${c.tipo_estado}/${c.codigo}: ${c.nombre}`);
  }

  CATALOG_CACHE = partes.join("\n");
  CATALOG_CACHE_AT = Date.now();
  return CATALOG_CACHE;
}

export const SYSTEM_PROMPT_BASE = `Eres Genie, asistente SQL experto en estadisticas SBS Peru.

REGLAS NO NEGOCIABLES:
1. Solo generas SELECT (o WITH ... SELECT). NUNCA INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT.
2. Solo usa los schemas: marts, dw. NUNCA accedes a auth, raw, app, public.
3. Una sola sentencia (sin ';' en medio).
4. Sin EXPLAIN, sin SET, sin COPY, sin VACUUM.
5. Cierra siempre con LIMIT N (default 1000) salvo que el usuario pida agregados.
6. Para periodos: el formato es YYYYMM (ej 202603 = marzo 2026).
7. Para fecha: usa fecha_cierre (DATE) cuando aplique.

OUTPUT FORMAT (JSON solamente, sin markdown fences, sin texto extra):
{
  "sql": "SELECT ... ;",
  "explicacion": "Una linea explicando que hace la query"
}

CONTEXTO DEL DATA WAREHOUSE:

`;

export async function buildSystemPrompt(): Promise<string> {
  const catalog = await getCatalogSnapshot();
  return SYSTEM_PROMPT_BASE + catalog;
}

export function buildUserPrompt(req: { prompt: string; contextoExtra?: string }): string {
  let p = req.prompt;
  if (req.contextoExtra?.trim()) {
    p = `Contexto adicional del usuario: ${req.contextoExtra.trim()}\n\nPregunta: ${p}`;
  }
  return p;
}
