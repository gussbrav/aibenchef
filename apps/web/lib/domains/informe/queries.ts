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

export function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"} ${anio}`;
}

export function periodoMismoMesAnioPrev(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return (anio - 1) * 100 + mes;
}

/** Diciembre del año anterior al periodo. Para Abr 2020 → Dic 2019. */
export function periodoDicAnioPrev(periodo: number): number {
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
  slug: "bcp",
  nombre: "Banco de Crédito del Perú",
  nombreCorto: "BCP",
  entidadPropia: "Banco de Crédito del Perú",
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

/**
 * Lista los clientes activos (tenants comerciales que contratan Aibenchef,
 * NO las entidades SBS). Ordenados alfabeticamente por nombre_corto.
 *
 * Usado en el wizard de /publicaciones para poblar el selector "Cliente"
 * (antes era un input libre que fallaba con FK si el usuario tipeaba un
 * slug inexistente — bug reportado 2026-08-10).
 */
export async function listClientesActivos(): Promise<
  Array<{ slug: string; nombreCorto: string; nombre: string }>
> {
  return safeQuery(
    "listClientesActivos",
    async () => {
      const rows = await db.execute<{
        slug: string;
        nombre: string;
        nombre_corto: string;
      }>(sql`
        SELECT slug, nombre, nombre_corto
        FROM config.cliente
        WHERE activo
        ORDER BY nombre_corto
      `);
      return rows.map((r) => ({
        slug: String(r.slug),
        nombre: String(r.nombre),
        nombreCorto: String(r.nombre_corto),
      }));
    },
    [],
  );
}

export async function getDefaultPeerGroup(clienteSlug: string): Promise<string[]> {
  const configured = await safeQuery(
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
    [] as string[],
  );
  // Si el cliente no tiene peer group configurado en config.peer_group,
  // cae al fallback compartido (mismo que buildCompetidores usa). Asi los
  // consumers de esta funcion — como /dashboard/publicaciones wizard —
  // siempre tienen un peer group sensato precargado, no un array vacio.
  if (configured.length > 0) return configured;
  return PEER_GROUP_FALLBACK.map((p) => p.competidor_nomb_correg);
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
  colorsOverride: Map<string, string> | null = null,
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

  const peerList = peerGroupOverride ?? rowsToUse.map((r) => r.competidor_nomb_correg);

  // Asignacion de colores robusta — orden de prioridad:
  //  1. Override URL (?colors=A:HEX,B:HEX) → ad-hoc del usuario, transitorio.
  //     Validado upstream por parseColorsOverride (formato #rrggbb).
  //  2. config.peer_group.color_hex → persistido por cliente.
  //  3. pickColorEstable(nombCorreg, ya_usados) → paleta de 20 colores
  //     contrastantes, mismo nombre siempre mismo color, sin duplicados dentro
  //     del peer group actual.
  const usados = new Set<string>();
  return peerList.map((nombCorreg) => {
    const cfg = configByNomb.get(nombCorreg);
    const overrideColor = colorsOverride?.get(nombCorreg);
    let color: string;
    if (overrideColor) {
      color = overrideColor;
    } else if (cfg?.color) {
      color = cfg.color;
    } else {
      color = pickColorEstable(nombCorreg, usados);
    }
    usados.add(color);
    return {
      nombCorreg,
      labelCorto: cfg?.label ?? nombCorreg,
      color,
      esPropio: nombCorreg === entidadPropia,
    };
  });
}

// Parsea el query param ?colors=NOMB1:HEX1,NOMB2:HEX2 a un Map.
// Valida que HEX sea formato #rrggbb (6 hex). Ignora entradas invalidas.
export function parseColorsOverride(raw: string | null | undefined): Map<string, string> | null {
  if (!raw) return null;
  const map = new Map<string, string>();
  const pattern = /^#[0-9a-fA-F]{6}$/;
  for (const pair of raw.split(",")) {
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) continue;
    const nomb = pair.slice(0, idx).trim();
    const hexRaw = pair.slice(idx + 1).trim();
    const hex = hexRaw.startsWith("#") ? hexRaw : `#${hexRaw}`;
    if (!nomb || !pattern.test(hex)) continue;
    map.set(nomb, hex.toUpperCase());
  }
  return map.size > 0 ? map : null;
}

// Paleta amplia (20 colores) elegida para contraste alto y diferenciacion
// visual. Asignacion estable: el hash de `nomb_correg` siempre cae en el
// mismo slot, salvo colision con otra entidad ya pickeada en el peer group
// (en cuyo caso busca el siguiente slot libre).
const PALETTE_ENTIDADES = [
  "#0F2A5E", // azul Caja Arequipa
  "#E91E63", // fucsia Compartamos
  "#4CAF50", // verde Mibanco
  "#C8102E", // rojo Caja Huancayo
  "#722F37", // vino Caja Cusco
  "#1E90FF", // celeste Caja Piura
  "#FF9800", // naranja
  "#9C27B0", // violeta
  "#8D6E63", // marron
  "#00BCD4", // cyan
  "#FFEB3B", // amarillo (acentuar texto oscuro)
  "#3F51B5", // indigo
  "#795548", // marron oscuro
  "#009688", // teal
  "#FFC107", // ambar
  "#673AB7", // violeta oscuro
  "#F44336", // rojo
  "#607D8B", // gris azul
  "#7CB342", // verde claro
  "#5D4037", // marron tierra
];

