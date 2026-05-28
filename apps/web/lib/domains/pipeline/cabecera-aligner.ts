/**
 * Cabecera Aligner — queries para detectar y arreglar drift entre
 * raw.eeff_observacion y dw.cabecera_maestra (issue #28).
 *
 * Workflow:
 *   1. listCabeceraDiff(tipoEstado, tipoEntidad, periodo) → marts.v_cabecera_diff
 *   2. UI muestra missing_in_cabecera con checkbox
 *   3. POST con codigos seleccionados → alignCabecera() llama
 *      dw.align_cabecera() que aplica caso B (UPDATE codigo en fila existente
 *      con codigo=NULL y nombre similar) o caso C (INSERT despues del padre).
 *   4. Cada cambio queda audit en admin.cabecera_audit_log.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

import type { CabeceraDiffRow, CabeceraDiffStatus, TipoEstado } from "./types";

/** Lista codigos en raw vs cabecera para (tipoEstado, tipoEntidad, periodo). */
export async function listCabeceraDiff(
  tipoEstado: TipoEstado,
  tipoEntidad: string,
  periodo: number,
  onlyMissing = false,
): Promise<CabeceraDiffRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      tipo_estado, tipo_entidad, periodo,
      cuenta_codigo,
      cuenta_nombre_raw,
      n_entidades,
      cuenta_nombre_canonica,
      orden_cabecera,
      nivel_cabecera,
      status
    FROM marts.v_cabecera_diff
    WHERE tipo_estado = ${tipoEstado}
      AND tipo_entidad = ${tipoEntidad}
      AND periodo = ${periodo}
      AND (${onlyMissing}::boolean = FALSE OR status = 'missing_in_cabecera')
    ORDER BY cuenta_codigo
  `);

  return rows.map((r) => ({
    tipoEstado: r.tipo_estado as TipoEstado,
    tipoEntidad: r.tipo_entidad as string,
    periodo: Number(r.periodo),
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombreRaw: (r.cuenta_nombre_raw as string | null) ?? null,
    nEntidades: Number(r.n_entidades),
    cuentaNombreCanonica: (r.cuenta_nombre_canonica as string | null) ?? null,
    ordenCabecera: r.orden_cabecera != null ? Number(r.orden_cabecera) : null,
    nivelCabecera: r.nivel_cabecera != null ? Number(r.nivel_cabecera) : null,
    status: r.status as CabeceraDiffStatus,
  }));
}

/** Aplica el align llamando dw.align_cabecera. Retorna n cambios realizados.
 *
 * Pasamos los codigos como JSON y convertimos a array en SQL — evita el bug
 * "cannot cast record to text[]" (REGRESION #22) que ocurre al pasar JS
 * arrays directos via drizzle template literals.
 */
export async function alignCabecera(
  tipoEstado: TipoEstado,
  tipoEntidad: string,
  codigos: string[],
  periodoSrc: number,
  performedBy: string,
  motivo?: string,
): Promise<{ changes: number }> {
  if (codigos.length === 0) return { changes: 0 };

  const codigosJson = JSON.stringify(codigos);
  const rows = await db.execute<{ changes: number }>(sql`
    SELECT dw.align_cabecera(
      ${tipoEstado},
      ${tipoEntidad},
      ARRAY(SELECT jsonb_array_elements_text(${codigosJson}::jsonb))::text[],
      ${periodoSrc},
      ${performedBy},
      ${motivo ?? null}
    )::int AS changes
  `);
  return { changes: Number(rows[0]?.changes ?? 0) };
}

/** Audit log del cabecera_audit_log para una entidad. */
export async function listCabeceraAuditLog(
  tipoEstado: TipoEstado,
  tipoEntidad: string,
  limit = 50,
): Promise<
  {
    id: number;
    codigo: string | null;
    nombre: string;
    orden: number;
    accion: string;
    performedBy: string;
    performedAt: string;
    motivo: string | null;
  }[]
> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id::int, codigo, nombre, orden, accion,
           performed_by AS "performedBy",
           performed_at,
           motivo
    FROM admin.cabecera_audit_log
    WHERE tipo_estado = ${tipoEstado}
      AND tipo_entidad = ${tipoEntidad}
    ORDER BY performed_at DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    codigo: (r.codigo as string | null) ?? null,
    nombre: r.nombre as string,
    orden: Number(r.orden),
    accion: r.accion as string,
    performedBy: r.performedBy as string,
    performedAt: new Date(r.performed_at as string).toISOString(),
    motivo: (r.motivo as string | null) ?? null,
  }));
}
