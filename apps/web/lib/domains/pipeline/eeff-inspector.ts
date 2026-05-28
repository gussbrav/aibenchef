/**
 * EEFF Inspector — queries para validar el mapeo cuenta-por-cuenta (issue #26).
 *
 * **Diseño clave**: el driver de la query es `dw.cabecera_maestra` — las
 * cabeceras-base que definio el operador como verdad-fuente. Para cada
 * orden de la cabecera hacemos LEFT JOIN con raw.eeff_observacion para ver
 * que valor el parser asigno. Esto permite:
 *
 *   - Renderizar el balance/ER tal como esta diseñado (jerarquia, headers,
 *     totales) — no como cae en la DB.
 *   - Detectar filas que la cabecera espera pero el parser NO persistio
 *     (faltaEnRaw = true → bug del parser o estructura cambio en SBS).
 *   - Comparar nombre archivo SBS vs nombre canonico (nombreMismatch =
 *     true → drift de nomenclatura, hay que revisar cabecera).
 *
 * Tambien retorna `extras*` (filas en raw.eeff_observacion que NO estan
 * en la cabecera) — caso del bug issue #15.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

import type {
  EeffInspectorData,
  EeffRow,
  EntidadOption,
  Moneda,
} from "./types";

/** Lista entidades con data en el periodo (para dropdown). */
export async function listEntidadesPorPeriodo(periodo: number): Promise<EntidadOption[]> {
  const rows = await db.execute<{ nomb_correg: string; tipo_entidad: string }>(sql`
    SELECT DISTINCT nomb_correg, tipo_entidad
    FROM raw.eeff_observacion
    WHERE periodo = ${periodo}
    ORDER BY tipo_entidad, nomb_correg
  `);
  return rows.map((r) => ({
    nombCorreg: r.nomb_correg as string,
    tipoEntidad: r.tipo_entidad as string,
  }));
}

/** Lista periodos donde la entidad tiene data (para dropdown). */
export async function listPeriodosPorEntidad(entidad: string): Promise<number[]> {
  const rows = await db.execute<{ p: number }>(sql`
    SELECT DISTINCT periodo AS p
    FROM raw.eeff_observacion
    WHERE nomb_correg = ${entidad}
    ORDER BY periodo DESC
  `);
  return rows.map((r) => Number(r.p));
}

/** Lista todos los periodos disponibles en raw.eeff_observacion (para dropdown). */
export async function listAllPeriodos(): Promise<number[]> {
  const rows = await db.execute<{ p: number }>(sql`
    SELECT DISTINCT periodo AS p
    FROM raw.eeff_observacion
    ORDER BY periodo DESC
  `);
  return rows.map((r) => Number(r.p));
}

/**
 * Fetch principal del inspector: BG + ER iterando la cabecera-base con
 * LEFT JOIN a raw para los valores. Driver = cabecera, no raw.
 */
