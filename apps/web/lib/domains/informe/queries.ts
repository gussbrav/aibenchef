// Queries reales del dominio "informe ejecutivo".
//
// Produce un InformeData consumiendo:
//   - config.cliente / config.peer_group / config.cliente_branding
//   - marts.v_punto_equilibrio_ancho (10 KPIs anualizados)
//   - marts.mv_eeff_balance_ancho (cartera, patrimonio, activos)
//   - marts.mv_eeff_resultados_ancho (utilidad, gastos)
//
// KPIs faltantes (oficinas, personal, clientes, mora, cobertura CAR)
// requieren datasets que aun no estan ingeridos. Mientras tanto se
// devuelven como NULL y la UI muestra "—".

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { logger } from "@/lib/domains/shared";

import type {
  Cliente,
  Competidor,
  EntidadDisponible,
  InformeData,
  Kpi,
  KpiValor,
  MargenNetoHistoricoRow,
  PuntoEquilibrioRow,
  BubblePoint,
  WaterfallData,
  CoberturaDatos,
} from "./types";
import { TEMAS_PRESET } from "./types";

const log = logger.child("informe");

// Helper: ejecuta una query y devuelve fallback si falla.
// Logueamos con stack para diagnostico desde EasyPanel.
async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as Error & { code?: string; detail?: string };
    log.error("informe_query_failed", {
      label,
      message: err.message,
      code: err.code,
      detail: err.detail,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
    return fallback;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"} ${anio}`;
}

function periodoMismoMesAnioPrev(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return (anio - 1) * 100 + mes;
}

/** Diciembre del año anterior al periodo. Para Abr 2020 → Dic 2019. */
function periodoDicAnioPrev(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  return (anio - 1) * 100 + 12;
}

// ============================================================================
// Lookups de configuracion
// ============================================================================

// Fallback usado cuando config.cliente no existe (V033 no aplicada) o el
// cliente solicitado no esta sembrado. Permite que la pagina renderice
// con un cliente "demo" en lugar de tirar 500.
const CLIENTE_FALLBACK: Cliente = {
  slug: "caja-arequipa",
  nombre: "Caja Municipal de Ahorro y Credito Arequipa (fallback)",
  nombreCorto: "Caja Arequipa",
  entidadPropia: "CMAC Arequipa",
  brand: { primary: "#0F2A5E", secondary: "#FFB300", acento: "#2563EB" },
};

export async function getClienteBySlug(slug: string): Promise<Cliente> {
  return safeQuery(
    "getClienteBySlug",
    async () => {
      const rows = await db.execute<{
        slug: string;
        nombre: string;
        nombre_corto: string;
        entidad_propia_nomb_correg: string;
        color_primary: string;
        color_secondary: string;
        color_acento: string;
      }>(sql`
        SELECT
          c.slug,
          c.nombre,
          c.nombre_corto,
          c.entidad_propia_nomb_correg,
          COALESCE(b.color_primary, '#0F2A5E')   AS color_primary,
          COALESCE(b.color_secondary, '#FFB300') AS color_secondary,
          COALESCE(b.color_acento, '#2563EB')    AS color_acento
        FROM config.cliente c
        LEFT JOIN config.cliente_branding b ON b.cliente_id = c.id
        WHERE c.slug = ${slug}
          AND c.activo
        LIMIT 1
      `);
      if (rows.length === 0) return CLIENTE_FALLBACK;
      const r = rows[0];
      return {
        slug: r.slug,
        nombre: r.nombre,
        nombreCorto: r.nombre_corto,
        entidadPropia: r.entidad_propia_nomb_correg,
        brand: { primary: r.color_primary, secondary: r.color_secondary, acento: r.color_acento },
      };
    },
    CLIENTE_FALLBACK,
  );
}

export async function getDefaultPeerGroup(clienteSlug: string): Promise<string[]> {
  return safeQuery(
    "getDefaultPeerGroup",
    async () => {
      const rows = await db.execute<{ competidor_nomb_correg: string }>(sql`
        SELECT pg.competidor_nomb_correg
        FROM config.peer_group pg
        JOIN config.cliente c ON c.id = pg.cliente_id
        WHERE c.slug = ${clienteSlug}
        ORDER BY pg.orden
      `);
      return rows.map((r) => String(r.competidor_nomb_correg));
    },
    [],
  );
}

// Default peer group fallback (si config.peer_group no existe o esta vacio).
// Usa las 6 entidades del benchmark Caja Arequipa.
const PEER_GROUP_FALLBACK: Array<{ competidor_nomb_correg: string; orden: number; color_hex: string; label_corto: string }> = [
  { competidor_nomb_correg: "Financiera Compartamos", orden: 1, color_hex: "#E91E63", label_corto: "Compartamos" },
  { competidor_nomb_correg: "Mibanco",                orden: 2, color_hex: "#4CAF50", label_corto: "Mibanco" },
  { competidor_nomb_correg: "CMAC Arequipa",          orden: 3, color_hex: "#0F2A5E", label_corto: "Caja Arequipa" },
  { competidor_nomb_correg: "CMAC Huancayo",          orden: 4, color_hex: "#F44336", label_corto: "CMAC Huancayo" },
  { competidor_nomb_correg: "CMAC Cusco",             orden: 5, color_hex: "#8D6E63", label_corto: "CMAC Cusco" },
  { competidor_nomb_correg: "CMAC Piura",             orden: 6, color_hex: "#42A5F5", label_corto: "CMAC Piura" },
];

async function buildCompetidores(
  clienteSlug: string,
  peerGroupOverride: string[] | null,
  entidadPropia: string,
): Promise<Competidor[]> {
  const configRows = await safeQuery(
    "buildCompetidores.configRows",
    async () =>
      db.execute<{
        competidor_nomb_correg: string;
        orden: number;
        color_hex: string;
        label_corto: string | null;
      }>(sql`
        SELECT pg.competidor_nomb_correg, pg.orden, pg.color_hex, pg.label_corto
        FROM config.peer_group pg
        JOIN config.cliente c ON c.id = pg.cliente_id
        WHERE c.slug = ${clienteSlug}
        ORDER BY pg.orden
      `),
    PEER_GROUP_FALLBACK as unknown as Array<{
      competidor_nomb_correg: string;
      orden: number;
      color_hex: string;
      label_corto: string | null;
    }>,
  );

  // Si la query exitosa devolvio 0 filas (config.cliente vacio), usar fallback
  const rowsToUse = configRows.length > 0 ? configRows : (PEER_GROUP_FALLBACK as Array<{
    competidor_nomb_correg: string;
    orden: number;
    color_hex: string;
    label_corto: string | null;
  }>);

  const configByNomb = new Map(
    rowsToUse.map((r) => [
      r.competidor_nomb_correg,
      { orden: r.orden, color: r.color_hex, label: r.label_corto ?? r.competidor_nomb_correg },
    ]),
  );

  const fallbackPalette = ["#E91E63", "#4CAF50", "#0F2A5E", "#F44336", "#8D6E63", "#42A5F5", "#FF9800", "#9C27B0"];

  const peerList = peerGroupOverride ?? rowsToUse.map((r) => r.competidor_nomb_correg);

  return peerList.map((nombCorreg, idx) => {
    const cfg = configByNomb.get(nombCorreg);
    return {
      nombCorreg,
      labelCorto: cfg?.label ?? nombCorreg,
      color: cfg?.color ?? fallbackPalette[idx % fallbackPalette.length],
      esPropio: nombCorreg === entidadPropia,
    };
  });
}

// ============================================================================
// Punto de Equilibrio
// ============================================================================

type PuntoEqRow = {
  nomb_correg: string;
  pct_rendimiento: number | null;
  pct_costo_fondeo: number | null;
  pct_provisiones: number | null;
  pct_gastos_op: number | null;
  pct_gastos_personal: number | null;
  pct_gastos_generales: number | null;
  pct_deprec: number | null;
  pct_otros: number | null;
  pct_punto_eq: number | null;
  pct_margen_neto: number | null;
};

async function getPuntoEquilibrioForPeriodo(periodo: number, entidades: string[], consolidar: boolean = true): Promise<Map<string, PuntoEqRow>> {
  if (entidades.length === 0) return new Map();

  const map = new Map<string, PuntoEqRow>();

  // Igual que getCuadroResumenRaw: mapeamos cada label del peer group a su
  // canonico (consolidar=true) o nombre vigente (consolidar=false), y el
  // SELECT devuelve input.label como nomb_correg para que map.get() siempre
  // encuentre. Esto garantiza que el cuadro PE muestre data para entidades
  // cuyo nombre actual difiere del nombre con que aparecen en marts (ej.
  // peer label "Compartamos" -> canonico "Compartamos Banco" en MVs).
  const entidadesArr = sql`ARRAY[${sql.join(entidades.map((e) => sql`${e}`), sql`, `)}]::text[]`;
  const runQuery = async () => {
    const r = await db.execute<PuntoEqRow>(sql`
      WITH input AS (
        SELECT label,
               ${consolidar
                 ? sql.raw(`dw.resolver_nomb_correg_para_periodo(label, ${periodo})`)
                 : sql.raw(`dw.nombre_vigente_en_periodo(label, ${periodo})`)} AS canon
        FROM unnest(${entidadesArr}) AS t(label)
      ),
      pe AS (
        SELECT nomb_correg, pct_rendimiento, pct_costo_fondeo, pct_provisiones,
               pct_gastos_op, pct_gastos_personal, pct_gastos_generales, pct_deprec,
               pct_otros, pct_punto_eq, pct_margen_neto
        FROM marts.v_punto_equilibrio_ancho
        WHERE periodo = ${periodo} AND moneda = 'TOTAL'
      )
      SELECT input.label AS nomb_correg,
             pe.pct_rendimiento, pe.pct_costo_fondeo, pe.pct_provisiones,
             pe.pct_gastos_op, pe.pct_gastos_personal, pe.pct_gastos_generales, pe.pct_deprec,
             pe.pct_otros, pe.pct_punto_eq, pe.pct_margen_neto
      FROM input
      LEFT JOIN pe ON pe.nomb_correg = input.canon
    `);
    return [...r];
  };

  const rows = await safeQuery<PuntoEqRow[]>(
    "getPuntoEquilibrioForPeriodo.select",
    runQuery,
    [],
  );

  // Si todas las filas vienen sin valores (pct_rendimiento NULL), intentar
  // disparar compute para ese periodo y reintentar la query.
  const haySinData = rows.length === 0 || rows.every((r) => r.pct_rendimiento == null);
  if (!haySinData) {
    for (const r of rows) map.set(String(r.nomb_correg), r);
    return map;
  }

  const recomputed = await safeQuery<PuntoEqRow[]>(
    "getPuntoEquilibrioForPeriodo.compute",
    async () => {
      await db.execute(sql`SELECT * FROM marts.compute_kpis_punto_equilibrio(${periodo})`);
      return runQuery();
    },
    [],
  );

  for (const r of recomputed) map.set(String(r.nomb_correg), r);
  return map;
}

function buildPuntoEquilibrioRows(map: Map<string, PuntoEqRow>, competidores: Competidor[]): PuntoEquilibrioRow[] {
  const get = (nomb: string, field: keyof PuntoEqRow): number | null => {
    const r = map.get(nomb);
    return r ? ((r[field] as number | null) ?? null) : null;
  };

  const row = (label: string, field: keyof PuntoEqRow, opts: Partial<PuntoEquilibrioRow> = {}): PuntoEquilibrioRow => {
    const valores: Record<string, number | null> = {};
    for (const c of competidores) {
      valores[c.labelCorto] = get(c.nombCorreg, field);
    }
    return { label, valores, ...opts };
  };

  return [
    row("%Rendimiento de Cartera", "pct_rendimiento"),
    row("%Costo Fondeo", "pct_costo_fondeo"),
    row("%Costo Provisiones Creditos", "pct_provisiones"),
    row("%Gastos Operacionales", "pct_gastos_op", { esSubtotal: true }),
    row("%Gastos de Personal", "pct_gastos_personal", { indentado: true }),
    row("%Gastos Generales", "pct_gastos_generales", { indentado: true }),
    row("%Deprec. y Amortiz.", "pct_deprec", { indentado: true }),
    row("%Otros Ingresos (Egresos)", "pct_otros"),
    row("%Punto de Equilibrio", "pct_punto_eq", { esTotal: true }),
    row("%Margen Neto", "pct_margen_neto", { esTotal: true }),
  ];
}

// ============================================================================
// Cuadro Resumen — KPIs computables hoy
// ============================================================================

type CuadroResumenRow = {
  nomb_correg: string;
  cartera_bruta: number | null;
  cartera_bruta_prev_anual: number | null;
  utilidad_anual: number | null;
  patrimonio_prom: number | null;
  activos_prom: number | null;
  gastos_op_anual: number | null;
  margen_bruto_anual: number | null;
  ingresos_fin_anual: number | null;
  inof_neto_anual: number | null;
  n_oficinas: number | null;
  n_clientes: number | null;
  n_personal: number | null;
  n_empleados: number | null;
  pct_part_smf_coloc: number | null;
  pct_part_smf_dep: number | null;
  pct_cartera_mype: number | null;
  pct_mora_global: number | null;
  pct_mora_global_vc: number | null;
  pct_cobertura_car: number | null;
  // Componentes TTM/promedios 12m para Eficiencia + Rentabilidad
  utilidad_ttm: number | null;
  patrimonio_prom_12m: number | null;
  activos_prom_12m: number | null;
  cta_1_ttm: number | null;
  cta_2_ttm: number | null;
  cta_6_ttm: number | null;
  cta_7_ttm: number | null;
  cta_10_1_ttm: number | null;
  cta_10_2_ttm: number | null;
  cta_10_3_ttm: number | null;
  cta_10_4_ttm: number | null;
  cta_12_7_ttm: number | null;
  cta_12_8_ttm: number | null;
};

async function getCuadroResumenRaw(periodo: number, entidades: string[], consolidar: boolean = true): Promise<Map<string, CuadroResumenRow>> {
  if (entidades.length === 0) return new Map();
  const prevAnual = periodoMismoMesAnioPrev(periodo);

  const rows = await safeQuery<CuadroResumenRow[]>(
    "getCuadroResumenRaw",
    async () => {
      const entidadesArr = sql`ARRAY[${sql.join(entidades.map((e) => sql`${e}`), sql`, `)}]::text[]`;
      // input: una fila por entidad del peer group, mapeando el LABEL original
      // a su canonico (resolver) si consolidar=true. Esto preserva el label
      // para que map.get() lo encuentre, sin importar si el peer group guardo
      // un nombre historico (ej "Financiera Compartamos") o canonico actual
      // (ej "Compartamos Banco").
      const r = await db.execute<CuadroResumenRow>(sql`
    WITH
    -- input: para cada label del peer group, calcula 'canon' = nombre con que
    -- se busca en las MVs.
    --  consolidar=true  -> agrupa todo bajo el canonico actual (resolver hacia
    --                       adelante por cadena de renombres).
    --  consolidar=false -> usa el nombre VIGENTE en el periodo. Si el label es
    --                       el canonico actual pero la entidad existia con otro
    --                       nombre en ese periodo (ej. Abr 2020 -> 'Financiera
    --                       Compartamos'), devuelve ese historico.
    input AS (
      SELECT label,
             ${consolidar
               ? sql.raw("dw.resolver_nomb_correg_canonico(label)")
               : sql.raw(`dw.nombre_vigente_en_periodo(label, ${periodo})`)} AS canon
      FROM unnest(${entidadesArr}) AS t(label)
    ),
    bg_actual AS (
      -- Cartera BRUTA = Vigentes (A4.1) + Refinanciados (A4.2) + Atrasados (A4.3).
      -- consolidar=true  -> agrupa al canonico actual.
      -- consolidar=false -> agrupa por nombre vigente en el periodo (raw_to_vigente).
      SELECT ${consolidar
        ? sql.raw("dw.resolver_nomb_correg_canonico(nomb_correg)")
        : sql.raw(`dw.raw_to_vigente(nomb_correg, ${periodo})`)} AS nomb_correg,
             SUM(COALESCE(cta_a4_1,0) + COALESCE(cta_a4_2,0) + COALESCE(cta_a4_3,0)) AS cartera,
             SUM(cta_c) AS patrimonio, SUM(cta_a) AS activos
      FROM marts.v_eeff_balance_ancho
      WHERE periodo = ${periodo} AND moneda = 'TOTAL'
      GROUP BY 1
    ),
    bg_prev AS (
      SELECT ${consolidar
        ? sql.raw("dw.resolver_nomb_correg_canonico(nomb_correg)")
        : sql.raw(`dw.raw_to_vigente(nomb_correg, ${periodo})`)} AS nomb_correg,
             SUM(COALESCE(cta_a4_1,0) + COALESCE(cta_a4_2,0) + COALESCE(cta_a4_3,0)) AS cartera,
             SUM(cta_c) AS patrimonio, SUM(cta_a) AS activos
      FROM marts.v_eeff_balance_ancho
      WHERE periodo = ${prevAnual} AND moneda = 'TOTAL'
      GROUP BY 1
    ),
    er_anual AS (
      SELECT ${consolidar
        ? sql.raw("dw.resolver_nomb_correg_canonico(nomb_correg)")
        : sql.raw(`dw.raw_to_vigente(nomb_correg, ${periodo})`)} AS nomb_correg,
             SUM(cta_17) AS utilidad_anual,
             SUM(cta_3)  AS margen_bruto_anual,
             SUM(cta_1)  AS ingresos_fin_anual,
             SUM(COALESCE(cta_10, 0) + COALESCE(cta_12_7, 0) + COALESCE(cta_12_8, 0)) AS gastos_op_anual,
             SUM(COALESCE(cta_6, 0) - COALESCE(cta_7, 0)) AS inof_neto_anual
      FROM marts.mv_eeff_resultados_ancho
      WHERE periodo = ${periodo} AND moneda = 'TOTAL'
      GROUP BY 1
    ),
    oficinas AS (
      SELECT nomb_correg, n_oficinas
      FROM ${consolidar
        ? sql.raw("marts.v_oficinas_por_entidad_canonico")
        : sql.raw("marts.v_oficinas_por_entidad_historica")}
      WHERE periodo = ${periodo}
    ),
    clientes AS (
      SELECT nomb_correg, n_clientes
      FROM ${consolidar
        ? sql.raw("marts.v_clientes_por_entidad_canonico")
        : sql.raw("marts.v_clientes_por_entidad_historica")}
      WHERE periodo = ${periodo}
    ),
    personal AS (
      SELECT nomb_correg, n_personal, n_empleados
      FROM ${consolidar
        ? sql.raw("marts.v_personal_por_entidad_canonico")
        : sql.raw("marts.v_personal_por_entidad_historica")}
      WHERE periodo = ${periodo}
    ),
    smf_coloc AS (
      SELECT nomb_correg, pct_participacion_smf
      FROM ${consolidar
        ? sql.raw("marts.v_participacion_smf_colocaciones")
        : sql.raw("marts.v_participacion_smf_coloc_historica")}
      WHERE periodo = ${periodo}
    ),
    smf_dep AS (
      SELECT nomb_correg, pct_participacion_smf
      FROM ${consolidar
        ? sql.raw("marts.v_participacion_smf_depositos")
        : sql.raw("marts.v_participacion_smf_dep_historica")}
      WHERE periodo = ${periodo}
    ),
    mype AS (
      SELECT nomb_correg, pct_cartera_mype
      FROM ${consolidar
        ? sql.raw("dw.entidad_microfinanciera_periodo")
        : sql.raw("marts.v_microfinancieras_historica")}
      WHERE periodo = ${periodo}
    ),
    mora AS (
      SELECT nomb_correg, pct_mora_global, pct_mora_global_vc
      FROM ${consolidar
        ? sql.raw("marts.v_mora_global_por_entidad")
        : sql.raw("marts.v_mora_global_historica")}
      WHERE periodo = ${periodo}
    ),
    cob AS (
      SELECT nomb_correg, pct_cobertura_car
      FROM ${consolidar
        ? sql.raw("marts.v_cobertura_car_por_entidad")
        : sql.raw("marts.v_cobertura_car_historica")}
      WHERE periodo = ${periodo}
    ),
    kpis AS (
      SELECT nomb_correg, utilidad_ttm, patrimonio_prom_12m, activos_prom_12m,
             cta_1_ttm, cta_2_ttm, cta_6_ttm, cta_7_ttm,
             cta_10_1_ttm, cta_10_2_ttm, cta_10_3_ttm, cta_10_4_ttm,
             cta_12_7_ttm, cta_12_8_ttm
      FROM ${consolidar
        ? sql.raw("marts.v_kpis_anuales_entidad")
        : sql.raw("marts.v_kpis_anuales_historica")}
      WHERE periodo = ${periodo}
    )
    SELECT
      input.label                                      AS nomb_correg,
      bg.cartera                                       AS cartera_bruta,
      bgp.cartera                                      AS cartera_bruta_prev_anual,
      er.utilidad_anual,
      (bg.patrimonio + COALESCE(bgp.patrimonio, bg.patrimonio)) / 2 AS patrimonio_prom,
      (bg.activos    + COALESCE(bgp.activos,    bg.activos))    / 2 AS activos_prom,
      er.gastos_op_anual,
      er.margen_bruto_anual,
      er.ingresos_fin_anual,
      er.inof_neto_anual,
      ofi.n_oficinas,
      cli.n_clientes,
      per.n_personal,
      per.n_empleados,
      smc.pct_participacion_smf                        AS pct_part_smf_coloc,
      smd.pct_participacion_smf                        AS pct_part_smf_dep,
      my.pct_cartera_mype                              AS pct_cartera_mype,
      mo.pct_mora_global                               AS pct_mora_global,
      mo.pct_mora_global_vc                            AS pct_mora_global_vc,
      cb.pct_cobertura_car                             AS pct_cobertura_car,
      k.utilidad_ttm                                    AS utilidad_ttm,
      k.patrimonio_prom_12m,
      k.activos_prom_12m,
      k.cta_1_ttm, k.cta_2_ttm, k.cta_6_ttm, k.cta_7_ttm,
      k.cta_10_1_ttm, k.cta_10_2_ttm, k.cta_10_3_ttm, k.cta_10_4_ttm,
      k.cta_12_7_ttm, k.cta_12_8_ttm
    FROM input
    LEFT JOIN bg_actual bg  ON bg.nomb_correg  = input.canon
    LEFT JOIN bg_prev   bgp ON bgp.nomb_correg = input.canon
    LEFT JOIN er_anual  er  ON er.nomb_correg  = input.canon
    LEFT JOIN oficinas  ofi ON ofi.nomb_correg = input.canon
    LEFT JOIN clientes  cli ON cli.nomb_correg = input.canon
    LEFT JOIN personal  per ON per.nomb_correg = input.canon
    LEFT JOIN smf_coloc smc ON smc.nomb_correg = input.canon
    LEFT JOIN smf_dep   smd ON smd.nomb_correg = input.canon
    LEFT JOIN mype      my  ON my.nomb_correg  = input.canon
    LEFT JOIN mora      mo  ON mo.nomb_correg  = input.canon
    LEFT JOIN cob       cb  ON cb.nomb_correg  = input.canon
    LEFT JOIN kpis      k   ON k.nomb_correg   = input.canon
      `);
      return [...r];
    },
    [],
  );

  const map = new Map<string, CuadroResumenRow>();
  for (const r of rows) map.set(String(r.nomb_correg), r);
  return map;
}

function buildCuadroResumen(map: Map<string, CuadroResumenRow>, competidores: Competidor[]): Kpi[] {
  // Helper: extrae un valor por competidor en formato KpiValor[]
  const mk = (compute: (r: CuadroResumenRow) => number | null): KpiValor[] => {
    return competidores.map((c) => {
      const r = map.get(c.nombCorreg);
      return { competidor: c.labelCorto, valor: r ? compute(r) : null };
    });
  };

  // Helper para los KPIs aun no computables (n_oficinas, etc.) — todos NULL
  const todosNull = (): KpiValor[] => competidores.map((c) => ({ competidor: c.labelCorto, valor: null }));

  // Valores raw del SBS estan en MILES de soles. Para mostrar como
  // "MM S/" (millones de soles) hay que dividir por 1,000.
  // Ej: cartera_bruta = 2,593,234 miles_S/ -> 2,593 MM_S/.
  const mm = (v: number | null): number | null => (v == null ? null : v / 1_000);

  return [
    // Datos generales
    {
      codigo: "cr_n_oficinas",
      nombre: "N de agencias",
      unidad: "numero",
      signo: 1,
      seccion: "datos_generales",
      valores: mk((r) => (r.n_oficinas == null ? null : Number(r.n_oficinas))),
    },
    {
      codigo: "cr_n_clientes",
      nombre: "N de Clientes de Credito (Miles)",
      unidad: "numero",
      signo: 1,
      seccion: "datos_generales",
      valores: mk((r) => (r.n_clientes == null ? null : Number(r.n_clientes) / 1000)),
    },
    {
      codigo: "cr_n_personal",
      nombre: "N de personal",
      unidad: "numero",
      signo: 1,
      seccion: "datos_generales",
      valores: mk((r) => (r.n_personal == null ? null : Number(r.n_personal))),
    },
    {
      codigo: "cr_part_colocaciones",
      nombre: "% Part. Colocaciones en SMF",
      unidad: "pct",
      signo: 1,
      seccion: "datos_generales",
      valores: mk((r) => (r.pct_part_smf_coloc == null ? null : Number(r.pct_part_smf_coloc))),
    },
    {
      codigo: "cr_part_depositos",
      nombre: "% Part. Depositos en SMF",
      unidad: "pct",
      signo: 1,
      seccion: "datos_generales",
      valores: mk((r) => (r.pct_part_smf_dep == null ? null : Number(r.pct_part_smf_dep))),
    },

    // Cartera
    {
      codigo: "cr_cartera_bruta",
      nombre: "Cartera Bruta (MM S/)",
      unidad: "moneda_mm",
      signo: 1,
      seccion: "cartera",
      valores: mk((r) => mm(r.cartera_bruta)),
    },
    {
      codigo: "cr_crec_cartera_bruta",
      nombre: "Crec. Cartera Bruta (%)",
      unidad: "pct",
      signo: 1,
      seccion: "cartera",
      tooltip:
        "Variación de la Cartera Bruta vs el mismo mes del año anterior (year-over-year).",
      valores: mk((r) => {
        if (r.cartera_bruta == null || r.cartera_bruta_prev_anual == null || r.cartera_bruta_prev_anual === 0) return null;
        return Number(r.cartera_bruta) / Number(r.cartera_bruta_prev_anual) - 1;
      }),
    },
    {
      codigo: "cr_cartera_mype",
      nombre: "Cartera MYPE (%)",
      unidad: "pct",
      signo: 1,
      seccion: "cartera",
      valores: mk((r) => (r.pct_cartera_mype == null ? null : Number(r.pct_cartera_mype))),
    },
    {
      codigo: "cr_credito_prom",
      nombre: "Credito Prom. por Cliente (Miles S/)",
      unidad: "moneda_miles",
      signo: 1,
      seccion: "cartera",
      // cartera_bruta esta en miles de S/. n_clientes en personas.
      // -> credito_prom = miles_S/ por cliente.
      valores: mk((r) => {
        if (r.cartera_bruta == null || r.n_clientes == null || r.n_clientes === 0) return null;
        return Number(r.cartera_bruta) / Number(r.n_clientes);
      }),
    },
    {
      codigo: "cr_mora_global",
      nombre: "% Mora Global (sin V/C)",
      unidad: "pct",
      signo: -1,
      seccion: "cartera",
      valores: mk((r) => (r.pct_mora_global == null ? null : Number(r.pct_mora_global))),
    },
    {
      codigo: "cr_mora_global_vc",
      nombre: "% Mora Global (con V/C)",
      unidad: "pct",
      signo: -1,
      seccion: "cartera",
      valores: mk((r) => (r.pct_mora_global_vc == null ? null : Number(r.pct_mora_global_vc))),
    },
    {
      codigo: "cr_cobertura_car",
      nombre: "Cobertura CAR (%)",
      unidad: "pct",
      signo: 1,
      seccion: "cartera",
      valores: mk((r) => (r.pct_cobertura_car == null ? null : Number(r.pct_cobertura_car))),
    },

    // Eficiencia (todos los componentes de gastos/ingresos son TTM)
    {
      codigo: "cr_gastos_op_mg",
      nombre: "Gastos Oper./ Margen Bruto",
      unidad: "pct",
      signo: -1,
      seccion: "eficiencia",
      tooltip:
        "Anualizado trailing 12 meses. Numerador: gastos operacionales TTM. Denominador: Margen Bruto + INOF neto TTM.",
      // Excel r115: (cta_10_1 + cta_10_2 + cta_10_3 + cta_10_4 + cta_12_7 + cta_12_8)_TTM
      //          / ((cta_1 - cta_2) + (cta_6 - cta_7))_TTM
      valores: mk((r) => {
        const num = (Number(r.cta_10_1_ttm) || 0) + (Number(r.cta_10_2_ttm) || 0)
                  + (Number(r.cta_10_3_ttm) || 0) + (Number(r.cta_10_4_ttm) || 0)
                  + (Number(r.cta_12_7_ttm) || 0) + (Number(r.cta_12_8_ttm) || 0);
        const den = ((Number(r.cta_1_ttm) || 0) - (Number(r.cta_2_ttm) || 0))
                  + ((Number(r.cta_6_ttm) || 0) - (Number(r.cta_7_ttm) || 0));
        if (!den || num == null) return null;
        return num / den;
      }),
    },
    {
      codigo: "cr_inof_neto",
      nombre: "% INOF Neto/ Ingresos Totales",
      unidad: "pct",
      signo: 1,
      seccion: "eficiencia",
      tooltip:
        "Anualizado trailing 12 meses. INOF neto (ingresos por servicios financieros netos) / (Ingresos Financieros + INOF) TTM.",
      // Excel r685: (cta_6 - cta_7)_TTM / Ingresos_Totales_TTM
      // Ingresos Totales ≈ cta_1_TTM + cta_6_TTM (simplificacion sin "dif positiva" otros)
      valores: mk((r) => {
        const inof = (Number(r.cta_6_ttm) || 0) - (Number(r.cta_7_ttm) || 0);
        const ing  = (Number(r.cta_1_ttm) || 0) + (Number(r.cta_6_ttm) || 0);
        if (!ing) return null;
        return inof / ing;
      }),
    },
    {
      codigo: "cr_cartera_x_agencia",
      nombre: "Cartera x Agencia (Miles S/)",
      unidad: "moneda_miles",
      signo: 1,
      seccion: "eficiencia",
      // cartera_bruta esta en miles_S/. n_oficinas en cantidad.
      valores: mk((r) => {
        if (r.cartera_bruta == null || r.n_oficinas == null || r.n_oficinas === 0) return null;
        return Number(r.cartera_bruta) / Number(r.n_oficinas);
      }),
    },
    {
      codigo: "cr_cartera_x_empleado",
      nombre: "Cartera x Empleado (Miles S/)",
      unidad: "moneda_miles",
      signo: 1,
      seccion: "eficiencia",
      // Excel R36: Cartera_Bruta / N° Empleados (solo categoria 'empleados',
      // NO incluye gerentes/funcionarios/otros).
      valores: mk((r) => {
        if (r.cartera_bruta == null || r.n_empleados == null || r.n_empleados === 0) return null;
        return Number(r.cartera_bruta) / Number(r.n_empleados);
      }),
    },
    {
      codigo: "cr_n_clientes_x_empleado",
      nombre: "N Clientes x Empleado",
      unidad: "numero",
      signo: 1,
      seccion: "eficiencia",
      // Excel R37: N_Clientes / N° Empleados (igual que R36, solo empleados).
      valores: mk((r) => {
        if (r.n_clientes == null || r.n_empleados == null || r.n_empleados === 0) return null;
        return Number(r.n_clientes) / Number(r.n_empleados);
      }),
    },

    // Rentabilidad — computables
    {
      codigo: "cr_utilidad",
      nombre: "Utilidad (MM S/)",
      unidad: "moneda_mm",
      signo: 1,
      seccion: "rentabilidad",
      tooltip:
        "Utilidad neta ANUALIZADA — suma de los últimos 12 meses (trailing twelve months, TTM) terminados en el periodo seleccionado. En millones de soles.",
      // utilidad_ttm en miles_S/, mm() divide por 1000 -> MM_S/
      valores: mk((r) => mm(r.utilidad_ttm)),
    },
    {
      codigo: "cr_roe",
      nombre: "ROE (%)",
      unidad: "pct",
      signo: 1,
      seccion: "rentabilidad",
      tooltip:
        "Return on Equity anualizado. Utilidad TTM / Patrimonio promedio 12 meses.",
      // Excel r552: Utilidad_TTM / Patrimonio_prom_12m
      valores: mk((r) => {
        if (r.utilidad_ttm == null || r.patrimonio_prom_12m == null || r.patrimonio_prom_12m === 0) return null;
        return Number(r.utilidad_ttm) / Number(r.patrimonio_prom_12m);
      }),
    },
    {
      codigo: "cr_roa",
      nombre: "ROA (%)",
      unidad: "pct",
      signo: 1,
      seccion: "rentabilidad",
      tooltip:
        "Return on Assets anualizado. Utilidad TTM / Activos promedio 12 meses.",
      // Excel r558: Utilidad_TTM / Activos_prom_12m
      valores: mk((r) => {
        if (r.utilidad_ttm == null || r.activos_prom_12m == null || r.activos_prom_12m === 0) return null;
        return Number(r.utilidad_ttm) / Number(r.activos_prom_12m);
      }),
    },
  ];
}

// ============================================================================
// Bubble + Waterfall (computan deltas vs mismo mes anio anterior)
// ============================================================================

function buildBubbleAndWaterfall(
  peActual: Map<string, PuntoEqRow>,
  pePrev: Map<string, PuntoEqRow>,
  competidores: Competidor[],
): { bubble: BubblePoint[]; waterfall: WaterfallData[] } {
  const bubble: BubblePoint[] = [];
  const waterfall: WaterfallData[] = [];

  for (const c of competidores) {
    const a = peActual.get(c.nombCorreg);
    const p = pePrev.get(c.nombCorreg);
    if (!a || !p) continue;

    const deltaRC = ((a.pct_rendimiento ?? 0) - (p.pct_rendimiento ?? 0)) * 100;
    const deltaCF = ((a.pct_costo_fondeo ?? 0) - (p.pct_costo_fondeo ?? 0)) * 100;
    const deltaCP = ((a.pct_provisiones ?? 0) - (p.pct_provisiones ?? 0)) * 100;
    const deltaGO = ((a.pct_gastos_op ?? 0) - (p.pct_gastos_op ?? 0)) * 100;
    const deltaOt = ((a.pct_otros ?? 0) - (p.pct_otros ?? 0)) * 100;
    const deltaPE = ((a.pct_punto_eq ?? 0) - (p.pct_punto_eq ?? 0)) * 100;
    const deltaMN = ((a.pct_margen_neto ?? 0) - (p.pct_margen_neto ?? 0)) * 100;

    bubble.push({
      competidor: c.labelCorto,
      rendimiento: deltaRC, // delta en pp
      puntoEq: deltaPE,
      margenNeto: a.pct_margen_neto ?? 0,
      deltaPp: deltaMN,
    });

    waterfall.push({
      competidor: c.labelCorto,
      base: (p.pct_margen_neto ?? 0) * 100,
      final: (a.pct_margen_neto ?? 0) * 100,
      totalBps: Math.round(deltaMN * 100),
      componentes: [
        { label: "RC", bps: Math.round(deltaRC * 100) },
        { label: "CF", bps: Math.round(deltaCF * 100) },
        { label: "CP", bps: Math.round(deltaCP * 100) },
        { label: "GO", bps: Math.round(deltaGO * 100) },
        { label: "Ot", bps: Math.round(deltaOt * 100) },
      ],
    });
  }

  return { bubble, waterfall };
}

// ============================================================================
// Endpoint principal del dominio
// ============================================================================

// Limpia anotaciones decorativas que la SBS pega a los nombres:
// asteriscos al final (** marca consolidacion con subsidiarias),
// superindices unicode (¹²³), notas al pie "N/", whitespace excesivo.
function limpiarNombreEntidad(raw: string): string {
  let s = raw.trim();
  // Asteriscos finales
  s = s.replace(/\*+\s*$/u, "");
  // Superindices unicode
  s = s.replace(/[²³¹⁰-₟]+\s*$/u, "");
  // Notas al pie tipo " 1/" al final
  s = s.replace(/\s+\d{1,3}\/\s*$/u, "");
  return s.trim();
}

// Resuelve el "nombre largo / legal" de una entidad para usar en el header
// del informe. Prioriza empresa_sbs (nombre legal completo) y cae a
// nomb_correg si no hay. Limpia anotaciones decorativas como asteriscos.
async function getNombreLargoEntidad(nombCorreg: string): Promise<string> {
  return safeQuery<string>(
    `getNombreLargoEntidad[${nombCorreg}]`,
    async () => {
      const rows = await db.execute<{ empresa_sbs: string | null; nomb_correg: string }>(sql`
        SELECT empresa_sbs, nomb_correg
        FROM dw.dim_entidad
        WHERE nomb_correg = ${nombCorreg}
        LIMIT 1
      `);
      if (rows.length === 0) return limpiarNombreEntidad(nombCorreg);
      const r = rows[0];
      const candidato = r.empresa_sbs?.trim() || r.nomb_correg;
      return limpiarNombreEntidad(candidato);
    },
    limpiarNombreEntidad(nombCorreg),
  );
}

// Para cada entidad solicitada que NO matchea, buscar candidatos similares
// usando ILIKE con tokens. Util para sugerir correcciones al usuario cuando
// el peer group tiene typos o nombres distintos a los de dim_entidad.
async function buildSugerenciasMatch(faltantes: string[]): Promise<Record<string, string[]>> {
  if (faltantes.length === 0) return {};
  const out: Record<string, string[]> = {};
  for (const nomb of faltantes) {
    const tokens = nomb
      .split(/\s+/)
      .filter((t) => t.length >= 3)
      .slice(0, 3);
    if (tokens.length === 0) continue;
    const pattern = `%${tokens.join("%")}%`;
    const rows = await safeQuery<{ nomb_correg: string }[]>(
      `buildSugerenciasMatch[${nomb}]`,
      async () => {
        const r = await db.execute<{ nomb_correg: string }>(sql`
          SELECT DISTINCT nomb_correg
          FROM dw.dim_entidad
          WHERE nomb_correg ILIKE ${pattern}
          ORDER BY nomb_correg
          LIMIT 5
        `);
        return [...r];
      },
      [],
    );
    if (rows.length > 0) out[nomb] = rows.map((r) => r.nomb_correg);
  }
  return out;
}

export async function getInformeData(opts: {
  clienteSlug: string;
  periodo: number;
  peerGroupOverride?: string[];
  entidadPropiaOverride?: string;
  temaOverride?: string;
  ordenOverride?: string[];
  consolidar?: boolean; // default true: aplica renombres (Financiera Compartamos -> Compartamos Banco)
}): Promise<InformeData> {
  let cliente = await getClienteBySlug(opts.clienteSlug);

  // Override de entidad propia + nombre largo del header.
  // Asi "Resaltar: Mibanco" hace que el titulo principal diga el nombre
  // legal de Mibanco en vez del cliente original.
  if (opts.entidadPropiaOverride && opts.entidadPropiaOverride !== cliente.entidadPropia) {
    const nombreLargo = await getNombreLargoEntidad(opts.entidadPropiaOverride);
    cliente = {
      ...cliente,
      entidadPropia: opts.entidadPropiaOverride,
      nombre: nombreLargo,
      nombreCorto: opts.entidadPropiaOverride,
    };
  }

  // Override de tema (URL ?tema=cusco | huancayo | piura | etc.)
  if (opts.temaOverride) {
    const tema = TEMAS_PRESET.find((t) => t.id === opts.temaOverride);
    if (tema) {
      cliente = {
        ...cliente,
        brand: { primary: tema.primary, secondary: tema.secondary, acento: tema.acento },
      };
    }
  }

  // Garantizar que la entidad propia esta siempre en el peer group.
  // Solo agregamos al final si NO esta ya en el array — si esta, respetamos
  // su posicion (el usuario puede ponerla primero, en medio o donde quiera).
  let peerList = opts.peerGroupOverride;
  if (peerList && !peerList.includes(cliente.entidadPropia)) {
    peerList = [...peerList, cliente.entidadPropia];
  }

  let competidores = await buildCompetidores(opts.clienteSlug, peerList ?? null, cliente.entidadPropia);

  // Override de orden (URL ?orden=A,B,C). Reordena los competidores segun la
  // secuencia. Entidades no listadas en `orden` van al final.
  if (opts.ordenOverride && opts.ordenOverride.length > 0) {
    const ordenMap = new Map(opts.ordenOverride.map((n, i) => [n, i]));
    competidores = [...competidores].sort((a, b) => {
      const oa = ordenMap.get(a.nombCorreg) ?? Number.MAX_SAFE_INTEGER;
      const ob = ordenMap.get(b.nombCorreg) ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }

  const entidadesNombs = competidores.map((c) => c.nombCorreg);
  const periodoPrev = periodoMismoMesAnioPrev(opts.periodo);
  const periodoDicPrev = periodoDicAnioPrev(opts.periodo);

  const consolidar = opts.consolidar !== false; // default true
  const [peActual, pePrev, peDicPrev, cuadroRaw] = await Promise.all([
    getPuntoEquilibrioForPeriodo(opts.periodo, entidadesNombs, consolidar),
    getPuntoEquilibrioForPeriodo(periodoPrev, entidadesNombs, consolidar),
    getPuntoEquilibrioForPeriodo(periodoDicPrev, entidadesNombs, consolidar),
    getCuadroResumenRaw(opts.periodo, entidadesNombs, consolidar),
  ]);

  // Detectar cobertura: que entidades del peer group tienen data en MVs
  const conData = new Set(cuadroRaw.keys());
  const entidadesConData = entidadesNombs.filter((n) => conData.has(n));
  const entidadesSinData = entidadesNombs.filter((n) => !conData.has(n));
  const sugerenciasMatch = await buildSugerenciasMatch(entidadesSinData);

  const cobertura: CoberturaDatos = {
    entidadesConData,
    entidadesSinData,
    sugerenciasMatch,
  };

  const cuadroResumen = buildCuadroResumen(cuadroRaw, competidores);
  const puntoEquilibrio = buildPuntoEquilibrioRows(peActual, competidores);
  const margenNetoHistorico = buildMargenNetoHistorico(
    [
      { periodo: opts.periodo, map: peActual },
      { periodo: periodoDicPrev, map: peDicPrev },
      { periodo: periodoPrev, map: pePrev },
    ],
    competidores,
  );
  const { bubble, waterfall } = buildBubbleAndWaterfall(peActual, pePrev, competidores);

  return {
    cliente,
    periodo: { codigo: opts.periodo, label: periodoLabel(opts.periodo) },
    periodoComparativo: { codigo: periodoPrev, label: periodoLabel(periodoPrev) },
    competidores,
    cuadroResumen,
    puntoEquilibrio,
    margenNetoHistorico,
    margenNetoBubble: bubble,
    margenNetoWaterfall: waterfall,
    comentarios: {
      margen_neto_bubble: "",
      margen_neto_waterfall: "",
    },
    cobertura,
  };
}

/** Construye 3 filas de %Margen Neto comparativo (actual + 2 historicos). */
function buildMargenNetoHistorico(
  cortes: { periodo: number; map: Map<string, PuntoEqRow> }[],
  competidores: Competidor[],
): MargenNetoHistoricoRow[] {
  return cortes.map(({ periodo, map }) => {
    const valores: Record<string, number | null> = {};
    for (const c of competidores) {
      const r = map.get(c.nombCorreg);
      valores[c.labelCorto] = r ? (r.pct_margen_neto ?? null) : null;
    }
    return { periodo, periodoLabel: periodoLabelCorto(periodo), valores };
  });
}

/** Label compacto tipo "Abr-20" para encabezados. */
function periodoLabelCorto(periodo: number): string {
  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${meses[mes - 1] ?? "?"}-${String(anio).slice(2)}`;
}

// ============================================================================
// Endpoints auxiliares
// ============================================================================

export async function listPeriodosDisponibles(opts: { ultimosN?: number } = {}): Promise<number[]> {
  const limit = opts.ultimosN ?? 240;
  return safeQuery(
    "listPeriodosDisponibles",
    async () => {
      const rows = await db.execute<{ periodo: number }>(sql`
        SELECT DISTINCT periodo
        FROM marts.mv_eeff_resultados_ancho
        ORDER BY periodo DESC
        LIMIT ${limit}
      `);
      return rows.map((r) => Number(r.periodo));
    },
    [],
  );
}

export async function listEntidadesDisponibles(opts: { periodo?: number } = {}): Promise<EntidadDisponible[]> {
  return safeQuery(
    "listEntidadesDisponibles",
    async () => {
      const filtroPeriodo = opts.periodo ? sql`AND r.periodo = ${opts.periodo}` : sql``;
      const rows = await db.execute<{
        nomb_correg: string;
        tipo_entidad: string;
        microfinanciera: boolean;
        ultimo_periodo: number;
      }>(sql`
        SELECT
          e.nomb_correg,
          e.tipo_entidad,
          e.microfinanciera,
          MAX(r.periodo) AS ultimo_periodo
        FROM dw.dim_entidad e
        JOIN raw.eeff_observacion r ON r.nomb_correg = e.nomb_correg
        WHERE NOT e.es_total AND NOT e.es_sucursal AND e.activa
          ${filtroPeriodo}
        GROUP BY e.nomb_correg, e.tipo_entidad, e.microfinanciera
        ORDER BY e.nomb_correg
      `);
      return rows.map((r) => ({
        nombCorreg: String(r.nomb_correg),
        tipoEntidad: String(r.tipo_entidad),
        microfinanciera: Boolean(r.microfinanciera),
        ultimoPeriodo: Number(r.ultimo_periodo),
      }));
    },
    [],
  );
}
