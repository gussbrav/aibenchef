/**
 * Inspector genérico de tablas raw — para validar la ingesta por tópico
 * sin tener que abrir psql. Mapea topico → tabla raw, lee schema dinámicamente
 * y devuelve filas con paginación.
 *
 * Cubre los 10 tópicos: oficinas, personal, clientes_credito, clientes_ahorro,
 * depositos, colocaciones, castigos, indicadores, creditos_depositos_geo, eeff
 * (para eeff existe el inspector dedicado /eeff-inspector con extracción crudo
 * vs parseado; este genérico complementa con vista raw lineal).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

export type TopicoInfo = {
  topico: string;
  tablaRaw: string;
  /** Columnas que filtran (presentes en TODAS las tablas raw). */
  columnaPeriodo: string;
  columnaEntidad: string | null;
  columnaGrupo: string | null;
};

export const TOPICO_REGISTRY: Record<string, TopicoInfo> = {
  oficinas: {
    topico: "oficinas",
    tablaRaw: "raw.oficinas_observacion",
    columnaPeriodo: "periodo",
    columnaEntidad: "empresa",
    columnaGrupo: "tipo_entidad",
  },
  personal: {
    topico: "personal",
    tablaRaw: "raw.personal_observacion",
    columnaPeriodo: "periodo",
    columnaEntidad: "empresa",
    columnaGrupo: "tipo_entidad",
  },
  clientes_credito: {
    topico: "clientes_credito",
    tablaRaw: "raw.clientes_creditos",
    columnaPeriodo: "periodo",
    columnaEntidad: "empresa",
    columnaGrupo: "tipo_entidad",
  },
  clientes_ahorro: {
    topico: "clientes_ahorro",
    tablaRaw: "raw.clientes_ahorros",
    columnaPeriodo: "periodo",
    columnaEntidad: "empresa",
    columnaGrupo: "tipo_entidad",
  },
  depositos: {
    topico: "depositos",
    tablaRaw: "raw.depositos_observacion",
    columnaPeriodo: "periodo",
    columnaEntidad: "nomb_correg",
    columnaGrupo: "tipo_entidad",
  },
  colocaciones: {
    topico: "colocaciones",
    tablaRaw: "raw.colocaciones_observacion",
    columnaPeriodo: "periodo",
    columnaEntidad: "nomb_correg",
    columnaGrupo: "tipo_entidad",
  },
  castigos: {
    topico: "castigos",
    tablaRaw: "raw.castigos_observacion",
    columnaPeriodo: "periodo",
    columnaEntidad: "nomb_correg",
    columnaGrupo: "tipo_entidad",
  },
  indicadores: {
    topico: "indicadores",
    tablaRaw: "raw.indicadores_prudenciales",
    columnaPeriodo: "periodo",
    columnaEntidad: "nomb_correg",
    columnaGrupo: null,
  },
  creditos_depositos_geo: {
    topico: "creditos_depositos_geo",
    tablaRaw: "raw.creditos_depositos_oficina",
    columnaPeriodo: "periodo",
    columnaEntidad: "empresa",
    columnaGrupo: null,
  },
  eeff: {
    topico: "eeff",
    tablaRaw: "raw.eeff_observacion",
    columnaPeriodo: "periodo",
    columnaEntidad: "nomb_correg",
    columnaGrupo: "tipo_entidad",
  },
};

export function listTopicos(): TopicoInfo[] {
  return Object.values(TOPICO_REGISTRY);
}

export type TopicoResumenRow = {
  periodo: number;
  archivos: number;
  procesados: number;
  errores: number;
  filasRaw: number;
};

/** Lista los últimos N periodos del tópico con métricas agregadas. */
export async function getTopicoResumen(
  topico: string,
  limit = 24,
): Promise<TopicoResumenRow[]> {
  const info = TOPICO_REGISTRY[topico];
  if (!info) return [];
  // RAW table en raw schema — necesitamos sql.raw porque drizzle no soporta
  // table names dinámicos directamente. El topico ya está validado contra
  // TOPICO_REGISTRY (no es input arbitrario).
  const rows = await db.execute<Record<string, unknown>>(sql`
    WITH archivos AS (
      SELECT periodo,
             COUNT(*)::int AS archivos,
             COUNT(*) FILTER (WHERE status='procesado')::int AS procesados,
             COUNT(*) FILTER (WHERE status='error')::int AS errores
      FROM raw.archivos_descargados
      WHERE topico = ${topico}
      GROUP BY periodo
    ),
    raw_counts AS (
      SELECT ${sql.raw(info.columnaPeriodo)} AS periodo, COUNT(*)::int AS n
      FROM ${sql.raw(info.tablaRaw)}
      GROUP BY ${sql.raw(info.columnaPeriodo)}
    )
    SELECT a.periodo, a.archivos, a.procesados, a.errores,
           COALESCE(r.n, 0) AS filas_raw
    FROM archivos a
    LEFT JOIN raw_counts r ON r.periodo = a.periodo
    ORDER BY a.periodo DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    periodo: Number(r.periodo),
    archivos: Number(r.archivos),
    procesados: Number(r.procesados),
    errores: Number(r.errores),
    filasRaw: Number(r.filas_raw),
  }));
}

/** Devuelve N filas raw de un tópico filtradas por periodo + entidad opcional.
 *  Para inspección visual estilo "adminer mini".  */
export async function getTopicoRawSample(
  topico: string,
  opts: { periodo: number; entidad?: string; limit?: number } = { periodo: 0 },
): Promise<{ columnas: string[]; filas: Array<Record<string, unknown>> }> {
  const info = TOPICO_REGISTRY[topico];
  if (!info) return { columnas: [], filas: [] };
  const limit = Math.min(opts.limit ?? 100, 500);

  const whereEntidad =
    opts.entidad && info.columnaEntidad
      ? sql`AND ${sql.raw(info.columnaEntidad)} = ${opts.entidad}`
      : sql``;

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT * FROM ${sql.raw(info.tablaRaw)}
    WHERE ${sql.raw(info.columnaPeriodo)} = ${opts.periodo}
    ${whereEntidad}
    LIMIT ${limit}
  `);

  const columnas = rows[0] ? Object.keys(rows[0]) : [];
  return { columnas, filas: rows };
}

/** Lista entidades distintas del tópico para el periodo dado. */
export async function getTopicoEntidades(
  topico: string,
  periodo: number,
): Promise<string[]> {
  const info = TOPICO_REGISTRY[topico];
  if (!info || !info.columnaEntidad) return [];
  const rows = await db.execute<{ entidad: string }>(sql`
    SELECT DISTINCT ${sql.raw(info.columnaEntidad)} AS entidad
    FROM ${sql.raw(info.tablaRaw)}
    WHERE ${sql.raw(info.columnaPeriodo)} = ${periodo}
    ORDER BY 1
  `);
  return rows.map((r) => r.entidad).filter(Boolean);
}
