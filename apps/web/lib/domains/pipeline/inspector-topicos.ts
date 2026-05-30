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
import { ordenGrupo } from "@/lib/domains/shared/grupos";

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

/** Lista los últimos N periodos del tópico con métricas agregadas.
 *  Default 1000 = efectivamente "todos los periodos disponibles" (SBS desde
 *  2009 ≈ 220 periodos). Pasar limit=1 para landing card. */
export async function getTopicoResumen(
  topico: string,
  limit = 1000,
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

/** Último periodo del tópico CON data real en la tabla raw (no solo descargado).
 *  Usado por el landing para mostrar stats útiles en vez del último descargado
 *  que puede tener 0 filas porque aún no se ha procesado. */
export async function getUltimoPeriodoConData(topico: string): Promise<number | null> {
  const info = TOPICO_REGISTRY[topico];
  if (!info) return null;
  const rows = await db.execute<{ p: number | null }>(sql`
    SELECT MAX(${sql.raw(info.columnaPeriodo)})::int AS p
    FROM ${sql.raw(info.tablaRaw)}
  `);
  return rows[0]?.p ?? null;
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

/* ──────────────────────────────────────────────────────────────────────── */
/* Pivots específicos por tópico                                            */
/* ──────────────────────────────────────────────────────────────────────── */

/** Resumen de TOTAL por entidad para un periodo. Util como vista landing
 *  donde el operador ve "BBVA: 270 oficinas / 6,300 empleados / etc". */
export type ResumenEntidadRow = {
  entidad: string;
  tipoEntidad: string | null;
  /** Métrica principal (n_oficinas, total empleados, n_clientes, saldo_total, etc). */
  total: number | null;
  /** Label del campo total (para UI). */
  totalLabel: string;
};

export async function getResumenPorEntidad(
  topico: string,
  periodo: number,
): Promise<ResumenEntidadRow[]> {
  const out = await _getResumenPorEntidadRaw(topico, periodo);
  // Orden uniforme en TODA la UI: Bancos → Financieras → Cajas Municipales →
  // Cajas Rurales → Empresas de Créditos. Dentro de cada grupo, por total DESC.
  return out.sort((a, b) => {
    const og = ordenGrupo(a.tipoEntidad) - ordenGrupo(b.tipoEntidad);
    if (og !== 0) return og;
    const ta = a.total ?? Number.NEGATIVE_INFINITY;
    const tb = b.total ?? Number.NEGATIVE_INFINITY;
    if (tb !== ta) return tb - ta;
    return a.entidad.localeCompare(b.entidad);
  });
}

async function _getResumenPorEntidadRaw(
  topico: string,
  periodo: number,
): Promise<ResumenEntidadRow[]> {
  switch (topico) {
    case "oficinas": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa AS entidad, tipo_entidad,
               SUM(n_oficinas)::int AS total
        FROM raw.oficinas_observacion
        WHERE periodo = ${periodo}
        GROUP BY empresa, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "N oficinas",
      }));
    }
    case "personal": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa_sbs AS entidad, tipo_entidad,
               SUM(total)::int AS total
        FROM raw.personal_observacion
        WHERE periodo = ${periodo}
        GROUP BY empresa_sbs, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa_sbs
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "N personal",
      }));
    }
    case "clientes_credito": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa AS entidad, tipo_entidad,
               SUM(n_clientes)::int AS total
        FROM raw.clientes_creditos
        WHERE periodo = ${periodo}
        GROUP BY empresa, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "N clientes",
      }));
    }
    case "clientes_ahorro": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa AS entidad, tipo_entidad,
               SUM(n_total)::int AS total
        FROM raw.clientes_ahorros
        WHERE periodo = ${periodo}
        GROUP BY empresa, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "N clientes",
      }));
    }
    case "depositos": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa AS entidad, tipo_entidad,
               SUM(saldo_total) AS total
        FROM raw.depositos_observacion
        WHERE periodo = ${periodo}
        GROUP BY empresa, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "Saldo total (S/)",
      }));
    }
    case "colocaciones": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa AS entidad, tipo_entidad,
               SUM(saldo_total) AS total
        FROM raw.colocaciones_observacion
        WHERE periodo = ${periodo}
        GROUP BY empresa, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "Saldo total (S/)",
      }));
    }
    case "castigos": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT entidad, tipo_entidad,
               SUM(saldo_castigos) AS total
        FROM raw.castigos_observacion
        WHERE periodo = ${periodo}
        GROUP BY entidad, tipo_entidad
        ORDER BY total DESC NULLS LAST, entidad
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "Saldo castigos (S/)",
      }));
    }
    case "indicadores": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT entidad, tipo_entidad,
               COUNT(*)::int AS total
        FROM raw.indicadores_prudenciales
        WHERE periodo = ${periodo}
        GROUP BY entidad, tipo_entidad
        ORDER BY entidad
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "N indicadores",
      }));
    }
    case "creditos_depositos_geo": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT empresa_sbs AS entidad, tipo_entidad,
               COUNT(DISTINCT departamento)::int AS total
        FROM raw.creditos_depositos_oficina
        WHERE periodo = ${periodo}
        GROUP BY empresa_sbs, tipo_entidad
        ORDER BY total DESC NULLS LAST, empresa_sbs
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "Departamentos",
      }));
    }
    case "eeff": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT nomb_correg AS entidad, MAX(tipo_entidad) AS tipo_entidad,
               COUNT(DISTINCT cuenta_codigo)::int AS total
        FROM raw.eeff_observacion
        WHERE periodo = ${periodo}
        GROUP BY nomb_correg
        ORDER BY total DESC NULLS LAST, nomb_correg
      `);
      return rows.map((r) => ({
        entidad: r.entidad as string,
        tipoEntidad: r.tipo_entidad as string,
        total: r.total != null ? Number(r.total) : null,
        totalLabel: "N cuentas",
      }));
    }
    default:
      return [];
  }
}

/** Pivot detallado de UNA entidad: las filas crudas con sus dimensiones
 *  específicas del tópico. Es el "drill-down" desde la vista resumen. */
export type DetalleEntidadRow = {
  /** Dimensiones (depto, producto, etc.) en orden de display. */
  dims: Record<string, string | null>;
  /** Métricas numéricas. */
  metricas: Record<string, number | null>;
};

export type DetalleEntidad = {
  dimColumns: string[];
  metricColumns: string[];
  rows: DetalleEntidadRow[];
};

export async function getDetalleEntidad(
  topico: string,
  periodo: number,
  entidad: string,
): Promise<DetalleEntidad> {
  switch (topico) {
    case "oficinas": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT departamento, n_oficinas
        FROM raw.oficinas_observacion
        WHERE periodo = ${periodo} AND empresa = ${entidad}
        ORDER BY n_oficinas DESC, departamento
      `);
      return {
        dimColumns: ["Departamento"],
        metricColumns: ["N oficinas"],
        rows: rows.map((r) => ({
          dims: { Departamento: r.departamento as string },
          metricas: { "N oficinas": Number(r.n_oficinas) },
        })),
      };
    }
    case "personal": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT gerentes, funcionarios, empleados, otros, total
        FROM raw.personal_observacion
        WHERE periodo = ${periodo} AND empresa_sbs = ${entidad}
      `);
      return {
        dimColumns: ["Categoría"],
        metricColumns: ["Cantidad"],
        rows:
          rows.length === 0
            ? []
            : [
                { dims: { Categoría: "Gerentes" }, metricas: { Cantidad: Number(rows[0]?.gerentes ?? 0) } },
                { dims: { Categoría: "Funcionarios" }, metricas: { Cantidad: Number(rows[0]?.funcionarios ?? 0) } },
                { dims: { Categoría: "Empleados" }, metricas: { Cantidad: Number(rows[0]?.empleados ?? 0) } },
                { dims: { Categoría: "Otros" }, metricas: { Cantidad: Number(rows[0]?.otros ?? 0) } },
                { dims: { Categoría: "TOTAL" }, metricas: { Cantidad: Number(rows[0]?.total ?? 0) } },
              ],
      };
    }
    case "clientes_credito": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT producto, COALESCE(clasificacion,'(sin clasificacion)') AS clasificacion,
               n_clientes
        FROM raw.clientes_creditos
        WHERE periodo = ${periodo} AND empresa = ${entidad}
        ORDER BY producto, clasificacion
      `);
      return {
        dimColumns: ["Producto", "Clasificación"],
        metricColumns: ["N clientes"],
        rows: rows.map((r) => ({
          dims: {
            Producto: r.producto as string,
            Clasificación: r.clasificacion as string,
          },
          metricas: { "N clientes": r.n_clientes != null ? Number(r.n_clientes) : null },
        })),
      };
    }
    case "clientes_ahorro": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT producto, n_pers_nat, n_pers_jur_no_lucro, n_otras_pers_jur, n_total
        FROM raw.clientes_ahorros
        WHERE periodo = ${periodo} AND empresa = ${entidad}
        ORDER BY producto
      `);
      return {
        dimColumns: ["Producto"],
        metricColumns: ["Pers. Nat.", "Pers. Jur. (no lucro)", "Otras Pers. Jur.", "TOTAL"],
        rows: rows.map((r) => ({
          dims: { Producto: r.producto as string },
          metricas: {
            "Pers. Nat.": r.n_pers_nat != null ? Number(r.n_pers_nat) : null,
            "Pers. Jur. (no lucro)": r.n_pers_jur_no_lucro != null ? Number(r.n_pers_jur_no_lucro) : null,
            "Otras Pers. Jur.": r.n_otras_pers_jur != null ? Number(r.n_otras_pers_jur) : null,
            TOTAL: r.n_total != null ? Number(r.n_total) : null,
          },
        })),
      };
    }
    case "depositos": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT producto, COALESCE(clasificacion,'(sin)') AS clasificacion,
               saldo_pers_nat, saldo_pers_jur_no_lucro, saldo_otras_pers_jur, saldo_total
        FROM raw.depositos_observacion
        WHERE periodo = ${periodo} AND empresa = ${entidad}
        ORDER BY producto, clasificacion
      `);
      return {
        dimColumns: ["Producto", "Clasificación"],
        metricColumns: ["Pers. Nat.", "Pers. Jur. (no lucro)", "Otras Pers. Jur.", "TOTAL"],
        rows: rows.map((r) => ({
          dims: {
            Producto: r.producto as string,
            Clasificación: r.clasificacion as string,
          },
          metricas: {
            "Pers. Nat.": r.saldo_pers_nat != null ? Number(r.saldo_pers_nat) : null,
            "Pers. Jur. (no lucro)": r.saldo_pers_jur_no_lucro != null ? Number(r.saldo_pers_jur_no_lucro) : null,
            "Otras Pers. Jur.": r.saldo_otras_pers_jur != null ? Number(r.saldo_otras_pers_jur) : null,
            TOTAL: r.saldo_total != null ? Number(r.saldo_total) : null,
          },
        })),
      };
    }
    case "colocaciones": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT producto, COALESCE(clasificacion,'(sin)') AS clasificacion,
               saldo_vigente, saldo_reest_refin, saldo_atrasado, saldo_total
        FROM raw.colocaciones_observacion
        WHERE periodo = ${periodo} AND empresa = ${entidad}
        ORDER BY producto, clasificacion
      `);
      return {
        dimColumns: ["Producto", "Clasificación"],
        metricColumns: ["Vigente", "Reest./Refin.", "Atrasado", "TOTAL"],
        rows: rows.map((r) => ({
          dims: {
            Producto: r.producto as string,
            Clasificación: r.clasificacion as string,
          },
          metricas: {
            Vigente: r.saldo_vigente != null ? Number(r.saldo_vigente) : null,
            "Reest./Refin.": r.saldo_reest_refin != null ? Number(r.saldo_reest_refin) : null,
            Atrasado: r.saldo_atrasado != null ? Number(r.saldo_atrasado) : null,
            TOTAL: r.saldo_total != null ? Number(r.saldo_total) : null,
          },
        })),
      };
    }
    case "castigos": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT producto, COALESCE(clasificacion,'(sin)') AS clasificacion,
               saldo_castigos
        FROM raw.castigos_observacion
        WHERE periodo = ${periodo} AND entidad = ${entidad}
        ORDER BY producto, clasificacion
      `);
      return {
        dimColumns: ["Producto", "Clasificación"],
        metricColumns: ["Saldo castigos"],
        rows: rows.map((r) => ({
          dims: {
            Producto: r.producto as string,
            Clasificación: r.clasificacion as string,
          },
          metricas: {
            "Saldo castigos": r.saldo_castigos != null ? Number(r.saldo_castigos) : null,
          },
        })),
      };
    }
    case "indicadores": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT seccion, indicador, valor
        FROM raw.indicadores_prudenciales
        WHERE periodo = ${periodo} AND entidad = ${entidad}
        ORDER BY seccion, indicador
      `);
      return {
        dimColumns: ["Sección", "Indicador"],
        metricColumns: ["Valor"],
        rows: rows.map((r) => ({
          dims: {
            Sección: r.seccion as string,
            Indicador: r.indicador as string,
          },
          metricas: { Valor: r.valor != null ? Number(r.valor) : null },
        })),
      };
    }
    case "creditos_depositos_geo": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT departamento, provincia, distrito,
               COUNT(*)::int AS n_oficinas
        FROM raw.creditos_depositos_oficina
        WHERE periodo = ${periodo} AND empresa_sbs = ${entidad}
        GROUP BY departamento, provincia, distrito
        ORDER BY departamento, provincia, distrito
      `);
      return {
        dimColumns: ["Departamento", "Provincia", "Distrito"],
        metricColumns: ["N oficinas"],
        rows: rows.map((r) => ({
          dims: {
            Departamento: r.departamento as string,
            Provincia: (r.provincia as string) ?? "",
            Distrito: (r.distrito as string) ?? "",
          },
          metricas: { "N oficinas": Number(r.n_oficinas) },
        })),
      };
    }
    case "eeff": {
      const rows = await db.execute<Record<string, unknown>>(sql`
        SELECT cuenta_codigo, cuenta_nombre, tipo_estado, moneda, valor
        FROM raw.eeff_observacion
        WHERE periodo = ${periodo} AND nomb_correg = ${entidad}
        ORDER BY tipo_estado, cuenta_codigo, moneda
      `);
      return {
        dimColumns: ["Tipo Estado", "Código", "Nombre", "Moneda"],
        metricColumns: ["Valor"],
        rows: rows.map((r) => ({
          dims: {
            "Tipo Estado": r.tipo_estado as string,
            Código: r.cuenta_codigo as string,
            Nombre: r.cuenta_nombre as string,
            Moneda: r.moneda as string,
          },
          metricas: { Valor: r.valor != null ? Number(r.valor) : null },
        })),
      };
    }
    default:
      return { dimColumns: [], metricColumns: [], rows: [] };
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Verificacion archivo vs procesado                                         */
/* ──────────────────────────────────────────────────────────────────────── */

