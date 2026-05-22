/**
 * Sandbox SQL para el SQL Workbench.
 *
 * Capa de defensa en profundidad:
 *   1. Whitelist de keywords prohibidos (DDL, DML, system catalogs sensitivos).
 *   2. Single statement (rechaza ';' dentro del cuerpo, excepto al final).
 *   3. Limite de longitud (50K chars).
 *   4. Ejecucion en transaccion descartable con:
 *        - SET LOCAL ROLE app_sql_readonly
 *        - SET LOCAL statement_timeout = '15s'
 *        - SET LOCAL search_path TO marts, dw, pg_catalog
 *   5. Resultados truncados a 5000 filas (configurable).
 *   6. Audit log post-ejecucion (app.sql_audit_log).
 *
 * No prevenimos 100% el abuso (un usuario malicioso podria correr queries
 * que toquen indices/cache), pero el rol readonly + statement_timeout son
 * la defensa principal.
 */

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { ValidationError } from "@/lib/domains/shared";

import type { QueryResult } from "./types";

export type AuditMetadata = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
};

const KEYWORDS_PROHIBIDOS = [
  // DDL
  "create",
  "alter",
  "drop",
  "truncate",
  "comment",
  // DML
  "insert",
  "update",
  "delete",
  "merge",
  "upsert",
  // Roles / permisos
  "grant",
  "revoke",
  "reassign",
  // Conexion / transaccion (no necesario para SELECT, evitar abuso)
  "commit",
  "rollback",
  "savepoint",
  "begin",
  "lock",
  "copy",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "listen",
  "notify",
  // Sistema
  "load",
  "do",
  "call",
  "execute",
  "prepare",
  "deallocate",
  "set",
  "reset",
  "discard",
  "explain",
  // Schemas que no debe tocar
  "pg_authid",
  "pg_user",
  "pg_shadow",
  "auth.",
  "raw.",
  "app.",
];

const MAX_SQL_LEN = 50_000;
const MAX_RESULT_ROWS = 5_000;

function normalizar(s: string): string {
  // Quitar comentarios /* */ y -- y normalizar
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function validateSql(sqlText: string): void {
  if (!sqlText || !sqlText.trim()) {
    throw new ValidationError("SQL vacio", {});
  }
  if (sqlText.length > MAX_SQL_LEN) {
    throw new ValidationError(`SQL muy largo (${sqlText.length} > ${MAX_SQL_LEN})`, {});
  }

  const normalizado = normalizar(sqlText);

  // Debe empezar con SELECT o WITH (CTE)
  if (!normalizado.startsWith("select") && !normalizado.startsWith("with")) {
    throw new ValidationError(
      "Solo se permiten queries SELECT (o WITH ... SELECT)",
      { found: normalizado.slice(0, 30) },
    );
  }

  // No mas de 1 statement: no debe contener ';' excepto al final
  const sinFinal = normalizado.replace(/;\s*$/, "");
  if (sinFinal.includes(";")) {
    throw new ValidationError("Solo se permite un statement por query", {});
  }

  // Keywords prohibidos como token aislado (con word boundary)
  for (const kw of KEYWORDS_PROHIBIDOS) {
    // Para schemas (acabados en '.'): substring match
    if (kw.endsWith(".")) {
      if (normalizado.includes(kw)) {
        throw new ValidationError(`Schema/tabla prohibida: ${kw}*`, { kw });
      }
      continue;
    }
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(normalizado)) {
      throw new ValidationError(`Keyword prohibido: ${kw}`, { kw });
    }
  }
}

function sqlHash(sqlText: string): string {
  return createHash("sha256").update(sqlText).digest("hex").slice(0, 16);
}

