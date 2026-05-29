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

import type { EeffInspectorData, EeffRow, EntidadOption } from "./types";

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
 * LEFT JOIN a raw para los valores en MN, ME y TOTAL simultaneamente.
 * Driver = cabecera, no raw.
 */
export async function getEeffInspectorData(
  entidad: string,
  periodo: number,
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

  // Iterar cabecera_maestra para balance y resultados con 3 monedas.
  const balance = await fetchByTipoEstado(entidad, periodo, periodoPrev, "balance", tipoEntidad);
  const resultados = await fetchByTipoEstado(
    entidad,
    periodo,
    periodoPrev,
    "resultados",
    tipoEntidad,
  );

  // Extras: filas en raw que NO estan en cabecera-base (drift detectado).
  const extrasBalance = await fetchExtras(entidad, periodo, "balance", tipoEntidad);
  const extrasResultados = await fetchExtras(entidad, periodo, "resultados", tipoEntidad);

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
  tipoEstado: "balance" | "resultados",
  tipoEntidad: string,
): Promise<EeffRow[]> {
  // Driver: cabecera_maestra. Por cada orden hacemos pivote de las 3 monedas
  // (MN, ME, TOTAL) en una sola pasada via FILTER WHERE. Mas eficiente que
  // 3 LEFT JOIN separados, y devuelve las 3 columnas listas para la UI.
  //
  // raw.eeff_celda_cruda (issue #65) hace JOIN por cuenta_codigo (V114).
  // El orden de cabecera_maestra es por codigo_sort_key (V112) mientras que
  // el orden de celda_cruda es posicional del archivo — son distintos.
  // El codigo es la clave estable de negocio que matchea ambos lados.
  // Usamos LATERAL + LIMIT 1 porque el importer puede haber dedupeado
  // multiples filas archivo al mismo codigo y aun asi grabar ambas en cruda.
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      cm.orden,
      cm.codigo                                   AS cuenta_codigo,
      cm.nombre                                   AS nombre_canonico,
      cm.nivel,
      cm.es_header,
      cm.es_total,
      cm.es_seccion,
      eo.nombre_archivo,
      eo.valor_mn,
      eo.valor_me,
      eo.valor_total,
      cc.valor_mn                                 AS xls_valor_mn,
      cc.valor_me                                 AS xls_valor_me,
      cc.valor_total                              AS xls_valor_total,
      prev.valor_total                            AS valor_prev,
      (eo.valor_total - prev.valor_total)         AS delta_abs,
      CASE
        WHEN prev.valor_total IS NULL OR prev.valor_total = 0 THEN NULL
        ELSE (eo.valor_total - prev.valor_total) / ABS(prev.valor_total)
      END                                         AS delta_pct,
      COALESCE(q.qstatus, 'ok')                   AS quality_status,
      -- Aliases registrados para este codigo: si el file_name normalizado matchea
      -- algun alias, NO consideramos mismatch (V108).
      COALESCE(al.alias_norms, ARRAY[]::text[])   AS alias_norms
    FROM dw.cabecera_maestra cm
    LEFT JOIN LATERAL (
      SELECT
        MAX(cuenta_nombre)                              AS nombre_archivo,
        MAX(valor) FILTER (WHERE moneda='MN')           AS valor_mn,
        MAX(valor) FILTER (WHERE moneda='ME')           AS valor_me,
        MAX(valor) FILTER (WHERE moneda='TOTAL')        AS valor_total
      FROM raw.eeff_observacion
      WHERE cm.codigo IS NOT NULL
        AND cuenta_codigo = cm.codigo
        AND nomb_correg   = ${entidad}
        AND periodo       = ${periodo}
        AND tipo_estado   = cm.tipo_estado
    ) eo ON TRUE
    LEFT JOIN LATERAL (
      SELECT valor_mn, valor_me, valor_total
      FROM raw.eeff_celda_cruda
      WHERE cm.codigo IS NOT NULL
        AND cuenta_codigo = cm.codigo
        AND nomb_correg   = ${entidad}
        AND periodo       = ${periodo}
        AND tipo_estado   = cm.tipo_estado
      ORDER BY orden
      LIMIT 1
    ) cc ON TRUE
    LEFT JOIN LATERAL (
      SELECT MAX(valor) FILTER (WHERE moneda='TOTAL') AS valor_total
      FROM raw.eeff_observacion
      WHERE cm.codigo IS NOT NULL
        AND ${periodoPrev !== null}::boolean
        AND cuenta_codigo = cm.codigo
        AND nomb_correg   = ${entidad}
        AND periodo       = ${periodoPrev ?? 0}
        AND tipo_estado   = cm.tipo_estado
    ) prev ON TRUE
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
    LEFT JOIN LATERAL (
      SELECT array_agg(alias_norm) AS alias_norms
      FROM dw.cuenta_alias
      WHERE tipo_estado = cm.tipo_estado AND codigo = cm.codigo
    ) al ON cm.codigo IS NOT NULL
    WHERE cm.tipo_estado = ${tipoEstado}
      AND cm.tipo_entidad = ${tipoEntidad}
      AND cm.valido_desde <= ${periodo}
      AND (cm.valido_hasta IS NULL OR cm.valido_hasta >= ${periodo})
    ORDER BY cm.orden
  `);

  return rows.map((r) => {
    const nombreCanonica = r.nombre_canonico as string;
    const nombreArchivo = (r.nombre_archivo as string | null) ?? null;
    const codigo = (r.cuenta_codigo as string | null) ?? null;
    const esHeader = Boolean(r.es_header);
    const esTotal = Boolean(r.es_total);
    const esSeccion = Boolean(r.es_seccion);
    const esperaValor = codigo !== null && !esSeccion;
    const faltaEnRaw = esperaValor && nombreArchivo === null;
    const valorTotal = r.valor_total != null ? Number(r.valor_total) : null;
    const xlsValorTotal = r.xls_valor_total != null ? Number(r.xls_valor_total) : null;
    // diffTotal: solo significativa cuando AMBOS estan presentes. Si xls es NULL
    // (caso BANCOS: SBS no publica TOTAL crudo) no podemos comparar honestamente.
    // Si diff es 0 dejamos NULL para que la UI no pinte nada — solo destacamos
    // diferencias reales. Tolerancia de redondeo a 0.01 (NUMERIC(20,4) en DB).
    const diffTotal = (() => {
      if (valorTotal == null || xlsValorTotal == null) return null;
      const d = valorTotal - xlsValorTotal;
      return Math.abs(d) < 0.01 ? null : d;
    })();
    return {
      orden: Number(r.orden),
      cuentaCodigo: codigo,
      cuentaNombreCanonica: nombreCanonica,
      cuentaNombreArchivo: nombreArchivo,
      nombreMismatch: (() => {
        if (nombreArchivo == null) return false;
        const normFile = normalize(nombreArchivo);
        if (normFile === normalize(nombreCanonica)) return false;
        // Si el file_name matchea algun alias registrado para este codigo,
        // NO es mismatch (V108).
        const aliases = (r.alias_norms as string[] | null) ?? [];
        return !aliases.includes(normFile);
      })(),
      faltaEnRaw,
      valorMN: r.valor_mn != null ? Number(r.valor_mn) : null,
      valorME: r.valor_me != null ? Number(r.valor_me) : null,
      valorTotal,
      xlsValorMN: r.xls_valor_mn != null ? Number(r.xls_valor_mn) : null,
      xlsValorME: r.xls_valor_me != null ? Number(r.xls_valor_me) : null,
      xlsValorTotal,
      diffTotal,
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

/** Filas en raw.eeff_observacion que NO estan en la cabecera-base.
 *  Devuelve las 3 monedas pivoteadas por cuenta_codigo. */
async function fetchExtras(
  entidad: string,
  periodo: number,
  tipoEstado: "balance" | "resultados",
  tipoEntidad: string,
): Promise<
  {
    cuentaCodigo: string;
    cuentaNombre: string;
    valorMN: number | null;
    valorME: number | null;
    valorTotal: number | null;
  }[]
> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      eo.cuenta_codigo,
      MAX(eo.cuenta_nombre)                              AS cuenta_nombre,
      MAX(eo.valor) FILTER (WHERE eo.moneda='MN')        AS valor_mn,
      MAX(eo.valor) FILTER (WHERE eo.moneda='ME')        AS valor_me,
      MAX(eo.valor) FILTER (WHERE eo.moneda='TOTAL')     AS valor_total
    FROM raw.eeff_observacion eo
    WHERE eo.nomb_correg = ${entidad}
      AND eo.periodo = ${periodo}
      AND eo.tipo_estado = ${tipoEstado}
      AND NOT EXISTS (
        SELECT 1 FROM dw.cabecera_maestra cm
        WHERE cm.tipo_estado = ${tipoEstado}
          AND cm.tipo_entidad = ${tipoEntidad}
          AND cm.codigo = eo.cuenta_codigo
          AND cm.valido_desde <= ${periodo}
          AND (cm.valido_hasta IS NULL OR cm.valido_hasta >= ${periodo})
      )
    GROUP BY eo.cuenta_codigo
    ORDER BY eo.cuenta_codigo
  `);

  return rows.map((r) => ({
    cuentaCodigo: r.cuenta_codigo as string,
    cuentaNombre: r.cuenta_nombre as string,
    valorMN: r.valor_mn != null ? Number(r.valor_mn) : null,
    valorME: r.valor_me != null ? Number(r.valor_me) : null,
    valorTotal: r.valor_total != null ? Number(r.valor_total) : null,
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
