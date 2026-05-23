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

async function getPuntoEquilibrioForPeriodo(periodo: number, entidades: string[]): Promise<Map<string, PuntoEqRow>> {
  if (entidades.length === 0) return new Map();

  const map = new Map<string, PuntoEqRow>();

  const rows = await safeQuery<PuntoEqRow[]>(
    "getPuntoEquilibrioForPeriodo.select",
    async () => {
      const r = await db.execute<PuntoEqRow>(sql`
        SELECT nomb_correg, pct_rendimiento, pct_costo_fondeo, pct_provisiones,
               pct_gastos_op, pct_gastos_personal, pct_gastos_generales, pct_deprec,
               pct_otros, pct_punto_eq, pct_margen_neto
        FROM marts.v_punto_equilibrio_ancho
        WHERE periodo = ${periodo}
          AND moneda = 'TOTAL'
          AND nomb_correg = ANY(ARRAY[${sql.join(entidades.map((e) => sql`${e}`), sql`, `)}]::text[])
      `);
      return [...r];
    },
    [],
  );

  if (rows.length > 0) {
    for (const r of rows) map.set(String(r.nomb_correg), r);
    return map;
  }

  // Si esta vacia, intentar disparar el compute (idempotente UPSERT).
  // Si la function no existe o falla, devolvemos vacio sin romper la UI.
  const recomputed = await safeQuery<PuntoEqRow[]>(
    "getPuntoEquilibrioForPeriodo.compute",
    async () => {
      await db.execute(sql`SELECT * FROM marts.compute_kpis_punto_equilibrio(${periodo})`);
      const r = await db.execute<PuntoEqRow>(sql`
        SELECT nomb_correg, pct_rendimiento, pct_costo_fondeo, pct_provisiones,
               pct_gastos_op, pct_gastos_personal, pct_gastos_generales, pct_deprec,
               pct_otros, pct_punto_eq, pct_margen_neto
        FROM marts.v_punto_equilibrio_ancho
        WHERE periodo = ${periodo}
          AND moneda = 'TOTAL'
          AND nomb_correg = ANY(ARRAY[${sql.join(entidades.map((e) => sql`${e}`), sql`, `)}]::text[])
      `);
      return [...r];
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
};

async function getCuadroResumenRaw(periodo: number, entidades: string[]): Promise<Map<string, CuadroResumenRow>> {
  if (entidades.length === 0) return new Map();
  const prevAnual = periodoMismoMesAnioPrev(periodo);

  const rows = await safeQuery<CuadroResumenRow[]>(
    "getCuadroResumenRaw",
    async () => {
      const r = await db.execute<CuadroResumenRow>(sql`
    WITH
    bg_actual AS (
      SELECT nomb_correg, cta_a4 AS cartera, cta_c AS patrimonio, cta_a AS activos
      FROM marts.v_eeff_balance_ancho
      WHERE periodo = ${periodo} AND moneda = 'TOTAL'
    ),
    bg_prev AS (
      SELECT nomb_correg, cta_a4 AS cartera, cta_c AS patrimonio, cta_a AS activos
      FROM marts.v_eeff_balance_ancho
      WHERE periodo = ${prevAnual} AND moneda = 'TOTAL'
    ),
    er_anual AS (
      SELECT nomb_correg,
             cta_17 AS utilidad_anual,
             cta_3  AS margen_bruto_anual,
             cta_1  AS ingresos_fin_anual,
             (COALESCE(cta_10, 0) + COALESCE(cta_12_7, 0) + COALESCE(cta_12_8, 0)) AS gastos_op_anual,
             (COALESCE(cta_6, 0) - COALESCE(cta_7, 0)) AS inof_neto_anual
      FROM marts.mv_eeff_resultados_ancho
      WHERE periodo = ${periodo} AND moneda = 'TOTAL'
    )
    SELECT
      bg.nomb_correg,
      bg.cartera                                       AS cartera_bruta,
      bgp.cartera                                      AS cartera_bruta_prev_anual,
      er.utilidad_anual,
      (bg.patrimonio + COALESCE(bgp.patrimonio, bg.patrimonio)) / 2 AS patrimonio_prom,
      (bg.activos    + COALESCE(bgp.activos,    bg.activos))    / 2 AS activos_prom,
      er.gastos_op_anual,
      er.margen_bruto_anual,
      er.ingresos_fin_anual,
      er.inof_neto_anual
    FROM bg_actual bg
    LEFT JOIN bg_prev bgp ON bgp.nomb_correg = bg.nomb_correg
    LEFT JOIN er_anual er ON er.nomb_correg = bg.nomb_correg
    WHERE bg.nomb_correg = ANY(ARRAY[${sql.join(entidades.map((e) => sql`${e}`), sql`, `)}]::text[])
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

  // En millones (cartera viene en S/. raw; convertimos a MM dividiendo por 1e6 si > 1M)
  const mm = (v: number | null): number | null => (v == null ? null : v / 1_000_000);

  return [
    // Datos generales — los 6 KPIs estan en gap (ver PRODUCT_VISION.md)
    { codigo: "cr_n_oficinas", nombre: "N de agencias", unidad: "numero", signo: 1, seccion: "datos_generales", valores: todosNull() },
    { codigo: "cr_n_clientes", nombre: "N de Clientes (Miles)", unidad: "numero_miles", signo: 1, seccion: "datos_generales", valores: todosNull() },
    { codigo: "cr_clientes_exclusivos", nombre: "% Clientes Exclusivos", unidad: "pct", signo: 1, seccion: "datos_generales", valores: todosNull() },
    { codigo: "cr_n_personal", nombre: "N de personal", unidad: "numero", signo: 1, seccion: "datos_generales", valores: todosNull() },
    { codigo: "cr_part_colocaciones", nombre: "% Part. Colocaciones en SMF", unidad: "pct", signo: 1, seccion: "datos_generales", valores: todosNull() },
    { codigo: "cr_part_depositos", nombre: "% Part. Depositos en SMF", unidad: "pct", signo: 1, seccion: "datos_generales", valores: todosNull() },

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
      valores: mk((r) => {
        if (r.cartera_bruta == null || r.cartera_bruta_prev_anual == null || r.cartera_bruta_prev_anual === 0) return null;
        return Number(r.cartera_bruta) / Number(r.cartera_bruta_prev_anual) - 1;
      }),
    },
    { codigo: "cr_cartera_mype", nombre: "Cartera MYPE (%)", unidad: "pct", signo: 1, seccion: "cartera", valores: todosNull() },
    { codigo: "cr_credito_prom", nombre: "Credito Prom. por Cliente (Miles S/)", unidad: "moneda_miles", signo: 1, seccion: "cartera", valores: todosNull() },
    { codigo: "cr_mora_global", nombre: "% Mora Global", unidad: "pct", signo: -1, seccion: "cartera", valores: todosNull() },
    { codigo: "cr_cobertura_car", nombre: "Cobertura CAR (%)", unidad: "pct", signo: 1, seccion: "cartera", valores: todosNull() },

    // Eficiencia
    {
      codigo: "cr_gastos_op_mg",
      nombre: "Gastos Oper./ Margen Bruto",
      unidad: "pct",
      signo: -1,
      seccion: "eficiencia",
      valores: mk((r) => {
        if (r.gastos_op_anual == null || r.margen_bruto_anual == null || r.margen_bruto_anual === 0) return null;
        return Number(r.gastos_op_anual) / Number(r.margen_bruto_anual);
      }),
    },
    {
      codigo: "cr_inof_neto",
      nombre: "% INOF Neto/ Ingreso Financiero",
      unidad: "pct",
      signo: 1,
      seccion: "eficiencia",
      valores: mk((r) => {
        if (r.inof_neto_anual == null || r.ingresos_fin_anual == null || r.ingresos_fin_anual === 0) return null;
        return Number(r.inof_neto_anual) / Number(r.ingresos_fin_anual);
      }),
    },
    { codigo: "cr_cartera_x_agencia", nombre: "Cartera x Agencia (Miles S/)", unidad: "moneda_miles", signo: 1, seccion: "eficiencia", valores: todosNull() },
    { codigo: "cr_cartera_x_empleado", nombre: "Cartera x Empleado (Miles S/)", unidad: "moneda_miles", signo: 1, seccion: "eficiencia", valores: todosNull() },
    { codigo: "cr_n_clientes_x_empleado", nombre: "N Clientes x Empleado", unidad: "numero", signo: 1, seccion: "eficiencia", valores: todosNull() },

    // Rentabilidad — computables
    {
      codigo: "cr_utilidad",
      nombre: "Utilidad (MM S/)",
      unidad: "moneda_mm",
      signo: 1,
      seccion: "rentabilidad",
      valores: mk((r) => mm(r.utilidad_anual)),
    },
    {
      codigo: "cr_roe",
      nombre: "ROE (%)",
      unidad: "pct",
      signo: 1,
      seccion: "rentabilidad",
      valores: mk((r) => {
        if (r.utilidad_anual == null || r.patrimonio_prom == null || r.patrimonio_prom === 0) return null;
        return Number(r.utilidad_anual) / Number(r.patrimonio_prom);
      }),
    },
    {
      codigo: "cr_roa",
      nombre: "ROA (%)",
      unidad: "pct",
      signo: 1,
      seccion: "rentabilidad",
      valores: mk((r) => {
        if (r.utilidad_anual == null || r.activos_prom == null || r.activos_prom === 0) return null;
        return Number(r.utilidad_anual) / Number(r.activos_prom);
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
}): Promise<InformeData> {
  let cliente = await getClienteBySlug(opts.clienteSlug);

  // Override de entidad propia (URL ?entidadPropia=XXX)
  if (opts.entidadPropiaOverride && opts.entidadPropiaOverride !== cliente.entidadPropia) {
    cliente = { ...cliente, entidadPropia: opts.entidadPropiaOverride };
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

  // Garantizar que la entidad propia esta siempre en el peer group
  let peerList = opts.peerGroupOverride;
  if (peerList && !peerList.includes(cliente.entidadPropia)) {
    peerList = [...peerList, cliente.entidadPropia];
  }

  const competidores = await buildCompetidores(opts.clienteSlug, peerList ?? null, cliente.entidadPropia);
  const entidadesNombs = competidores.map((c) => c.nombCorreg);
  const periodoPrev = periodoMismoMesAnioPrev(opts.periodo);

  const [peActual, pePrev, cuadroRaw] = await Promise.all([
    getPuntoEquilibrioForPeriodo(opts.periodo, entidadesNombs),
    getPuntoEquilibrioForPeriodo(periodoPrev, entidadesNombs),
    getCuadroResumenRaw(opts.periodo, entidadesNombs),
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
  const { bubble, waterfall } = buildBubbleAndWaterfall(peActual, pePrev, competidores);

  return {
    cliente,
    periodo: { codigo: opts.periodo, label: periodoLabel(opts.periodo) },
    periodoComparativo: { codigo: periodoPrev, label: periodoLabel(periodoPrev) },
    competidores,
    cuadroResumen,
    puntoEquilibrio,
    margenNetoBubble: bubble,
    margenNetoWaterfall: waterfall,
    comentarios: {
      margen_neto_bubble: "",
      margen_neto_waterfall: "",
    },
    cobertura,
  };
}

// ============================================================================
// Endpoints auxiliares
// ============================================================================

export async function listPeriodosDisponibles(opts: { ultimosN?: number } = {}): Promise<number[]> {
  const limit = opts.ultimosN ?? 36;
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
