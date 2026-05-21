/**
 * Queries del domain analytics — leen las vistas materializadas marts.*
 *
 * Usamos raw SQL (via postgres-js) en lugar de Drizzle ORM porque:
 * 1. Las vistas materializadas tienen 92+ columnas dinamicas (cta_a1, cta_b2.4, ...)
 *    y no queremos mantener el schema TS sincronizado a mano.
 * 2. Joins entre dim_cuenta y mv_eeff_*_ancho requieren UNPIVOT — mas natural
 *    en SQL puro.
 *
 * Todas las funciones devuelven tipos publicos definidos en types.ts.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

import type {
  BalanceCuenta,
  BalanceEntidadPeriodo,
  Entidad,
  Moneda,
  RatioEeff,
} from "./types";

// ============================================================================
// Entidades
// ============================================================================

export async function listEntidades(opts: {
  tipoEntidad?: string;
  soloMicrofinancieras?: boolean;
} = {}): Promise<Entidad[]> {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (opts.tipoEntidad) {
    params.push(opts.tipoEntidad);
    conds.push(`tipo_entidad = $${params.length}`);
  }
  if (opts.soloMicrofinancieras) {
    conds.push(`microfinanciera = 'SI'`);
  }

  const whereClause = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await db.execute<Record<string, unknown>>(
    sql.raw(`
      SELECT
        nomb_correg                                AS "nombCorreg",
        MAX(empresa_sbs)                           AS "empresaSbs",
        MAX(tipo_entidad)                          AS "tipoEntidad",
        BOOL_OR(microfinanciera = 'SI')            AS "microfinanciera",
        MAX(nacional)                              AS "nacional",
        MIN(periodo)                               AS "primerPeriodo",
        MAX(periodo)                               AS "ultimoPeriodo"
      FROM raw.eeff_observacion
      ${whereClause}
      GROUP BY nomb_correg
      ORDER BY nomb_correg
    `),
  );
  return rows.map((r) => ({
    nombCorreg: String(r.nombCorreg),
    empresaSbs: r.empresaSbs as string | null,
    tipoEntidad: String(r.tipoEntidad),
    microfinanciera: Boolean(r.microfinanciera),
    nacional: r.nacional as string | null,
    primerPeriodo: Number(r.primerPeriodo),
    ultimoPeriodo: Number(r.ultimoPeriodo),
  }));
}

// ============================================================================
// Ratios
// ============================================================================

export async function getRatios(opts: {
  entidad: string;
  moneda?: Moneda;
  desde?: number;
  hasta?: number;
}): Promise<RatioEeff[]> {
  const moneda = opts.moneda ?? "TOTAL";

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT
        periodo,
        TO_CHAR(fecha_cierre, 'YYYY-MM-DD')        AS "fechaCierre",
        nomb_correg                                 AS "nombCorreg",
        empresa_sbs                                 AS "empresaSbs",
        tipo_entidad                                AS "tipoEntidad",
        microfinanciera,
        nacional,
        moneda,
        total_activo                                AS "totalActivo",
        total_pasivo                                AS "totalPasivo",
        patrimonio,
        utilidad_neta                               AS "utilidadNeta",
        cartera_bruta                               AS "carteraBruta",
        ratio_mora                                  AS "ratioMora",
        ratio_cobertura_atrasados                   AS "ratioCoberturaAtrasados",
        ratio_cobertura_car                         AS "ratioCoberturaCar",
        depositos_sbs                               AS "depositosSbs",
        total_fondeo                                AS "totalFondeo",
        ratio_ahorros_sobre_fondeo                  AS "ratioAhorrosSobreFondeo",
        gasto_fondeo                                AS "gastoFondeo",
        ingresos_totales                            AS "ingresosTotales",
        ratio_eficiencia                            AS "ratioEficiencia",
        roa,
        roe,
        apalancamiento
      FROM marts.mv_eeff_ratios
      WHERE nomb_correg = ${opts.entidad}
        AND moneda = ${moneda}
        AND (${opts.desde ?? null}::int IS NULL OR periodo >= ${opts.desde ?? null}::int)
        AND (${opts.hasta ?? null}::int IS NULL OR periodo <= ${opts.hasta ?? null}::int)
      ORDER BY periodo ASC
    `,
  );

  return rows.map(numericRowToRatio);
}

export async function getRatiosLatest(opts: {
  tipoEntidad?: string;
  moneda?: Moneda;
} = {}): Promise<RatioEeff[]> {
  const moneda = opts.moneda ?? "TOTAL";
  const tipoEntidad = opts.tipoEntidad ?? null;

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      WITH ultimo AS (
        SELECT MAX(periodo) AS p FROM marts.mv_eeff_ratios
      )
      SELECT
        periodo, TO_CHAR(fecha_cierre, 'YYYY-MM-DD') AS "fechaCierre",
        nomb_correg AS "nombCorreg", empresa_sbs AS "empresaSbs",
        tipo_entidad AS "tipoEntidad", microfinanciera, nacional, moneda,
        total_activo AS "totalActivo", total_pasivo AS "totalPasivo",
        patrimonio, utilidad_neta AS "utilidadNeta",
        cartera_bruta AS "carteraBruta",
        ratio_mora AS "ratioMora",
        ratio_cobertura_atrasados AS "ratioCoberturaAtrasados",
        ratio_cobertura_car AS "ratioCoberturaCar",
        depositos_sbs AS "depositosSbs",
        total_fondeo AS "totalFondeo",
        ratio_ahorros_sobre_fondeo AS "ratioAhorrosSobreFondeo",
        gasto_fondeo AS "gastoFondeo",
        ingresos_totales AS "ingresosTotales",
        ratio_eficiencia AS "ratioEficiencia",
        roa, roe, apalancamiento
      FROM marts.mv_eeff_ratios
      WHERE periodo = (SELECT p FROM ultimo)
        AND moneda = ${moneda}
        AND (${tipoEntidad}::text IS NULL OR tipo_entidad = ${tipoEntidad}::text)
      ORDER BY nomb_correg
    `,
  );

  return rows.map(numericRowToRatio);
}

// ============================================================================
// Balance (long format desde raw, joined con dim_cuenta para nombres)
// ============================================================================

export async function getBalance(opts: {
  entidad: string;
  periodo: number;
  moneda?: Moneda;
}): Promise<BalanceEntidadPeriodo> {
  const moneda = opts.moneda ?? "TOTAL";

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT
        c.codigo,
        c.nombre,
        c.nivel,
        c.parent_codigo AS "parentCodigo",
        o.valor
      FROM dw.dim_cuenta c
      LEFT JOIN raw.eeff_observacion o
        ON o.cuenta_codigo = c.codigo
       AND o.nomb_correg = ${opts.entidad}
       AND o.periodo = ${opts.periodo}
       AND o.moneda = ${moneda}
       AND o.tipo_estado = 'balance'
      WHERE c.tipo_estado = 'balance'
      ORDER BY c.orden ASC
    `,
  );

  const cuentas: BalanceCuenta[] = rows.map((r) => ({
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    nivel: Number(r.nivel),
    parentCodigo: r.parentCodigo as string | null,
    valor: r.valor != null ? Number(r.valor) : null,
  }));

  return {
    periodo: opts.periodo,
    nombCorreg: opts.entidad,
    moneda,
    cuentas,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function numericRowToRatio(r: Record<string, unknown>): RatioEeff {
  const num = (k: string): number | null => {
    const v = r[k];
    return v == null ? null : Number(v);
  };
  const str = (k: string): string => String(r[k]);
  const strN = (k: string): string | null =>
    r[k] == null ? null : String(r[k]);

  return {
    periodo: Number(r.periodo),
    fechaCierre: String(r.fechaCierre),
    nombCorreg: str("nombCorreg"),
    empresaSbs: strN("empresaSbs"),
    tipoEntidad: str("tipoEntidad"),
    microfinanciera: strN("microfinanciera"),
    nacional: strN("nacional"),
    moneda: str("moneda") as Moneda,
    totalActivo: num("totalActivo"),
    totalPasivo: num("totalPasivo"),
    patrimonio: num("patrimonio"),
    utilidadNeta: num("utilidadNeta"),
    carteraBruta: num("carteraBruta"),
    ratioMora: num("ratioMora"),
    ratioCoberturaAtrasados: num("ratioCoberturaAtrasados"),
    ratioCoberturaCar: num("ratioCoberturaCar"),
    depositosSbs: num("depositosSbs"),
    totalFondeo: num("totalFondeo"),
    ratioAhorrosSobreFondeo: num("ratioAhorrosSobreFondeo"),
    gastoFondeo: num("gastoFondeo"),
    ingresosTotales: num("ingresosTotales"),
    ratioEficiencia: num("ratioEficiencia"),
    roa: num("roa"),
    roe: num("roe"),
    apalancamiento: num("apalancamiento"),
  };
}
