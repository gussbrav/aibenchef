/**
 * Queries del domain admin contra raw.archivos_descargados.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import type { ArchivoDescargado, ArchivosFilter, ArchivosStats } from "./types";

const STATUS_VALIDOS = new Set(["descargado", "procesando", "procesado", "error", "omitido"]);

export async function listArchivos(opts: ArchivosFilter = {}): Promise<ArchivoDescargado[]> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const status =
    opts.status && STATUS_VALIDOS.has(opts.status) ? opts.status : null;

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      id,
      grupo,
      topico,
      periodo,
      anio,
      mes,
      nombre_archivo  AS "nombreArchivo",
      path_local      AS "pathLocal",
      source_url      AS "sourceUrl",
      tamanio_bytes   AS "tamanioBytes",
      md5_hash        AS "md5Hash",
      formato,
      status,
      filas_insertadas AS "filasInsertadas",
      error_mensaje    AS "errorMensaje",
      TO_CHAR(procesado_en, 'YYYY-MM-DD HH24:MI:SS')  AS "procesadoEn",
      TO_CHAR(descargado_en, 'YYYY-MM-DD HH24:MI:SS') AS "descargadoEn",
      TO_CHAR(actualizado_en, 'YYYY-MM-DD HH24:MI:SS') AS "actualizadoEn"
    FROM raw.archivos_descargados
    WHERE
      (${opts.grupo ?? null}::text  IS NULL OR grupo  = ${opts.grupo ?? null}::text)
      AND (${opts.topico ?? null}::text IS NULL OR topico = ${opts.topico ?? null}::text)
      AND (${status}::text           IS NULL OR status = ${status}::text)
      AND (${opts.anio ?? null}::int  IS NULL OR anio   = ${opts.anio ?? null}::int)
    ORDER BY periodo DESC, grupo, topico
    LIMIT ${limit} OFFSET ${offset}
  `);

  return rows.map(rowToArchivo);
}

export async function getArchivosStats(): Promise<ArchivosStats> {
  const summaryRows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      COUNT(*)::bigint                     AS total,
      COALESCE(SUM(tamanio_bytes), 0)::bigint AS total_bytes,
      MIN(periodo)                         AS periodo_min,
      MAX(periodo)                         AS periodo_max
    FROM raw.archivos_descargados
  `);
  const summary = summaryRows[0] ?? {};

  const byStatus = await db.execute<Record<string, unknown>>(sql`
    SELECT status, COUNT(*)::bigint AS n
    FROM raw.archivos_descargados
    GROUP BY status
    ORDER BY status
  `);

  const byGrupo = await db.execute<Record<string, unknown>>(sql`
    SELECT grupo, COUNT(*)::bigint AS n
    FROM raw.archivos_descargados
    GROUP BY grupo
    ORDER BY grupo
  `);

  const byTopico = await db.execute<Record<string, unknown>>(sql`
    SELECT topico, COUNT(*)::bigint AS n
    FROM raw.archivos_descargados
    GROUP BY topico
    ORDER BY topico
  `);

  return {
    total: Number(summary.total ?? 0),
    totalBytes: Number(summary.total_bytes ?? 0),
    periodoMin: summary.periodo_min != null ? Number(summary.periodo_min) : null,
    periodoMax: summary.periodo_max != null ? Number(summary.periodo_max) : null,
    porStatus: Object.fromEntries(byStatus.map((r) => [String(r.status), Number(r.n)])),
    porGrupo: Object.fromEntries(byGrupo.map((r) => [String(r.grupo), Number(r.n)])),
    porTopico: Object.fromEntries(byTopico.map((r) => [String(r.topico), Number(r.n)])),
  };
}

function rowToArchivo(r: Record<string, unknown>): ArchivoDescargado {
  return {
    id: String(r.id),
    grupo: String(r.grupo),
    topico: String(r.topico),
    periodo: Number(r.periodo),
    anio: Number(r.anio),
    mes: Number(r.mes),
    nombreArchivo: String(r.nombreArchivo),
    pathLocal: String(r.pathLocal),
    sourceUrl: String(r.sourceUrl),
    tamanioBytes: Number(r.tamanioBytes),
    md5Hash: r.md5Hash as string | null,
    formato: r.formato as string | null,
    status: String(r.status) as ArchivoDescargado["status"],
    filasInsertadas: r.filasInsertadas != null ? Number(r.filasInsertadas) : null,
    errorMensaje: r.errorMensaje as string | null,
    procesadoEn: r.procesadoEn as string | null,
    descargadoEn: String(r.descargadoEn),
    actualizadoEn: String(r.actualizadoEn),
  };
}