export function pickColorEstable(nombCorreg: string, usados: Set<string>): string {
  // Hash simple (sdbm) sobre el nomb_correg — estable y rapido.
  let h = 0;
  for (let i = 0; i < nombCorreg.length; i++) {
    h = (nombCorreg.charCodeAt(i) + (h << 6) + (h << 16) - h) >>> 0;
  }
  const startIdx = h % PALETTE_ENTIDADES.length;
  // Buscar primer slot libre desde startIdx (evita colision con peer group)
  for (let i = 0; i < PALETTE_ENTIDADES.length; i++) {
    const candidate = PALETTE_ENTIDADES[(startIdx + i) % PALETTE_ENTIDADES.length];
    if (candidate !== undefined && !usados.has(candidate)) return candidate;
  }
  // Fallback (peer group > 20 entidades): wrap del hash original
  return PALETTE_ENTIDADES[startIdx] ?? "#0F2A5E";
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
  pct_part_sf_coloc: number | null;
  pct_part_sf_dep: number | null;
  pct_cartera_mype: number | null;
  pct_mora_basica: number | null;
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
    -- PERF: expandir los canonicos del peer group a la lista completa de
    -- aliases raw (nombres con los que aparecen en las MVs). Filtrar cada
    -- CTE por esta lista corta reduce el scan de ~120 entidades a ~10-50
    -- pre-agregacion. Solo aplica cuando consolidar=true (99% de casos);
    -- consolidar=false pasa lista canon directa (raw_to_vigente reverso
    -- ya se filtra en el post-JOIN).
    raw_names AS (
      ${consolidar
        ? sql.raw(`
          SELECT DISTINCT en.nombre AS name
          FROM input i
          JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = i.canon
          JOIN dw.entidad_nombre en  ON en.entidad_id = em.id
          WHERE en.consolidar = TRUE
        `)
        : sql.raw(`SELECT canon AS name FROM input WHERE canon IS NOT NULL`)}
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
        AND nomb_correg IN (SELECT name FROM raw_names)
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
        AND nomb_correg IN (SELECT name FROM raw_names)
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
        AND nomb_correg IN (SELECT name FROM raw_names)
      GROUP BY 1
    ),
    -- PERF: las 11 vistas de abajo tienen nomb_correg YA canonizado (para
    -- consolidar=true) o vigente en periodo (para consolidar=false). En
    -- ambos casos, filtrar por 'canon' de input reduce el scan de N vistas
    -- × ~120 entidades → N vistas × ~10 entidades. Ganancia esperada
    -- proporcional al numero de peers pero >0 siempre.
    oficinas AS (
      SELECT nomb_correg, n_oficinas
      FROM ${consolidar
        ? sql.raw("marts.v_oficinas_por_entidad_canonico")
        : sql.raw("marts.v_oficinas_por_entidad_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    clientes AS (
      SELECT nomb_correg, n_clientes
      FROM ${consolidar
        ? sql.raw("marts.v_clientes_por_entidad_canonico")
        : sql.raw("marts.v_clientes_por_entidad_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    personal AS (
      SELECT nomb_correg, n_personal, n_empleados
      FROM ${consolidar
        ? sql.raw("marts.v_personal_por_entidad_canonico")
        : sql.raw("marts.v_personal_por_entidad_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    smf_coloc AS (
      SELECT nomb_correg, pct_participacion_smf
      FROM ${consolidar
        ? sql.raw("marts.v_participacion_smf_colocaciones")
        : sql.raw("marts.v_participacion_smf_coloc_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    smf_dep AS (
      SELECT nomb_correg, pct_participacion_smf
      FROM ${consolidar
        ? sql.raw("marts.v_participacion_smf_depositos")
        : sql.raw("marts.v_participacion_smf_dep_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    sf_coloc AS (
      SELECT nomb_correg, pct_participacion_sf
      FROM ${consolidar
        ? sql.raw("marts.v_participacion_sf_colocaciones")
        : sql.raw("marts.v_participacion_sf_coloc_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    sf_dep AS (
      SELECT nomb_correg, pct_participacion_sf
      FROM ${consolidar
        ? sql.raw("marts.v_participacion_sf_depositos")
        : sql.raw("marts.v_participacion_sf_dep_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    mype AS (
      SELECT nomb_correg, pct_cartera_mype
      FROM ${consolidar
        ? sql.raw("dw.entidad_microfinanciera_periodo")
        : sql.raw("marts.v_microfinancieras_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    mora AS (
      SELECT nomb_correg, pct_mora_global, pct_mora_global_vc,
             cartera_bruta, cartera_atrasada,
             CASE WHEN cartera_bruta > 0
                  THEN cartera_atrasada / cartera_bruta
                  ELSE NULL
             END AS pct_mora_basica
      FROM ${consolidar
        ? sql.raw("marts.v_mora_global_por_entidad")
        : sql.raw("marts.v_mora_global_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
    ),
    cob AS (
      SELECT nomb_correg, pct_cobertura_car
      FROM ${consolidar
        ? sql.raw("marts.v_cobertura_car_por_entidad")
        : sql.raw("marts.v_cobertura_car_historica")}
      WHERE periodo = ${periodo}
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
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
        AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
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
      sfc.pct_participacion_sf                         AS pct_part_sf_coloc,
      sfd.pct_participacion_sf                         AS pct_part_sf_dep,
      my.pct_cartera_mype                              AS pct_cartera_mype,
      mo.pct_mora_basica                               AS pct_mora_basica,
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
    LEFT JOIN sf_coloc  sfc ON sfc.nomb_correg = input.canon
    LEFT JOIN sf_dep    sfd ON sfd.nomb_correg = input.canon
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
    // Datos generales — TODOS estos son metricas de tamaño/contexto (mas
    // agencias no es "mejor", solo mas grande). rankeable:false para que
    // no se aplique heatmap visual.
    {
      codigo: "cr_n_oficinas",
      nombre: "N de agencias",
      unidad: "numero",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      valores: mk((r) => (r.n_oficinas == null ? null : Number(r.n_oficinas))),
    },
    {
      codigo: "cr_n_clientes",
      nombre: "N de Clientes de Credito (Miles)",
      unidad: "numero",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      valores: mk((r) => (r.n_clientes == null ? null : Number(r.n_clientes) / 1000)),
    },
    {
      codigo: "cr_n_personal",
      nombre: "N de personal",
      unidad: "numero",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      valores: mk((r) => (r.n_personal == null ? null : Number(r.n_personal))),
    },
    {
      codigo: "cr_part_sf_coloc",
      nombre: "% Part. Colocaciones en SF",
      unidad: "pct",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      tooltip:
        "Sistema Financiero (SF) = TODAS las entidades reguladas (Bancos + Financieras + CMAC + " +
        "CRAC + Empresas de Créditos), incluyendo SMF. Para bancos con filiales en el exterior, " +
        "usamos la cifra CONSOLIDADA (no la doméstica) — sin dedupe estaríamos contando ambas y " +
        "el denominador inflaría 2x. Mide tamaño relativo, no calidad.",
      valores: mk((r) => (r.pct_part_sf_coloc == null ? null : Number(r.pct_part_sf_coloc))),
    },
    {
      codigo: "cr_part_smf_coloc",
      nombre: "% Part. Colocaciones en SMF",
      unidad: "pct",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      tooltip:
        "Sistema Microfinanciero (SMF): denominador = total de cartera SOLO de entidades " +
        "microfinancieras (>50% de su cartera en MES + PEQ). Bancos universales aparecen 0%.",
      valores: mk((r) => (r.pct_part_smf_coloc == null ? null : Number(r.pct_part_smf_coloc))),
    },
    {
      codigo: "cr_part_sf_dep",
      nombre: "% Part. Depositos en SF",
      unidad: "pct",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      tooltip:
        "Sistema Financiero (SF) = TODAS las entidades reguladas (incluye SMF). Para bancos con " +
        "filiales en el exterior, usamos la cifra consolidada — sin dedupe el denominador estaría " +
        "inflado por doble conteo.",
      valores: mk((r) => (r.pct_part_sf_dep == null ? null : Number(r.pct_part_sf_dep))),
    },
    {
      codigo: "cr_part_smf_dep",
      nombre: "% Part. Depositos en SMF",
      unidad: "pct",
      signo: 1,
      seccion: "datos_generales",
      rankeable: false,
      tooltip:
        "Sistema Microfinanciero (SMF): denominador = total de depósitos SOLO de entidades microfinancieras.",
      valores: mk((r) => (r.pct_part_smf_dep == null ? null : Number(r.pct_part_smf_dep))),
    },

    // Cartera
    {
      codigo: "cr_cartera_bruta",
      nombre: "Cartera Bruta (MM S/)",
      unidad: "moneda_mm",
      signo: 1,
      seccion: "cartera",
      // Tamaño absoluto, no calidad — un Banco siempre va a tener mas que una
      // Caja. Sin heatmap; el crecimiento abajo si se ranking-ea.
      rankeable: false,
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
      nombre: "Cartera MYPE / Total (%)",
      unidad: "pct",
      signo: 1,
      seccion: "cartera",
      // Especializacion, no calidad — un Banco multipropósito tendra bajo
      // % MYPE pero eso no lo hace "peor". Solo es indicativo de modelo.
      rankeable: false,
      tooltip:
        "Porcentaje de la cartera total dedicada a MYPE (Microempresa + Pequeña Empresa). " +
        "Aplica a TODAS las entidades del sistema: Bancos universales típicamente <20%, " +
        "Cajas y Financieras especializadas en MYPE 70-95%. Una entidad se clasifica " +
        "como SMF cuando este ratio supera el 50%. '—' significa que la entidad no reportó " +
        "colocaciones MYPE en ese período.",
      valores: mk((r) => (r.pct_cartera_mype == null ? null : Number(r.pct_cartera_mype))),
    },
    {
      codigo: "cr_credito_prom",
      nombre: "Credito Prom. por Cliente (Miles S/)",
      unidad: "moneda_miles",
      signo: 1,
      seccion: "cartera",
      // Tamaño promedio del prestamo — Bancos prestan mas grande, Cajas mas
      // chico. Contexto, no calidad.
      rankeable: false,
      // cartera_bruta esta en miles de S/. n_clientes en personas.
      // -> credito_prom = miles_S/ por cliente.
      valores: mk((r) => {
        if (r.cartera_bruta == null || r.n_clientes == null || r.n_clientes === 0) return null;
        return Number(r.cartera_bruta) / Number(r.n_clientes);
      }),
    },
    {
      codigo: "cr_mora_basica",
      nombre: "% Créditos Atrasados (criterio SBS) / Créditos Directos",
      unidad: "pct",
      signo: -1,
      seccion: "cartera",
      tooltip:
        "Fórmula OFICIAL SBS: Cartera Atrasada / Cartera Bruta (Créditos Directos). Es la métrica que " +
        "SBS publica en el Reporte de Indicadores mensual (formato C-1301) bajo 'CALIDAD DE ACTIVOS'. " +
        "Sirve como campo de validación: el valor aquí debe coincidir EXACTO con lo que publica SBS " +
        "para esa entidad y ese mes (ej. CMAC Piura Abr-20 = 8.44%). NO incluye refinanciados, NO " +
        "castigos, NO venta de cartera — es la mora 'visible hoy' en el balance. Rango sano del " +
        "sector microfinanciero: 3-9%.",
      valores: mk((r) => (r.pct_mora_basica == null ? null : Number(r.pct_mora_basica))),
    },
    {
      codigo: "cr_mora_global",
      nombre: "% Mora Global (sin V/C)",
      unidad: "pct",
      signo: -1,
      seccion: "cartera",
      tooltip:
        "Fórmula: (Cartera Atrasada + Cartera Refinanciada + Castigos últimos 12 meses) / Cartera Bruta actual. " +
        "Mide la mora AMPLIADA sin incluir venta de cartera — refleja el deterioro que la entidad ya reconoció " +
        "vía castigos internos, pero antes de vender cartera a terceros. Rango típico del sistema microfinanciero: " +
        "5-20%. Valores altos con castigos elevados indican política agresiva de limpieza de portfolio.",
      valores: mk((r) => (r.pct_mora_global == null ? null : Number(r.pct_mora_global))),
    },
    {
      codigo: "cr_mora_global_vc",
      nombre: "% Mora Global (con V/C)",
      unidad: "pct",
      signo: -1,
      seccion: "cartera",
      tooltip:
        "Fórmula: (Cartera Atrasada + Cartera Refinanciada + Castigos 12m + Venta de Cartera 12m) / Cartera Bruta actual. " +
        "Añade al numerador la cartera vendida a terceros en los últimos 12 meses. Refleja la mora TOTAL que la " +
        "entidad tuvo que reconocer (visible en balance + limpiada vía castigos + transferida vía venta). Es la " +
        "métrica más honesta de la calidad histórica del portfolio — dos entidades con misma mora básica pueden " +
        "tener mora con V/C muy distinta si una limpia agresivamente. " +
        "\n\n" +
        "CÓMO SE CALCULA LA 'VENTA DE CARTERA 12M': valores mensuales reportados por la entidad a SBS en el " +
        "archivo 'Venta de Cartera' (dato oficial, no estimado), acumulados los últimos 12 meses. " +
        "Alternativamente, cuando el dato oficial no está disponible, la plantilla Excel de referencia lo " +
        "estima con la ecuación contable inversa: " +
        "Venta ≈ Gasto Provisiones del mes − Δ Provisiones del balance − Castigos del mes (tomando solo el " +
        "valor absoluto si el resultado es negativo). Aibenchef usa SIEMPRE el dato oficial SBS.",
      valores: mk((r) => (r.pct_mora_global_vc == null ? null : Number(r.pct_mora_global_vc))),
    },
    {
      codigo: "cr_cobertura_car",
      nombre: "Cobertura CAR (%)",
      unidad: "pct",
      signo: 1,
      seccion: "cartera",
      tooltip:
        "Fórmula: Provisiones / CAR (Cartera Atrasada + Refinanciada + Reestructurada). " +
        "Mide el colchón de solvencia contra créditos deteriorados. Cobertura >100% significa que las " +
        "provisiones exceden el CAR (posición conservadora). SBS exige mínimo 100% para operaciones " +
        "MES/PEQ tipo NORMAL, más para categorías CPP/DEF/DUD/PER.",
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
// superindices unicode (¹²³), notas al pie "N/" (con o sin espacio antes),
// notas al pie tipo "a/" "b/", whitespace excesivo.
//
// IMPORTANTE: las notas al pie aparecen pegadas sin espacio (ej.
// "Financiera Confianza2/") porque el OCR del PDF de SBS las junta.
// El regex debe tolerar ausencia de espacio antes del digito/letra.
function limpiarNombreEntidad(raw: string): string {
  let s = raw.trim();
  // Aplicar hasta 3 pasadas porque puede haber multiples sufijos
  // (ej. "Banco X **2/" tiene asterisco + footnote)
  for (let i = 0; i < 3; i++) {
    const antes = s;
    // Asteriscos finales (1+)
    s = s.replace(/\*+\s*$/u, "");
    // Superindices unicode (¹²³ etc.)
    s = s.replace(/[²³¹⁰-₟]+\s*$/u, "");
    // Notas al pie tipo "1/" o "2/" (con o sin espacio antes)
    s = s.replace(/\s*\d{1,3}\/\s*$/u, "");
    // Notas al pie tipo "a/" "b/" (con o sin espacio antes)
    s = s.replace(/\s*[a-z]\/\s*$/u, "");
    // Pegada o sola: una barra final aislada
    s = s.replace(/\s*\/\s*$/u, "");
    s = s.trim();
    if (s === antes) break;
  }
  return s;
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
  /**
   * Override ad-hoc de colores por entidad — Map<nomb_correg, "#RRGGBB">.
   * Se construye en la page desde ?colors=A:HEX,B:HEX (parseColorsOverride).
   * Si una entidad esta en el map y el hex es valido, se usa ese color en
   * lugar del de config.peer_group o del hash determinista.
   */
  colorsOverride?: Map<string, string> | null;
  consolidar?: boolean; // default true: aplica renombres (Financiera Compartamos -> Compartamos Banco)
}): Promise<InformeData> {
  // PERF: Fase 1 — 3 queries INDEPENDIENTES en paralelo (antes eran seriales).
  //   getClienteBySlug: siempre.
  //   getNombreLargoEntidad: solo si viene override de entidad propia.
  //   getTop2PorGrupoByCartera: solo si NO viene peerGroupOverride.
  // Ganancia esperada: ~500-800ms (antes cada await era ~200-300ms secuencial).
  const needsNombreLargo =
    !!opts.entidadPropiaOverride && opts.entidadPropiaOverride !== undefined;
  const needsTopPorGrupo =
    !opts.peerGroupOverride || opts.peerGroupOverride.length === 0;
  const [clienteBase, nombreLargoOverride, peerListDefault] = await Promise.all([
    getClienteBySlug(opts.clienteSlug),
    needsNombreLargo
      ? getNombreLargoEntidad(opts.entidadPropiaOverride!)
      : Promise.resolve(null as string | null),
    needsTopPorGrupo
      ? getTop2PorGrupoByCartera(opts.periodo)
      : Promise.resolve(null as string[] | null),
  ]);

  let cliente = clienteBase;

  // Override de entidad propia + nombre largo del header.
  // Asi "Resaltar: Mibanco" hace que el titulo principal diga el nombre
  // legal de Mibanco en vez del cliente original. Solo aplica el override
  // si la entidad propia realmente cambio (evita reescribir cliente cuando
  // el override es el mismo que el default del cliente).
  if (
    opts.entidadPropiaOverride &&
    opts.entidadPropiaOverride !== cliente.entidadPropia &&
    nombreLargoOverride
  ) {
    cliente = {
      ...cliente,
      entidadPropia: opts.entidadPropiaOverride,
      nombre: nombreLargoOverride,
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

  // Resolver peer group default:
  //   1. Si el usuario paso ?peerGroup=... en la URL, respetamos esa lista.
  //   2. Si no, usamos el resultado de getTop2PorGrupoByCartera prefetched
  //      arriba en paralelo (top 2 con mayor cartera por grupo SBS).
  //      Esto da 10 competidores representativos del sistema completo y
  //      garantiza que el benchmark "out-of-the-box" sea comparable contra
  //      el lider de cada grupo, no contra una lista estatica desactualizada.
  let peerList = opts.peerGroupOverride ?? peerListDefault ?? undefined;

  // REGLA DE ORO del default del peer group:
  //   1. Exactamente 5 entidades — top 1 de cada tipo regulatorio SBS.
  //   2. Orden jerarquico: Bancos > Financieras > CMAC > CRAC > EDPYMES.
  //   3. La ENTIDAD PROPIA REEMPLAZA al top de su mismo tipo (no suma).
  //      Si el cliente es BCP (BANCOS) y Santander es el top de BANCOS por
  //      cartera, el peer default = [BCP, Confianza, CMAC-A, CRAC-L, Volvo]
  //      (Santander desplazado). El usuario final puede agregar Santander
  //      manualmente via 'Editar comparativa' si quiere ambos.
  //   4. Si el override manual del usuario viene en URL (?peerGroup=...),
  //      se respeta EXACTAMENTE — usuario final manda sobre defaults.
  if (peerList && !opts.peerGroupOverride) {
    peerList = await aplicarReglaPeerDefault(peerList, cliente.entidadPropia);
  } else if (peerList && !peerList.includes(cliente.entidadPropia)) {
    // Override manual del usuario que se olvido de incluir a la propia:
    // agregarla al final para no perderla, pero SIN reordenar el resto.
    peerList = [...peerList, cliente.entidadPropia];
  }

  let competidores = await buildCompetidores(
    opts.clienteSlug,
    peerList ?? null,
    cliente.entidadPropia,
    opts.colorsOverride ?? null,
  );

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

  // HOTFIX: las queries historicas se deshabilitan en el SSR para garantizar
  // que la pagina cargue. Las secciones historicas quedan vacias temporalmente
  // hasta que se implemente lazy-load via client component.
  // Lo unico que se hace aqui es el cuadro resumen + PE actual/prev/dic +
  // bubble + waterfalls — lo que YA funcionaba antes del batch de historicos.
  const HISTORICO_ENABLED = false;
  const emptyMap = new Map();
  const [
    peActual,
    pePrev,
    peDicPrev,
    cuadroRaw,
    oficinasHistMap,
    personalHistMap,
    clientesHistMap,
    peHistMap,
    kpisHistMap,
    moraConsolidado,
    cobCarMap,
    carteraBrutaMap,
  ] = await Promise.all([
    getPuntoEquilibrioForPeriodo(opts.periodo, entidadesNombs, consolidar),
    getPuntoEquilibrioForPeriodo(periodoPrev, entidadesNombs, consolidar),
    getPuntoEquilibrioForPeriodo(periodoDicPrev, entidadesNombs, consolidar),
    getCuadroResumenRaw(opts.periodo, entidadesNombs, consolidar),
    HISTORICO_ENABLED
      ? getHistoricoEntidad({ entidades: entidadesNombs, periodoActual: opts.periodo, metric: "oficinas", consolidar, ultimosN: 5 })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; valor: number | null }>>),
    HISTORICO_ENABLED
      ? getHistoricoEntidad({ entidades: entidadesNombs, periodoActual: opts.periodo, metric: "personal", consolidar, ultimosN: 5 })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; valor: number | null }>>),
    HISTORICO_ENABLED
      ? getHistoricoEntidad({ entidades: entidadesNombs, periodoActual: opts.periodo, metric: "clientes", consolidar, ultimosN: 5 })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; valor: number | null }>>),
    HISTORICO_ENABLED
      ? getHistoricoPuntoEquilibrio({ entidades: entidadesNombs, periodoActual: opts.periodo, consolidar })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; pe: PuntoEqRow | null }>>),
    HISTORICO_ENABLED
      ? getHistoricoKpisAnuales({ entidades: entidadesNombs, periodoActual: opts.periodo, consolidar })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; k: KpisAnualesRow | null }>>),
    HISTORICO_ENABLED
      ? getHistoricoMoraConsolidado({ entidades: entidadesNombs, periodoActual: opts.periodo })
      : Promise.resolve({ mora: emptyMap, moraVc: emptyMap, atrasada: emptyMap, car: emptyMap } as Awaited<ReturnType<typeof getHistoricoMoraConsolidado>>),
    HISTORICO_ENABLED
      ? getHistoricoFromMartView({ view: "marts.v_cobertura_car_historica", field: "pct_cobertura_car", entidades: entidadesNombs, periodoActual: opts.periodo })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; valor: number | null }>>),
    HISTORICO_ENABLED
      ? getHistoricoFromMartView({ view: "marts.v_cartera_balance_historica", field: "cartera_bruta / 1000", entidades: entidadesNombs, periodoActual: opts.periodo })
      : Promise.resolve(emptyMap as Map<string, Array<{ periodo: number; valor: number | null }>>),
  ]);
  const moraMap = moraConsolidado.mora;
  const moraVcMap = moraConsolidado.moraVc;
  const atrasadaMap = moraConsolidado.atrasada;
  const carMap = moraConsolidado.car;

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
  const { waterfall: waterfallVsDic } = buildBubbleAndWaterfall(peActual, peDicPrev, competidores);

  // Historicos: ya fueron resueltos en el Promise.all gigante de arriba.
  // Aqui solo transformamos los Map -> HistoricoEntidadSerie[] (sincrono).
  const oficinasHistorico = buildHistoricoSeries(oficinasHistMap, competidores);
  const personalHistorico = buildHistoricoSeries(personalHistMap, competidores);
  const clientesHistorico = buildHistoricoSeries(clientesHistMap, competidores);

  // KPIs derivados de Punto Equilibrio (anualizados TTM) — peHistMap ya
  // viene del Promise.all gigante.
  const rendimientoCarteraHistorico = buildHistoricoFromPE(peHistMap, competidores, "pct_rendimiento");
  const costoFondeoHistorico = buildHistoricoFromPE(peHistMap, competidores, "pct_costo_fondeo");
  const costoProvisionesHistorico = buildHistoricoFromPE(peHistMap, competidores, "pct_provisiones");
  const eficienciaHistorico = buildHistoricoFromPE(peHistMap, competidores, "pct_gastos_op");
  const gastosPersonalHistorico = buildHistoricoFromPE(peHistMap, competidores, "pct_gastos_personal");
  const gastosGeneralesHistorico = buildHistoricoFromPE(peHistMap, competidores, "pct_gastos_generales");

  // KPIs anuales TTM — kpisHistMap ya viene del Promise.all gigante.
  // Cifras absolutas vienen en miles -> dividimos por 1000 para mostrar en MM S/.
  const utilidadNetaHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => (k.utilidad_ttm == null ? null : k.utilidad_ttm / 1000));
  const roeHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => {
      if (k.utilidad_ttm == null || !k.patrimonio_prom_12m || k.patrimonio_prom_12m === 0) return null;
      return k.utilidad_ttm / k.patrimonio_prom_12m;
    });
  const roaHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => {
      if (k.utilidad_ttm == null || !k.activos_prom_12m || k.activos_prom_12m === 0) return null;
      return k.utilidad_ttm / k.activos_prom_12m;
    });
  const ingresosFinancierosHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => (k.cta_1_ttm == null ? null : k.cta_1_ttm / 1000));
  const gastosFinancierosHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => (k.cta_2_ttm == null ? null : k.cta_2_ttm / 1000));
  const margenFinancieroBrutoHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => {
      if (k.cta_1_ttm == null || k.cta_2_ttm == null) return null;
      return (k.cta_1_ttm - k.cta_2_ttm) / 1000;
    });
  const margenFinancieroNetoHistorico = buildHistoricoFromKpis(kpisHistMap, competidores,
    (k) => {
      // Margen Financiero Neto = Margen Bruto + INOF Neto = (cta_1 - cta_2) + (cta_6 - cta_7)
      if (k.cta_1_ttm == null || k.cta_2_ttm == null) return null;
      const bruto = k.cta_1_ttm - k.cta_2_ttm;
      const inof = (k.cta_6_ttm ?? 0) - (k.cta_7_ttm ?? 0);
      return (bruto + inof) / 1000;
    });

  // Calidad cartera — maps ya vienen del Promise.all gigante.
  const moraGlobalHistorico = buildHistoricoFromValueMap(moraMap, competidores);
  const moraGlobalVcHistorico = buildHistoricoFromValueMap(moraVcMap, competidores);
  const coberturaCarHistorico = buildHistoricoFromValueMap(cobCarMap, competidores);
  const carteraAtrasadaHistorico = buildHistoricoFromValueMap(atrasadaMap, competidores);
  const carHistorico = buildHistoricoFromValueMap(carMap, competidores);

  // Cartera bruta MM S/ — ya viene del Promise.all gigante.
  const carteraBrutaHistorico = buildHistoricoFromValueMap(carteraBrutaMap, competidores);

  return {
    cliente,
    periodo: { codigo: opts.periodo, label: periodoLabel(opts.periodo) },
    periodoComparativo: { codigo: periodoPrev, label: periodoLabel(periodoPrev) },
    periodoDicPrev: { codigo: periodoDicPrev, label: periodoLabel(periodoDicPrev) },
    competidores,
    cuadroResumen,
    puntoEquilibrio,
    margenNetoHistorico,
    margenNetoBubble: bubble,
    margenNetoWaterfall: waterfall,
    margenNetoWaterfallVsDic: waterfallVsDic,
    oficinasHistorico,
    personalHistorico,
    clientesHistorico,
    rendimientoCarteraHistorico,
    costoFondeoHistorico,
    costoProvisionesHistorico,
    eficienciaHistorico,
    gastosPersonalHistorico,
    gastosGeneralesHistorico,
    utilidadNetaHistorico,
    roeHistorico,
    roaHistorico,
    ingresosFinancierosHistorico,
    gastosFinancierosHistorico,
    margenFinancieroBrutoHistorico,
    margenFinancieroNetoHistorico,
    moraGlobalHistorico,
    moraGlobalVcHistorico,
    coberturaCarHistorico,
    carteraAtrasadaHistorico,
    carHistorico,
    carteraBrutaHistorico,
    comentarios: {
      margen_neto_bubble: "",
      margen_neto_waterfall: "",
    },
    cobertura,
  };
}

/**
 * Convierte el Map<entidad, array<{periodo,valor}>> al shape que consume
 * el frontend: una entrada por competidor con su serie ordenada por periodo
 * + crecimiento delta vs periodo previo + valorBase (primero) + valorActual (ultimo).
 */
export function buildHistoricoSeries(
  map: Map<string, Array<{ periodo: number; valor: number | null }>>,
  competidores: Competidor[],
): import("./types").HistoricoEntidadSerie[] {
  return competidores.map((c) => {
    const puntosRaw = map.get(c.nombCorreg) ?? [];
    const serie = puntosRaw
      .sort((a, b) => a.periodo - b.periodo)
      .map((p, i, arr) => {
        const prev = i > 0 ? arr[i - 1]!.valor : null;
        const crecimiento = prev != null && p.valor != null ? p.valor - prev : null;
        return {
          periodo: p.periodo,
          periodoLabel: periodoLabel(p.periodo),
          valor: p.valor,
          crecimiento,
        };
      });
    const valorActual = serie.length > 0 ? serie[serie.length - 1]!.valor : null;
    const valorBase = serie.length > 0 ? serie[0]!.valor : null;
    const variacionTotal =
      valorActual != null && valorBase != null ? valorActual - valorBase : null;
    return {
      entidad: c.labelCorto,
      color: c.color,
      valorActual,
      valorBase,
      variacionTotal,
      serie,
    };
  });
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
export function periodoLabelCorto(periodo: number): string {
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

/**
 * REGLA DE ORO — Ultimo periodo publicable en el /dashboard/informe.
 *
 * Criterio (V139): EEFF (balance + resultados) procesado para al menos
 * 4 de los 5 grupos regulados (bancos/cmac/crac/edpyme/financiera).
 * Los topicos secundarios (castigos, tasas, indicadores, geo) NO bloquean
 * — sus valores especificos aparecen en "—" si aun no estan publicados,
 * pero el informe se muestra apenas hay EEFF.
 *
 * Antes de V139 el default era f_ultimo_periodo_completo (todos los
 * topicos), lo que provocaba que durante 2-4 semanas al mes el dashboard
 * mostrara el mes anterior aunque el EEFF del mes corriente ya estuviera
 * listo. La nueva regla prioriza time-to-insight.
 *
 * Implementacion SQL: marts.f_ultimo_periodo_publicable().
 * Para status detallado de un periodo (que topicos faltan) usar
 * getPeriodoCompletenessStatus().
 */
export async function getUltimoPeriodoPublicable(): Promise<number | null> {
  return safeQuery(
    "getUltimoPeriodoPublicable",
    async () => {
      const rows = await db.execute<{ periodo: number | null }>(sql`
        SELECT marts.f_ultimo_periodo_publicable() AS periodo
      `);
      const p = rows[0]?.periodo;
      return p == null ? null : Number(p);
    },
    null,
  );
}

/**
 * Status detallado de completitud de un periodo — que topicos estan
 * completos vs parciales vs faltantes. Consumir desde la UI para
 * mostrar tooltip/badge en el selector de periodo cuando el usuario
 * elige un periodo con topicos secundarios pendientes.
 *
 * Devuelve null si SQL falla (fallback graceful — la UI muestra sin badge).
 */
export type PeriodoCompletenessStatus = {
  periodo: number;
  eeff_completo: boolean;
  grupos_eeff_ok: number;
  topicos_completos: string[];
  topicos_parciales: string[];
  topicos_faltantes: string[];
};

export async function getPeriodoCompletenessStatus(
  periodo: number,
): Promise<PeriodoCompletenessStatus | null> {
  return safeQuery(
    "getPeriodoCompletenessStatus",
    async () => {
      const rows = await db.execute<{ status: PeriodoCompletenessStatus }>(sql`
        SELECT marts.f_ultimo_periodo_completeness_status(${periodo}) AS status
      `);
      return rows[0]?.status ?? null;
    },
    null,
  );
}

/**
 * Periodos para tendencia historica — 5 puntos que dan contexto
 * multi-anual con snap a diciembres.
 *
 * Regla acordada con el negocio:
 *   - Si periodoActual NO es diciembre (ej. May 2026):
 *       [Dic year-3, Dic year-2, Mismo mes year-1, Dic year-1, actual]
 *       ej. May 2026 -> Dic 2023, Dic 2024, May 2025, Dic 2025, May 2026
 *   - Si periodoActual ES diciembre (ej. Dic 2026):
 *       [Dic year-4, Dic year-3, Dic year-2, Dic year-1, actual]
 *       ej. Dic 2026 -> Dic 2022, Dic 2023, Dic 2024, Dic 2025, Dic 2026
 *
 * Los periodos que no existan en marts.mv_eeff_resultados_ancho se
 * filtran para que el bar chart no renderice barras vacias.
 */
async function getPeriodosTendencia(periodoActual: number): Promise<number[]> {
  const anio = Math.floor(periodoActual / 100);
  const mes = periodoActual % 100;
  const candidatos: number[] =
    mes === 12
      ? [
          (anio - 4) * 100 + 12,
          (anio - 3) * 100 + 12,
          (anio - 2) * 100 + 12,
          (anio - 1) * 100 + 12,
          periodoActual,
        ]
      : [
          (anio - 3) * 100 + 12,
          (anio - 2) * 100 + 12,
          (anio - 1) * 100 + mes,
          (anio - 1) * 100 + 12,
          periodoActual,
        ];

  return safeQuery(
    "getPeriodosTendencia",
    async () => {
      const candidatosClause = sql.join(candidatos.map((p) => sql`${p}`), sql`, `);
      const rows = await db.execute<{ periodo: number }>(sql`
        SELECT DISTINCT periodo
          FROM marts.mv_eeff_resultados_ancho
         WHERE periodo IN (${candidatosClause})
         ORDER BY periodo ASC
      `);
      return rows.map((r) => Number(r.periodo));
    },
    [],
  );
}

/**
 * Lookup snapshot-only de Punto Equilibrio para los periodos de tendencia.
 * UNA sola query con WHERE periodo IN (...) — sin recompute. Si un periodo
 * no tiene snapshot, esa entrada queda null (mejor que bloquear el render
 * llamando compute_kpis_punto_equilibrio en cascada).
 *
 * Devuelve Map<entidad, array<{periodo, pe}>> con todos los periodos
 * (incluso si pe es null para alguno).
 */
export async function getHistoricoPuntoEquilibrio(opts: {
  entidades: string[];
  periodoActual: number;
  consolidar?: boolean;
}): Promise<Map<string, Array<{ periodo: number; pe: PuntoEqRow | null }>>> {
  if (opts.entidades.length === 0) return new Map();
  const periodos = await getPeriodosTendencia(opts.periodoActual);
  if (periodos.length === 0) return new Map();
  return safeQuery(
    "getHistoricoPuntoEquilibrio",
    async () => {
      // Bulk SELECT directo de v_punto_equilibrio_ancho (snapshot cached).
      // Sin recompute — un solo round-trip a Postgres.
      const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);
      const entidadesClause = sql.join(opts.entidades.map((e) => sql`${e}`), sql`, `);
      const rows = await db.execute<{
        nomb_correg: string;
        periodo: number;
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
      }>(sql`
        SELECT pe.nomb_correg, pe.periodo,
               pe.pct_rendimiento, pe.pct_costo_fondeo, pe.pct_provisiones,
               pe.pct_gastos_op, pe.pct_gastos_personal, pe.pct_gastos_generales,
               pe.pct_deprec, pe.pct_otros, pe.pct_punto_eq, pe.pct_margen_neto
        FROM marts.v_punto_equilibrio_ancho pe
        WHERE pe.periodo IN (${periodosClause})
          AND pe.moneda = 'TOTAL'
          AND pe.nomb_correg IN (${entidadesClause})
      `);
      const idx = new Map<string, Map<number, PuntoEqRow>>();
      for (const r of rows) {
        const k = String(r.nomb_correg);
        if (!idx.has(k)) idx.set(k, new Map());
        idx.get(k)!.set(Number(r.periodo), {
          nomb_correg: k,
          pct_rendimiento: r.pct_rendimiento == null ? null : Number(r.pct_rendimiento),
          pct_costo_fondeo: r.pct_costo_fondeo == null ? null : Number(r.pct_costo_fondeo),
          pct_provisiones: r.pct_provisiones == null ? null : Number(r.pct_provisiones),
          pct_gastos_op: r.pct_gastos_op == null ? null : Number(r.pct_gastos_op),
          pct_gastos_personal: r.pct_gastos_personal == null ? null : Number(r.pct_gastos_personal),
          pct_gastos_generales: r.pct_gastos_generales == null ? null : Number(r.pct_gastos_generales),
          pct_deprec: r.pct_deprec == null ? null : Number(r.pct_deprec),
          pct_otros: r.pct_otros == null ? null : Number(r.pct_otros),
          pct_punto_eq: r.pct_punto_eq == null ? null : Number(r.pct_punto_eq),
          pct_margen_neto: r.pct_margen_neto == null ? null : Number(r.pct_margen_neto),
        });
      }
      const out = new Map<string, Array<{ periodo: number; pe: PuntoEqRow | null }>>();
      for (const ent of opts.entidades) {
        const e = idx.get(ent);
        out.set(ent, periodos.map((p) => ({ periodo: p, pe: e?.get(p) ?? null })));
      }
      return out;
    },
    new Map(),
  );
}

/**
 * Convierte el Map<entidad, array<{periodo, pe}>> a HistoricoEntidadSerie[]
 * extrayendo un campo especifico de PuntoEqRow (ej "pct_rendimiento").
 */
/**
 * Convierte un Map<entidad, array<{periodo, valor}>> a HistoricoEntidadSerie[]
 * directamente (caso simple cuando el valor ya viene listo de la vista).
 */
export function buildHistoricoFromValueMap(
  map: Map<string, Array<{ periodo: number; valor: number | null }>>,
  competidores: Competidor[],
): import("./types").HistoricoEntidadSerie[] {
  return competidores.map((c) => {
    const puntos = map.get(c.nombCorreg) ?? [];
    const serie = puntos.map((p, i, arr) => {
      const prev = i > 0 ? arr[i - 1]!.valor : null;
      const crecimiento = p.valor != null && prev != null ? p.valor - prev : null;
      return {
        periodo: p.periodo,
        periodoLabel: periodoLabel(p.periodo),
        valor: p.valor,
        crecimiento,
      };
    });
    const valorActual = serie.length > 0 ? serie[serie.length - 1]!.valor : null;
    const valorBase = serie.length > 0 ? serie[0]!.valor : null;
    const variacionTotal =
      valorActual != null && valorBase != null ? valorActual - valorBase : null;
    return {
      entidad: c.labelCorto,
      color: c.color,
      valorActual,
      valorBase,
      variacionTotal,
      serie,
    };
  });
}

export function buildHistoricoFromPE(
  map: Map<string, Array<{ periodo: number; pe: PuntoEqRow | null }>>,
  competidores: Competidor[],
  field: keyof PuntoEqRow,
): import("./types").HistoricoEntidadSerie[] {
  return competidores.map((c) => {
    const puntos = map.get(c.nombCorreg) ?? [];
    const serie = puntos.map((p, i, arr) => {
      const v = p.pe?.[field];
      const valor = typeof v === "number" ? v : null;
      const prevPe = i > 0 ? arr[i - 1]!.pe : null;
      const prevV = prevPe ? prevPe[field] : null;
      const prevNum = typeof prevV === "number" ? prevV : null;
      const crecimiento = valor != null && prevNum != null ? valor - prevNum : null;
      return {
        periodo: p.periodo,
        periodoLabel: periodoLabel(p.periodo),
        valor,
        crecimiento,
      };
    });
    const valorActual = serie.length > 0 ? serie[serie.length - 1]!.valor : null;
    const valorBase = serie.length > 0 ? serie[0]!.valor : null;
    const variacionTotal =
      valorActual != null && valorBase != null ? valorActual - valorBase : null;
    return {
      entidad: c.labelCorto,
      color: c.color,
      valorActual,
      valorBase,
      variacionTotal,
      serie,
    };
  });
}

/**
 * Variante consolidada para v_mora_global_historica: en una sola query
 * trae las 4 metricas (mora, mora v/c, atrasada, CAR) y devuelve un Map
 * con 4 series listas. Sin esto eran 4 queries separadas a un view
 * pesado (multi-join con castigos + venta cartera) que sobrecargaba el
 * connection pool.
 */
export async function getHistoricoMoraConsolidado(opts: {
  entidades: string[];
  periodoActual: number;
}): Promise<{
  mora: Map<string, Array<{ periodo: number; valor: number | null }>>;
  moraVc: Map<string, Array<{ periodo: number; valor: number | null }>>;
  atrasada: Map<string, Array<{ periodo: number; valor: number | null }>>;
  car: Map<string, Array<{ periodo: number; valor: number | null }>>;
}> {
  const empty = {
    mora: new Map(),
    moraVc: new Map(),
    atrasada: new Map(),
    car: new Map(),
  };
  if (opts.entidades.length === 0) return empty;
  const periodos = await getPeriodosTendencia(opts.periodoActual);
  if (periodos.length === 0) return empty;
  return safeQuery(
    "getHistoricoMoraConsolidado",
    async () => {
      const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);
      const entidadesClause = sql.join(opts.entidades.map((e) => sql`${e}`), sql`, `);
      const rows = await db.execute<{
        nomb_correg: string;
        periodo: number;
        pct_mora_global: number | null;
        pct_mora_global_vc: number | null;
        pct_atrasada: number | null;
        pct_car: number | null;
      }>(sql`
        SELECT nomb_correg, periodo,
               pct_mora_global,
               pct_mora_global_vc,
               CASE WHEN cartera_bruta > 0
                    THEN (cartera_atrasada / cartera_bruta)::numeric
                    ELSE NULL END AS pct_atrasada,
               CASE WHEN cartera_bruta > 0
                    THEN ((cartera_atrasada + cartera_refin) / cartera_bruta)::numeric
                    ELSE NULL END AS pct_car
        FROM marts.v_mora_global_historica
        WHERE periodo IN (${periodosClause})
          AND nomb_correg IN (${entidadesClause})
      `);
      const reshape = (field: "pct_mora_global" | "pct_mora_global_vc" | "pct_atrasada" | "pct_car") => {
        const idx = new Map<string, Map<number, number | null>>();
        for (const r of rows) {
          const k = String(r.nomb_correg);
          if (!idx.has(k)) idx.set(k, new Map());
          const v = r[field];
          idx.get(k)!.set(Number(r.periodo), v == null ? null : Number(v));
        }
        const out = new Map<string, Array<{ periodo: number; valor: number | null }>>();
        for (const ent of opts.entidades) {
          const e = idx.get(ent);
          out.set(ent, periodos.map((p) => ({ periodo: p, valor: e?.get(p) ?? null })));
        }
        return out;
      };
      return {
        mora: reshape("pct_mora_global"),
        moraVc: reshape("pct_mora_global_vc"),
        atrasada: reshape("pct_atrasada"),
        car: reshape("pct_car"),
      };
    },
    empty,
  );
}

/**
 * Trae una metrica historica desde una vista mart estandar (que tiene
 * columnas `periodo`, `nomb_correg` y la columna que se especifique).
 * Bulk query con IN (...) generado por sql.join — el ANY(${arr}::T[])
 * con drizzle no serializa bien arrays de strings con acentos.
 */
export async function getHistoricoFromMartView(opts: {
  view: string;          // ej "marts.v_mora_global_historica"
  field: string;         // ej "pct_mora_global"
  entidades: string[];
  periodoActual: number;
}): Promise<Map<string, Array<{ periodo: number; valor: number | null }>>> {
  if (opts.entidades.length === 0) return new Map();
  const periodos = await getPeriodosTendencia(opts.periodoActual);
  if (periodos.length === 0) return new Map();
  return safeQuery(
    `getHistoricoFromMartView[${opts.view}/${opts.field}]`,
    async () => {
      const view = sql.raw(opts.view);
      const field = sql.raw(`(${opts.field})`); // wrap en parens por seguridad de operadores
      const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);
      const entidadesClause = sql.join(opts.entidades.map((e) => sql`${e}`), sql`, `);
      const rows = await db.execute<{
        nomb_correg: string;
        periodo: number;
        valor: number | null;
      }>(sql`
        SELECT nomb_correg, periodo, ${field}::numeric AS valor
        FROM ${view}
        WHERE periodo IN (${periodosClause})
          AND nomb_correg IN (${entidadesClause})
      `);
      const indexByEnt = new Map<string, Map<number, number | null>>();
      for (const r of rows) {
        const k = String(r.nomb_correg);
        if (!indexByEnt.has(k)) indexByEnt.set(k, new Map());
        indexByEnt.get(k)!.set(Number(r.periodo), r.valor == null ? null : Number(r.valor));
      }
      const out = new Map<string, Array<{ periodo: number; valor: number | null }>>();
      for (const ent of opts.entidades) {
        const idx = indexByEnt.get(ent);
        out.set(
          ent,
          periodos.map((p) => ({ periodo: p, valor: idx?.get(p) ?? null })),
        );
      }
      return out;
    },
    new Map(),
  );
}

/**
 * Trae KPIs anuales TTM (utilidad, patrimonio prom 12m, activos prom 12m,
 * cuentas 1/2/6/7/10/12 TTM) para un set de entidades en los periodos de
 * tendencia. Returns Map<entidad, array<{periodo, kpis}>>.
 */
type KpisAnualesRow = {
  utilidad_ttm: number | null;
  patrimonio_prom_12m: number | null;
  activos_prom_12m: number | null;
  cta_1_ttm: number | null;
  cta_2_ttm: number | null;
  cta_6_ttm: number | null;
  cta_7_ttm: number | null;
};

export async function getHistoricoKpisAnuales(opts: {
  entidades: string[];
  periodoActual: number;
  consolidar?: boolean;
}): Promise<Map<string, Array<{ periodo: number; k: KpisAnualesRow | null }>>> {
  if (opts.entidades.length === 0) return new Map();
  const periodos = await getPeriodosTendencia(opts.periodoActual);
  if (periodos.length === 0) return new Map();
  const consolidar = opts.consolidar !== false;
  return safeQuery(
    "getHistoricoKpisAnuales",
    async () => {
      const view = consolidar
        ? sql.raw("marts.mv_kpis_anuales_entidad")
        : sql.raw("marts.v_kpis_anuales_historica");
      const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);
      const entidadesClause = sql.join(opts.entidades.map((e) => sql`${e}`), sql`, `);
      const rows = await db.execute<{
        nomb_correg: string;
        periodo: number;
        utilidad_ttm: number | null;
        patrimonio_prom_12m: number | null;
        activos_prom_12m: number | null;
        cta_1_ttm: number | null;
        cta_2_ttm: number | null;
        cta_6_ttm: number | null;
        cta_7_ttm: number | null;
      }>(sql`
        SELECT nomb_correg, periodo,
               utilidad_ttm, patrimonio_prom_12m, activos_prom_12m,
               cta_1_ttm, cta_2_ttm, cta_6_ttm, cta_7_ttm
        FROM ${view}
        WHERE periodo IN (${periodosClause})
          AND nomb_correg IN (${entidadesClause})
      `);
      const indexByEnt = new Map<string, Map<number, KpisAnualesRow>>();
      for (const r of rows) {
        const k = String(r.nomb_correg);
        if (!indexByEnt.has(k)) indexByEnt.set(k, new Map());
        indexByEnt.get(k)!.set(Number(r.periodo), {
          utilidad_ttm: r.utilidad_ttm == null ? null : Number(r.utilidad_ttm),
          patrimonio_prom_12m: r.patrimonio_prom_12m == null ? null : Number(r.patrimonio_prom_12m),
          activos_prom_12m: r.activos_prom_12m == null ? null : Number(r.activos_prom_12m),
          cta_1_ttm: r.cta_1_ttm == null ? null : Number(r.cta_1_ttm),
          cta_2_ttm: r.cta_2_ttm == null ? null : Number(r.cta_2_ttm),
          cta_6_ttm: r.cta_6_ttm == null ? null : Number(r.cta_6_ttm),
          cta_7_ttm: r.cta_7_ttm == null ? null : Number(r.cta_7_ttm),
        });
      }
      const out = new Map<string, Array<{ periodo: number; k: KpisAnualesRow | null }>>();
      for (const ent of opts.entidades) {
        const idx = indexByEnt.get(ent);
        out.set(
          ent,
          periodos.map((p) => ({ periodo: p, k: idx?.get(p) ?? null })),
        );
      }
      return out;
    },
    new Map(),
  );
}

/**
 * Convierte el Map<entidad, array<{periodo, kpis}>> a HistoricoEntidadSerie[]
 * aplicando una funcion de calculo sobre KpisAnualesRow (ej. para ROA:
 * k.utilidad_ttm / k.activos_prom_12m). Las cifras absolutas se pueden
 * dividir por 1000 (KK) o 1_000_000 (MM) via el factor.
 */
export function buildHistoricoFromKpis(
  map: Map<string, Array<{ periodo: number; k: KpisAnualesRow | null }>>,
  competidores: Competidor[],
  compute: (k: KpisAnualesRow) => number | null,
): import("./types").HistoricoEntidadSerie[] {
  return competidores.map((c) => {
    const puntos = map.get(c.nombCorreg) ?? [];
    const serie = puntos.map((p, i, arr) => {
      const valor = p.k ? compute(p.k) : null;
      const prevK = i > 0 ? arr[i - 1]!.k : null;
      const prevV = prevK ? compute(prevK) : null;
      const crecimiento = valor != null && prevV != null ? valor - prevV : null;
      return {
        periodo: p.periodo,
        periodoLabel: periodoLabel(p.periodo),
        valor: valor != null && Number.isFinite(valor) ? valor : null,
        crecimiento,
      };
    });
    const valorActual = serie.length > 0 ? serie[serie.length - 1]!.valor : null;
    const valorBase = serie.length > 0 ? serie[0]!.valor : null;
    const variacionTotal =
      valorActual != null && valorBase != null ? valorActual - valorBase : null;
    return {
      entidad: c.labelCorto,
      color: c.color,
      valorActual,
      valorBase,
      variacionTotal,
      serie,
    };
  });
}

/**
 * Default peer group: top 2 entidades por cartera bruta del periodo, para
 * cada uno de los 5 grupos SBS (Bancos, Financieras, CMAC, CRAC, Empresas
 * de Creditos). Total = 10 competidores, ordenados por grupo.
 *
 * Se usa cuando el usuario aterriza en /benchmark sin haber definido un
 * peerGroup en la URL — asi siempre ve una comparativa representativa
 * out-of-the-box contra los lideres de cada categoria.
 *
 * Fallback: si la query falla (ej. MV no refresheada), devuelve [] —
 * buildCompetidores cae a su propio fallback estatico.
 */
/**
 * Serie historica de N de oficinas o personal para una lista de entidades,
 * en los ultimos N periodos disponibles. Usado por el informe en las
 * secciones "N° de Oficinas" y "N° de Personal" para mostrar tendencia.
 *
 * Devuelve por entidad: array de { periodo, valor, crecimiento_vs_prev }.
 * El primer punto tiene crecimiento=null (sin referencia previa).
 *
 * `metric` = "oficinas" | "personal" elige la vista subyacente.
 */
export async function getHistoricoEntidad(opts: {
  entidades: string[];
  periodoActual: number;
  metric: "oficinas" | "personal" | "clientes";
  consolidar?: boolean;
  /** @deprecated ya no se usa — la serie sigue la regla de 5 puntos tendencia. */
  ultimosN?: number;
}): Promise<Map<string, Array<{ periodo: number; valor: number | null }>>> {
  const consolidar = opts.consolidar !== false;
  if (opts.entidades.length === 0) return new Map();
  // Regla de oro: la serie es la misma 5 puntos que usan cartera bruta,
  // mora y demas metricas (no-Dic: [Dic-3, Dic-2, MismoMes-1, Dic-1, actual];
  // Dic: 5 Diciembres consecutivos). Antes usabamos "los 5 mas recientes"
  // (Feb, Mar, Abr, May, Jun) — no comparable a las otras secciones.
  const periodos = await getPeriodosTendencia(opts.periodoActual);
  if (periodos.length === 0) return new Map();
  return safeQuery(
    `getHistoricoEntidad[${opts.metric}]`,
    async () => {
      const view = opts.metric === "oficinas"
        ? (consolidar
            ? sql.raw("marts.v_oficinas_por_entidad_canonico")
            : sql.raw("marts.v_oficinas_por_entidad_historica"))
        : opts.metric === "personal"
          ? (consolidar
              ? sql.raw("marts.v_personal_por_entidad_canonico")
              : sql.raw("marts.v_personal_por_entidad_historica"))
          : (consolidar
              ? sql.raw("marts.v_clientes_por_entidad_canonico")
              : sql.raw("marts.v_clientes_por_entidad_historica"));
      const valorCol = opts.metric === "oficinas"
        ? sql.raw("n_oficinas")
        : opts.metric === "personal"
          ? sql.raw("n_personal")
          : sql.raw("n_clientes");
      const entidadesClause = sql.join(opts.entidades.map((e) => sql`${e}`), sql`, `);
      const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);
      const rows = await db.execute<{
        nomb_correg: string;
        periodo: number;
        valor: number | null;
      }>(sql`
        SELECT v.nomb_correg, v.periodo, v.${valorCol}::int AS valor
        FROM ${view} v
        WHERE v.periodo IN (${periodosClause})
          AND v.nomb_correg IN (${entidadesClause})
        ORDER BY v.nomb_correg, v.periodo ASC
      `);
      const map = new Map<string, Array<{ periodo: number; valor: number | null }>>();
      for (const r of rows) {
        const k = String(r.nomb_correg);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push({ periodo: Number(r.periodo), valor: r.valor == null ? null : Number(r.valor) });
      }
      return map;
    },
    new Map(),
  );
}

const JERARQUIA_SBS: Record<string, number> = {
  BANCOS: 0,
  FINANCIERAS: 1,
  CMAC: 2,
  CRAC: 3,
  EDPYMES: 4,
};

/**
 * REGLA DE ORO — Arma el peer group DEFAULT del /dashboard/informe:
 *
 *   1. Reordena por jerarquia regulatoria SBS:
 *      Bancos > Financieras > CMAC > CRAC > EDPYMES.
 *   2. La ENTIDAD PROPIA REEMPLAZA al top de su mismo tipo (no suma).
 *      Ejemplo: si el cliente es BCP (BANCOS) y en peerList venia Santander
 *      como top BANCOS por cartera, el resultado tiene BCP y Santander sale.
 *      Objetivo: mantener exactamente 5 entidades (top 1 por tipo).
 *   3. Si la propia es de un tipo NO representado en peerList, se inserta
 *      en la posicion jerarquica correcta (no al final).
 *
 * NO se aplica cuando el usuario provee peerGroupOverride en URL — ese
 * caso preserva el orden manual del usuario exactamente como vino.
 *
 * 1 sola query a dw.dim_entidad (todos los tipos en batch).
 */
async function aplicarReglaPeerDefault(
  peerList: string[],
  entidadPropia: string,
): Promise<string[]> {
  const entidadesUnicas = Array.from(new Set([...peerList, entidadPropia]));
  if (entidadesUnicas.length === 0) return peerList;

  const rows = await safeQuery(
    "aplicarReglaPeerDefault.tipos",
    async () => {
      const entArr = sql`ARRAY[${sql.join(
        entidadesUnicas.map((e) => sql`${e}`),
        sql`, `,
      )}]::text[]`;
      return db.execute<{ nomb_correg: string; tipo_entidad: string | null }>(sql`
        SELECT nomb_correg, UPPER(tipo_entidad) AS tipo_entidad
        FROM dw.dim_entidad
        WHERE nomb_correg = ANY(${entArr})
      `);
    },
    [] as Array<{ nomb_correg: string; tipo_entidad: string | null }>,
  );

  const tipoOf = (nomb: string): string => {
    const found = rows.find((r) => String(r.nomb_correg) === nomb);
    return found?.tipo_entidad ?? "";
  };

  const tipoPropia = tipoOf(entidadPropia);
  let out = [...peerList];

  // Paso 1: si la propia no esta, REEMPLAZAR al primer competidor de su
  // mismo tipo (o insertar si el tipo no esta representado).
  if (!out.includes(entidadPropia)) {
    const idxMismoTipo = tipoPropia
      ? out.findIndex((e) => tipoOf(e) === tipoPropia)
      : -1;
    if (idxMismoTipo >= 0) {
      out[idxMismoTipo] = entidadPropia;
    } else {
      out.push(entidadPropia);
    }
  }

  // Paso 2: ordenar por jerarquia SBS. Dentro del mismo tipo, propia primero.
  const idxOriginal = new Map(out.map((e, i) => [e, i]));
  out.sort((a, b) => {
    const orderA = JERARQUIA_SBS[tipoOf(a)] ?? 99;
    const orderB = JERARQUIA_SBS[tipoOf(b)] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    if (a === entidadPropia) return -1;
    if (b === entidadPropia) return 1;
    return (idxOriginal.get(a) ?? 0) - (idxOriginal.get(b) ?? 0);
  });

  return out;
}

/**
 * Top N entidades por cartera bruta de CADA grupo SBS (Bancos, Financieras,
 * CMAC, CRAC, EDPYMES). Default n=1 → 5 entidades (la mas grande de cada
 * grupo). El benchmark por defecto compara contra los lideres absolutos.
 *
 * Antes era top 2 (10 entidades) pero saturaba el peer group y muchas
 * tendencias quedaban dificiles de leer. Top 1 da el comparativo limpio
 * de 5 lideres + la entidad propia = 6 puntos por defecto.
 */
export async function getTop2PorGrupoByCartera(
  periodo: number,
  n = 1,
): Promise<string[]> {
  const topN = Math.max(1, Math.min(n, 5));
  return safeQuery(
    "getTop2PorGrupoByCartera",
    async () => {
      const rows = await db.execute<{
        nomb_correg: string;
        tipo_entidad: string;
        cartera_total: number;
        rn: number;
      }>(sql`
        WITH cartera AS (
          SELECT
            v.nomb_correg,
            UPPER(e.tipo_entidad) AS tipo_entidad,
            v.cartera_total
          FROM marts.v_colocaciones_total_por_entidad v
          JOIN dw.dim_entidad e ON e.nomb_correg = v.nomb_correg
          WHERE v.periodo = ${periodo}
            AND NOT e.es_total
            AND NOT e.es_sucursal
            AND e.activa
            AND e.tipo_entidad IS NOT NULL
            AND v.nomb_correg NOT ILIKE '% Total'
            AND v.nomb_correg NOT ILIKE '%TOTAL%'
        ),
        ranked AS (
          SELECT
            nomb_correg,
            tipo_entidad,
            cartera_total,
            ROW_NUMBER() OVER (
              PARTITION BY tipo_entidad
              ORDER BY cartera_total DESC NULLS LAST
            ) AS rn
          FROM cartera
        )
        SELECT nomb_correg, tipo_entidad, cartera_total, rn
        FROM ranked
        WHERE rn <= ${topN}
          AND tipo_entidad IN ('BANCOS', 'FINANCIERAS', 'CMAC', 'CRAC', 'EDPYMES')
        ORDER BY
          CASE tipo_entidad
            WHEN 'BANCOS'      THEN 0
            WHEN 'FINANCIERAS' THEN 1
            WHEN 'CMAC'        THEN 2
            WHEN 'CRAC'        THEN 3
            WHEN 'EDPYMES'     THEN 4
            ELSE 99
          END,
          rn
      `);
      return rows.map((r) => String(r.nomb_correg));
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