async function insertAuditLog(
  sqlText: string,
  audit: AuditMetadata,
  result: { duracionMs: number; filas: number; truncado: boolean; exitoso: boolean; error?: string },
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO app.sql_audit_log
        (user_id, sql_text, sql_hash, duracion_ms, filas, truncado,
         exitoso, error_msg, ip, user_agent)
      VALUES
        (${audit.userId}, ${sqlText}, ${sqlHash(sqlText)},
         ${result.duracionMs}, ${result.filas}, ${result.truncado},
         ${result.exitoso}, ${result.error ?? null},
         ${audit.ip ?? null}::inet, ${audit.userAgent ?? null})
    `);
  } catch {
    // No bloquear la ejecucion si el audit log falla. Silent.
  }
}

/**
 * Ejecuta una query SELECT en sandbox readonly.
 *
 * @throws ValidationError si la query viola las reglas.
 * @throws Error con mensaje friendly si falla en runtime.
 */
export async function executeQuerySandbox(
  sqlText: string,
  audit?: AuditMetadata,
): Promise<QueryResult> {
  validateSql(sqlText);

  const start = Date.now();

  // Estrategia: usar una transaccion + SET LOCAL ROLE.
  // postgres-js no expone transactions directamente via drizzle.execute,
  // pero podemos enviar todo en un solo CALL_LIST.
  // Usamos un wrapper SQL via WITH no aplica para SET — necesitamos sentencias multiples.
  // Approach: parametros via $1 NO funcionan para SET LOCAL; usamos identificadores fijos.

  // Limite de filas: wrapping en sub-query
  const wrapped = `
    SELECT * FROM (${sqlText.replace(/;\s*$/, "")}) AS _user_query
    LIMIT ${MAX_RESULT_ROWS + 1}
  `;

  // Ejecutar dentro de una transaccion descartable
  let filas: Array<Record<string, unknown>> = [];
  let columnas: Array<{ key: string; tipo: string }> = [];

  let exitoso = false;
  let errorMsg: string | undefined;

  try {
    // postgres-js client via drizzle: usamos db.execute con un BEGIN/SET/SELECT/ROLLBACK
    // como statements separados. Drizzle exec en una sola sesion implicitamente.

    // SET LOCAL afecta solo la transaccion. Necesitamos BEGIN explicito.
    await db.execute(sql.raw("BEGIN"));
    try {
      await db.execute(sql.raw("SET LOCAL statement_timeout = '15s'"));
      await db.execute(sql.raw("SET LOCAL idle_in_transaction_session_timeout = '20s'"));
      await db.execute(sql.raw("SET LOCAL search_path TO marts, dw, pg_catalog"));
      await db.execute(sql.raw("SET LOCAL ROLE app_sql_readonly"));

      const result = await db.execute<Record<string, unknown>>(sql.raw(wrapped));
      filas = result as Array<Record<string, unknown>>;
      // Inferir columnas del primer registro (o de pg_attribute meta — drizzle no expone)
      if (filas.length > 0) {
        columnas = Object.keys(filas[0]!).map((k) => ({
          key: k,
          tipo: detectarTipo(filas, k),
        }));
      } else {
        columnas = [];
      }
      exitoso = true;
    } finally {
      await db.execute(sql.raw("ROLLBACK"));
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    if (audit) {
      await insertAuditLog(sqlText, audit, {
        duracionMs: Date.now() - start,
        filas: 0,
        truncado: false,
        exitoso: false,
        error: errorMsg,
      });
    }
    throw new Error(`Error ejecutando query: ${errorMsg}`);
  }

  const truncado = filas.length > MAX_RESULT_ROWS;
  if (truncado) {
    filas = filas.slice(0, MAX_RESULT_ROWS);
  }

  const duracionMs = Date.now() - start;
  if (audit) {
    await insertAuditLog(sqlText, audit, {
      duracionMs,
      filas: filas.length,
      truncado,
      exitoso,
    });
  }

  return {
    columnas,
    filas,
    totalFilas: filas.length,
    duracionMs,
    truncado,
  };
}

function detectarTipo(filas: Array<Record<string, unknown>>, key: string): string {
  // Inferir tipo del primer valor no-null
  for (const f of filas) {
    const v = f[key];
    if (v === null || v === undefined) continue;
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    if (v instanceof Date) return "date";
    return "string";
  }
  return "string";
}
