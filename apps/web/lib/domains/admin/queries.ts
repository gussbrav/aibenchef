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

/**
 * Matriz de archivos al estilo SBS: para cada combinación
 * (grupo, topico, anio, mes), devuelve el status y el id del archivo.
 * Esto permite renderizar el dashboard como una grid donde cada celda
 * representa un archivo descargable y se ve de un vistazo qué cubrimos.
 */
export type MatrizCelda = {
  grupo: string;
  topico: string;
  anio: number;
  mes: number;
  archivos: number;
  status: string | null;
  descargadoEn: string | null;
  filasInsertadas: number | null;
};

export async function getArchivosMatriz(opts: { anioMin?: number; anioMax?: number } = {}): Promise<MatrizCelda[]> {
  const anioMin = opts.anioMin ?? null;
  const anioMax = opts.anioMax ?? null;
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      grupo,
      topico,
      anio,
      mes,
      COUNT(*)::int AS archivos,
      -- status mas restrictivo (prioridad error > descargado > procesado)
      (ARRAY_AGG(status ORDER BY
         CASE status WHEN 'error' THEN 1 WHEN 'descargado' THEN 2 WHEN 'procesado' THEN 3 ELSE 4 END))[1] AS status,
      TO_CHAR(MAX(descargado_en), 'YYYY-MM-DD HH24:MI') AS "descargadoEn",
      SUM(filas_insertadas)::int AS "filasInsertadas"
    FROM raw.archivos_descargados
    WHERE
      (${anioMin}::int IS NULL OR anio >= ${anioMin}::int)
      AND (${anioMax}::int IS NULL OR anio <= ${anioMax}::int)
    GROUP BY grupo, topico, anio, mes
    ORDER BY grupo, topico, anio DESC, mes DESC
  `);
  return rows.map((r) => ({
    grupo: String(r.grupo),
    topico: String(r.topico),
    anio: Number(r.anio),
    mes: Number(r.mes),
    archivos: Number(r.archivos),
    status: (r.status as string | null) ?? null,
    descargadoEn: (r.descargadoEn as string | null) ?? null,
    filasInsertadas: r.filasInsertadas != null ? Number(r.filasInsertadas) : null,
  }));
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