export async function getEeffInspectorData(
  entidad: string,
  periodo: number,
  moneda: Moneda,
): Promise<EeffInspectorData | null> {
  // Resolver tipo_entidad + periodo previo desde la entidad.
  const meta = await db.execute<{ tipo_entidad: string; periodo_prev: number | null }>(sql`
    SELECT
      MAX(tipo_entidad)::text AS tipo_entidad,
      (
        SELECT MAX(periodo) FROM raw.eeff_observacion
        WHERE nomb_correg = ${entidad} AND periodo < ${periodo}
      )::int AS periodo_prev
    FROM raw.eeff_observacion
    WHERE nomb_correg = ${entidad} AND periodo = ${periodo}
  `);

  if (!meta[0] || !meta[0].tipo_entidad) return null;

  const tipoEntidad = meta[0].tipo_entidad;
  const periodoPrev = meta[0].periodo_prev;

  // Iterar cabecera_maestra para balance y resultados.
  const balance = await fetchByTipoEstado(
    entidad,
    periodo,
    periodoPrev,
    moneda,
    "balance",
    tipoEntidad,
  );
  const resultados = await fetchByTipoEstado(
    entidad,
    periodo,
    periodoPrev,
    moneda,
    "resultados",
    tipoEntidad,
  );

  // Extras: filas en raw que NO estan en cabecera-base (drift detectado).
  const extrasBalance = await fetchExtras(entidad, periodo, moneda, "balance", tipoEntidad);
  const extrasResultados = await fetchExtras(
    entidad,
    periodo,
    moneda,
    "resultados",
    tipoEntidad,
  );

  // Quality summary
  const qcRows = await db.execute<Record<string, unknown>>(sql`
    SELECT check_type, status, count(*)::int AS n
    FROM admin.data_quality_checks
    WHERE periodo = ${periodo} AND nomb_correg = ${entidad}
    GROUP BY check_type, status
  `);
  const qualitySummary = {
    balance: { critical: 0, warning: 0, ok: 0 },
    outliers: { critical: 0, warning: 0, ok: 0 },
    subcuentas: { critical: 0, warning: 0, ok: 0 },
  };
  for (const r of qcRows) {
    const key =
      r.check_type === "balance_contable"
        ? "balance"
        : r.check_type === "outlier_zscore"
          ? "outliers"
          : "subcuentas";
    const status = r.status as keyof typeof qualitySummary.balance;
    if (status in qualitySummary[key]) {
      qualitySummary[key][status] = Number(r.n);
    }
  }

  // Archivos descargados (el xls del periodo+grupo+entidad).
  const archivos = await db.execute<Record<string, unknown>>(sql`
    SELECT topico, path_local, source_url
    FROM raw.archivos_descargados
    WHERE periodo = ${periodo}
      AND topico = 'eeff'
      AND grupo = (
        SELECT CASE LOWER(${tipoEntidad})
          WHEN 'bancos' THEN 'banca_multiple'
          WHEN 'financieras' THEN 'financiera'
          WHEN 'cmac' THEN 'cmac'
          WHEN 'crac' THEN 'crac'
          WHEN 'edpymes' THEN 'edpyme'
        END
      )
    ORDER BY topico
  `);

  return {
    entidad,
    periodo,
    periodoPrevio: periodoPrev,
    moneda,
    tipoEntidad,
    balance,
    resultados,
    extrasBalance,
    extrasResultados,
    qualitySummary,
    archivos: archivos.map((a) => ({
      topico: a.topico as string,
      pathLocal: a.path_local as string,
      sourceUrl: a.source_url as string,
    })),
  };
}