/** Cada archivo descargado con: filas que el importer DIJO insertar (snapshot)
 *  vs filas que ACTUALMENTE estan en raw.<topico>_observacion. Diff indica
 *  perdida o re-import incompleto. */
export type VerificacionArchivo = {
  archivoId: string;
  grupo: string;
  nombreArchivo: string;
  status: string;
  /** Filas que el importer reporto al insertar (snapshot momento del import). */
  filasInsertadasSnapshot: number | null;
  /** Filas que ACTUALMENTE estan en raw.<topico>_observacion para
   *  (periodo, tipo_entidad) inferido del grupo. */
  filasActualesRaw: number;
  /** Diff: snapshot - actuales. >0 = se perdieron filas, <0 = se agregaron
   *  filas post-import (raro), 0 = todo OK. */
  diff: number;
  estado: "ok" | "diff_perdidas" | "diff_agregadas" | "sin_data" | "no_procesado";
};

/** Mapping grupo (path raw) → tipo_entidad (columna en raw.*). */
const GRUPO_TO_TIPO_ENTIDAD: Record<string, string> = {
  banca_multiple: "BANCOS",
  financiera: "FINANCIERAS",
  cmac: "CMAC",
  crac: "CRAC",
  edpyme: "EDPYMES",
};

export async function getVerificacionTopico(
  topico: string,
  periodo: number,
): Promise<VerificacionArchivo[]> {
  const info = TOPICO_REGISTRY[topico];
  if (!info) return [];

  // 1. Archivos descargados del periodo
  const archivos = await db.execute<Record<string, unknown>>(sql`
    SELECT id::text, grupo, nombre_archivo, status, filas_insertadas
    FROM raw.archivos_descargados
    WHERE topico = ${topico} AND periodo = ${periodo}
    ORDER BY grupo
  `);

  // 2. Conteo actual en raw por tipo_entidad
  const colGrupo = info.columnaGrupo;
  let conteosRaw = new Map<string, number>();
  if (colGrupo) {
    const conteos = await db.execute<{ tipo: string; n: number }>(sql`
      SELECT ${sql.raw(colGrupo)} AS tipo, COUNT(*)::int AS n
      FROM ${sql.raw(info.tablaRaw)}
      WHERE ${sql.raw(info.columnaPeriodo)} = ${periodo}
      GROUP BY ${sql.raw(colGrupo)}
    `);
    conteosRaw = new Map(conteos.map((c) => [c.tipo, Number(c.n)]));
  } else {
    // Topicos sin columna de grupo (creditos_depositos_geo, indicadores):
    // contar todo y asignar el total al primer (y unico) archivo.
    const total = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM ${sql.raw(info.tablaRaw)}
      WHERE ${sql.raw(info.columnaPeriodo)} = ${periodo}
    `);
    conteosRaw.set("__all__", Number(total[0]?.n ?? 0));
  }

  return archivos.map((a) => {
    const grupo = a.grupo as string;
    const tipo = colGrupo ? GRUPO_TO_TIPO_ENTIDAD[grupo] ?? grupo.toUpperCase() : "__all__";
    const snapshot = a.filas_insertadas != null ? Number(a.filas_insertadas) : null;
    const actuales = conteosRaw.get(tipo) ?? 0;
    const diff = snapshot != null ? snapshot - actuales : 0;

    let estado: VerificacionArchivo["estado"];
    if (snapshot == null) {
      estado = "no_procesado";
    } else if (snapshot === 0 && actuales === 0) {
      estado = "sin_data";
    } else if (diff === 0) {
      estado = "ok";
    } else if (diff > 0) {
      estado = "diff_perdidas";
    } else {
      estado = "diff_agregadas";
    }

    return {
      archivoId: a.id as string,
      grupo,
      nombreArchivo: a.nombre_archivo as string,
      status: a.status as string,
      filasInsertadasSnapshot: snapshot,
      filasActualesRaw: actuales,
      diff,
      estado,
    };
  });
}

/** Lista entidades esperadas (de dim_entidad) vs presentes en raw para el
 *  periodo + topico. Util para detectar "entidades fantasma" — declaradas en
 *  la maestra pero sin filas en raw para ese periodo. */
export type VerificacionEntidad = {
  entidad: string;
  tipoEntidad: string;
  presente: boolean;
  filasRaw: number;
};

export async function getVerificacionEntidades(
  topico: string,
  periodo: number,
): Promise<VerificacionEntidad[]> {
  const info = TOPICO_REGISTRY[topico];
  if (!info || !info.columnaEntidad || !info.columnaGrupo) return [];

  // "esperadas" = entidades que reportaron al topico en los ULTIMOS 12 periodos
  // (no toda la maestra historica). Asi evitamos falsos faltantes por entidades
  // fusionadas/cerradas hace anios. Si la entidad reporto recientemente y no
  // este periodo, es genuinamente "faltante" o "no publico aun".
  const rows = await db.execute<Record<string, unknown>>(sql`
    WITH esperadas AS (
      SELECT
        dw.resolver_nomb_correg_canonico(${sql.raw(info.columnaEntidad)}) AS entidad,
        ${sql.raw(info.columnaGrupo)} AS tipo_entidad,
        COUNT(DISTINCT ${sql.raw(info.columnaPeriodo)}) AS n_periodos_reporto
      FROM ${sql.raw(info.tablaRaw)}
      WHERE ${sql.raw(info.columnaPeriodo)} BETWEEN ${periodo - 100} AND ${periodo}
        AND ${sql.raw(info.columnaGrupo)} IN ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES')
      GROUP BY 1, 2
      HAVING COUNT(DISTINCT ${sql.raw(info.columnaPeriodo)}) >= 1
    ),
    presentes AS (
      SELECT
        dw.resolver_nomb_correg_canonico(${sql.raw(info.columnaEntidad)}) AS entidad,
        ${sql.raw(info.columnaGrupo)} AS tipo,
        COUNT(*)::int AS n
      FROM ${sql.raw(info.tablaRaw)}
      WHERE ${sql.raw(info.columnaPeriodo)} = ${periodo}
      GROUP BY 1, 2
    )
    SELECT e.entidad, e.tipo_entidad,
           COALESCE(p.n, 0) AS filas_raw,
           (p.n IS NOT NULL) AS presente
    FROM esperadas e
    LEFT JOIN presentes p ON p.entidad = e.entidad AND p.tipo = e.tipo_entidad
    ORDER BY e.tipo_entidad, e.entidad
  `);

  return rows.map((r) => ({
    entidad: r.entidad as string,
    tipoEntidad: r.tipo_entidad as string,
    presente: Boolean(r.presente),
    filasRaw: Number(r.filas_raw),
  }));
}

/** Lista de archivos descargados para periodo+topico con su status + URL. */
export type ArchivoTopicoRow = {
  id: string;
  grupo: string;
  nombreArchivo: string;
  sourceUrl: string;
  pathLocal: string;
  status: string;
  filasInsertadas: number | null;
  errorMensaje: string | null;
  descargadoEn: string;
  procesadoEn: string | null;
};

export async function getArchivosTopico(
  topico: string,
  periodo: number,
): Promise<ArchivoTopicoRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id::text, grupo, nombre_archivo, source_url, path_local, status,
           filas_insertadas, error_mensaje,
           descargado_en::text, procesado_en::text
    FROM raw.archivos_descargados
    WHERE topico = ${topico} AND periodo = ${periodo}
    ORDER BY grupo
  `);
  return rows.map((r) => ({
    id: r.id as string,
    grupo: r.grupo as string,
    nombreArchivo: r.nombre_archivo as string,
    sourceUrl: r.source_url as string,
    pathLocal: r.path_local as string,
    status: r.status as string,
    filasInsertadas: r.filas_insertadas != null ? Number(r.filas_insertadas) : null,
    errorMensaje: (r.error_mensaje as string) ?? null,
    descargadoEn: r.descargado_en as string,
    procesadoEn: (r.procesado_en as string) ?? null,
  }));
}