async function fetchByTipoEstado(
  entidad: string,
  periodo: number,
  periodoPrev: number | null,
  moneda: Moneda,
  tipoEstado: "balance" | "resultados",
  tipoEntidad: string,
): Promise<EeffRow[]> {
  // Driver: cabecera_maestra. Para cada orden, hacer LEFT JOIN con raw del
  // periodo solicitado y con raw del periodo previo (para delta).
  // Solo joineamos cuando codigo IS NOT NULL — las filas-marker (codigo
  // NULL en cabecera) no tienen valor propio.
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      cm.orden,
      cm.codigo                AS cuenta_codigo,
      cm.nombre                AS nombre_canonico,
      cm.nivel,
      cm.es_header,
      cm.es_total,
      cm.es_seccion,
      eo.cuenta_nombre         AS nombre_archivo,
      eo.valor,
      prev.valor               AS valor_prev,
      (eo.valor - prev.valor)  AS delta_abs,
      CASE
        WHEN prev.valor IS NULL OR prev.valor = 0 THEN NULL
        ELSE (eo.valor - prev.valor) / ABS(prev.valor)
      END                      AS delta_pct,
      COALESCE(q.qstatus, 'ok') AS quality_status
    FROM dw.cabecera_maestra cm
    LEFT JOIN raw.eeff_observacion eo
      ON cm.codigo IS NOT NULL
     AND eo.cuenta_codigo = cm.codigo
     AND eo.nomb_correg   = ${entidad}
     AND eo.periodo       = ${periodo}
     AND eo.tipo_estado   = cm.tipo_estado
     AND eo.moneda        = ${moneda}
    LEFT JOIN raw.eeff_observacion prev
      ON cm.codigo IS NOT NULL
     AND ${periodoPrev !== null}::boolean
     AND prev.cuenta_codigo = cm.codigo
     AND prev.nomb_correg   = ${entidad}
     AND prev.periodo       = ${periodoPrev ?? 0}
     AND prev.tipo_estado   = cm.tipo_estado
     AND prev.moneda        = ${moneda}
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN bool_or(dqc.status = 'critical') THEN 'critical'
          WHEN bool_or(dqc.status = 'warning')  THEN 'warning'
          ELSE 'ok'
        END AS qstatus
      FROM admin.data_quality_checks dqc
      WHERE dqc.periodo = ${periodo}
        AND dqc.nomb_correg = ${entidad}
        AND dqc.reviewed_at IS NULL
        AND (dqc.cuenta_codigo = cm.codigo OR dqc.cuenta_codigo IS NULL)
    ) q ON TRUE
    WHERE cm.tipo_estado = ${tipoEstado}
      AND cm.tipo_entidad = ${tipoEntidad}
      AND cm.valido_hasta IS NULL
    ORDER BY cm.orden
  `);

  return rows.map((r) => {
    const nombreCanonica = r.nombre_canonico as string;
    const nombreArchivo = (r.nombre_archivo as string | null) ?? null;
    const codigo = (r.cuenta_codigo as string | null) ?? null;
    const esHeader = Boolean(r.es_header);
    const esTotal = Boolean(r.es_total);
    const esSeccion = Boolean(r.es_seccion);
    // faltaEnRaw: la cabecera espera valor (no es seccion ni header sin codigo)
    // pero el parser no lo persistio (nombreArchivo = NULL).
    const esperaValor = codigo !== null && !esSeccion;
    const faltaEnRaw = esperaValor && nombreArchivo === null;
    return {
      orden: Number(r.orden),
      cuentaCodigo: codigo,
      cuentaNombreCanonica: nombreCanonica,
      cuentaNombreArchivo: nombreArchivo,
      nombreMismatch:
        nombreArchivo != null && normalize(nombreArchivo) !== normalize(nombreCanonica),
      faltaEnRaw,
      valor: r.valor != null ? Number(r.valor) : null,
      valorPrev: r.valor_prev != null ? Number(r.valor_prev) : null,
      deltaPct: r.delta_pct != null ? Number(r.delta_pct) : null,
      deltaAbs: r.delta_abs != null ? Number(r.delta_abs) : null,
      qualityStatus: r.quality_status as EeffRow["qualityStatus"],
      nivel: Number(r.nivel),
      esHeader,
      esTotal,
      esSeccion,
    };
  });
}

/** Filas en raw.eeff_observacion que NO estan en la cabecera-base. */
async function fetchExtras(
  entidad: string,
  periodo: number,
  moneda: Moneda,
  tipoEstado: "balance" | "resultados",
  tipoEntidad: string,
): Promise<{ cuentaCodigo: string; cuentaNombre: string; valor: number | null }[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT eo.cuenta_codigo, eo.cuenta_nombre, eo.valor
    FROM raw.eeff_observacion eo
    WHERE eo.nomb_correg = ${entidad}
      AND eo.periodo = ${periodo}
      AND eo.tipo_estado = ${tipoEstado}
      AND eo.moneda = ${moneda}
      AND NOT EXISTS (
        SELECT 1 FROM dw.cabecera_maestra cm
        WHERE cm.tipo_estado = ${tipoEstado}
          AND cm.tipo_entidad = ${tipoEntidad}
          AND cm.codigo = eo.cuenta_codigo
          AND cm.valido_hasta IS NULL
      )
    ORDER BY eo.cuenta_codigo
  `);

  return rows.map((r) => ({
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombre: r.cuenta_nombre as string,
    valor: r.valor != null ? Number(r.valor) : null,
  }));
}

/** Normaliza nombres para comparar archivo vs cabecera (lowercase, strip espacios). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
