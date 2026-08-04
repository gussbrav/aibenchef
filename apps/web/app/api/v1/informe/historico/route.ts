/**
 * GET /api/v1/informe/historico?metric=<key>&periodo=<int>&peerGroup=<csv>&consolidar=true|false
 *
 * Devuelve { series: HistoricoEntidadSerie[] } para la metrica solicitada —
 * usado por el accordion lazy-load del Benchmark. El SSR de /dashboard/informe
 * NO trae estas series; cada seccion fetcha bajo demanda cuando se expande.
 *
 * Performance:
 *   - Cache in-memory server-side (10 min TTL). Primer request de una
 *     combinacion (metric, periodo, peers) hace query completa; siguientes
 *     hitean cache y respuestan en microsegundos.
 *   - Single-flight: si N requests concurrentes piden la misma key mientras
 *     la query esta corriendo, comparten la misma Promise en vez de
 *     duplicar el trabajo en Postgres.
 *   - HTTP Cache-Control con stale-while-revalidate para que el browser
 *     tambien cache 60s y muestre stale por 5min mientras revalida.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  buildHistoricoFromKpis,
  buildHistoricoFromPE,
  buildHistoricoFromValueMap,
  buildHistoricoSeries,
  getHistoricoEntidad,
  getHistoricoFromMartView,
  getHistoricoKpisAnuales,
  getHistoricoMoraConsolidado,
  getHistoricoPuntoEquilibrio,
  getTop2PorGrupoByCartera,
  getUltimoPeriodoPublicable,
  periodoLabel,
  pickColorEstable,
} from "@/lib/domains/informe/queries";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";
import { historicoCache, historicoCacheKey } from "@/lib/infrastructure/query-cache";
import type { Competidor, HistoricoEntidadSerie } from "@/lib/domains/informe/types";

export const dynamic = "force-dynamic";

type MetricKey =
  | "oficinas" | "personal" | "clientes"
  | "carteraBruta" | "cobCar"
  | "mora" | "moraVc" | "atrasada" | "car"
  | "rendimiento" | "costoFondeo" | "provisiones"
  | "eficiencia" | "gastosPersonal" | "gastosGenerales"
  | "utilidad" | "roe" | "roa"
  | "ingresos" | "gastos" | "margenBruto" | "margenNeto";

const VALID_METRICS = new Set<MetricKey>([
  "oficinas", "personal", "clientes",
  "carteraBruta", "cobCar",
  "mora", "moraVc", "atrasada", "car",
  "rendimiento", "costoFondeo", "provisiones",
  "eficiencia", "gastosPersonal", "gastosGenerales",
  "utilidad", "roe", "roa",
  "ingresos", "gastos", "margenBruto", "margenNeto",
]);

const PE_FIELD_BY_METRIC: Record<string, "pct_rendimiento" | "pct_costo_fondeo" | "pct_provisiones" | "pct_gastos_op" | "pct_gastos_personal" | "pct_gastos_generales"> = {
  rendimiento: "pct_rendimiento",
  costoFondeo: "pct_costo_fondeo",
  provisiones: "pct_provisiones",
  eficiencia: "pct_gastos_op",
  gastosPersonal: "pct_gastos_personal",
  gastosGenerales: "pct_gastos_generales",
};

/** TTL del cache — 10 min. Data del informe cambia mensualmente, 10 min es super conservador. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Core: dado los params resueltos, devuelve las series historicas para
 * la metrica pedida. Es el codigo pesado — todo lo que sigue es dispatch
 * a la query correcta. Se llama SOLO en cache miss.
 */
async function computeHistoricoSeries(
  metric: MetricKey,
  periodo: number,
  entidades: string[],
  consolidar: boolean,
  competidores: Competidor[],
): Promise<HistoricoEntidadSerie[]> {
  if (metric === "oficinas" || metric === "personal" || metric === "clientes") {
    const map = await getHistoricoEntidad({
      entidades, periodoActual: periodo, metric, consolidar, ultimosN: 5,
    });
    return buildHistoricoSeries(map, competidores);
  }

  if (metric === "carteraBruta") {
    // Usar la fuente del BALANCE (EEFF) para que matchee con el Cuadro
    // Resumen. v_colocaciones_total_por_entidad usa raw.colocaciones que
    // duplica valores por moneda (MN + ME + TOTAL = 2 * TOTAL). El view
    // v_cartera_balance_historica viene de EEFF filtrado por moneda=TOTAL,
    // misma fuente que la cartera bruta del Cuadro Resumen.
    const map = await getHistoricoFromMartView({
      view: "marts.v_cartera_balance_historica",
      field: "cartera_bruta / 1000",
      entidades, periodoActual: periodo,
    });
    return buildHistoricoFromValueMap(map, competidores);
  }

  if (metric === "cobCar") {
    const map = await getHistoricoFromMartView({
      view: "marts.v_cobertura_car_historica",
      field: "pct_cobertura_car",
      entidades, periodoActual: periodo,
    });
    return buildHistoricoFromValueMap(map, competidores);
  }

  if (metric === "mora" || metric === "moraVc" || metric === "atrasada" || metric === "car") {
    const all = await getHistoricoMoraConsolidado({
      entidades, periodoActual: periodo,
    });
    const map = all[metric];
    return buildHistoricoFromValueMap(map, competidores);
  }

  if (PE_FIELD_BY_METRIC[metric]) {
    const peMap = await getHistoricoPuntoEquilibrio({
      entidades, periodoActual: periodo, consolidar,
    });
    return buildHistoricoFromPE(peMap, competidores, PE_FIELD_BY_METRIC[metric]!);
  }

  // KPIs anuales TTM
  const kMap = await getHistoricoKpisAnuales({
    entidades, periodoActual: periodo, consolidar,
  });
  let computeFn: (k: {
    utilidad_ttm: number | null;
    patrimonio_prom_12m: number | null;
    activos_prom_12m: number | null;
    cta_1_ttm: number | null;
    cta_2_ttm: number | null;
    cta_6_ttm: number | null;
    cta_7_ttm: number | null;
  }) => number | null;
  switch (metric) {
    case "utilidad":
      computeFn = (k) => (k.utilidad_ttm == null ? null : k.utilidad_ttm / 1000);
      break;
    case "roe":
      computeFn = (k) =>
        k.utilidad_ttm == null || !k.patrimonio_prom_12m
          ? null
          : k.utilidad_ttm / k.patrimonio_prom_12m;
      break;
    case "roa":
      computeFn = (k) =>
        k.utilidad_ttm == null || !k.activos_prom_12m
          ? null
          : k.utilidad_ttm / k.activos_prom_12m;
      break;
    case "ingresos":
      computeFn = (k) => (k.cta_1_ttm == null ? null : k.cta_1_ttm / 1000);
      break;
    case "gastos":
      computeFn = (k) => (k.cta_2_ttm == null ? null : k.cta_2_ttm / 1000);
      break;
    case "margenBruto":
      computeFn = (k) =>
        k.cta_1_ttm == null || k.cta_2_ttm == null
          ? null
          : (k.cta_1_ttm - k.cta_2_ttm) / 1000;
      break;
    case "margenNeto":
      computeFn = (k) => {
        if (k.cta_1_ttm == null || k.cta_2_ttm == null) return null;
        const bruto = k.cta_1_ttm - k.cta_2_ttm;
        const inof = (k.cta_6_ttm ?? 0) - (k.cta_7_ttm ?? 0);
        return (bruto + inof) / 1000;
      };
      break;
    default:
      throw new ValidationError(`Metric sin compute: ${metric}`, {});
  }
  const series = buildHistoricoFromKpis(kMap, competidores, computeFn);
  void periodoLabel;
  return series;
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});

    const url = new URL(req.url);
    const metricParam = url.searchParams.get("metric");
    const periodoStr = url.searchParams.get("periodo");
    const peerGroupCsv = url.searchParams.get("peerGroup");
    const consolidar = url.searchParams.get("consolidar") !== "false";

    if (!metricParam || !VALID_METRICS.has(metricParam as MetricKey)) {
      throw new ValidationError(`Metric invalida: ${metricParam}`, {
        validas: Array.from(VALID_METRICS),
      });
    }
    const metric = metricParam as MetricKey;

    let periodo: number;
    if (periodoStr) {
      periodo = Number.parseInt(periodoStr, 10);
    } else {
      periodo = (await getUltimoPeriodoPublicable()) ?? 202004;
    }

    let entidades: string[];
    if (peerGroupCsv) {
      entidades = peerGroupCsv.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      entidades = await getTop2PorGrupoByCartera(periodo);
    }
    if (entidades.length === 0) {
      throw new ValidationError(
        "No hay entidades en el peer group. Selecciona al menos una via ?peerGroup=...",
        {},
      );
    }

    // Parsear colorOverrides URL param (mismo formato que SSR).
    const colorOverridesRaw = url.searchParams.get("colorOverrides") ?? undefined;
    const colorOverrides = (() => {
      if (!colorOverridesRaw) return new Map<string, string>();
      const m = new Map<string, string>();
      for (const pair of colorOverridesRaw.split(",")) {
        const idx = pair.lastIndexOf(":");
        if (idx <= 0) continue;
        const nomb = pair.slice(0, idx).trim();
        const hex = pair.slice(idx + 1).trim();
        if (!nomb || !/^#[0-9A-Fa-f]{6}$/.test(hex)) continue;
        m.set(nomb, hex);
      }
      return m;
    })();

    // Construir competidores con colores estables (mismo algoritmo que SSR).
    // Prioridad: colorOverrides > pickColorEstable.
    const usados = new Set<string>();
    const competidores: Competidor[] = entidades.map((nombCorreg, i) => {
      const override = colorOverrides.get(nombCorreg);
      const color = override ?? pickColorEstable(nombCorreg, usados);
      usados.add(color);
      return {
        nombCorreg,
        labelCorto: nombCorreg,
        color,
        orden: i,
        esPropio: false,
      };
    });

    // Cache key: NO incluye colorOverrides — los colores del response se
    // aplican client-side igual (ver seriesConOverrides en el accordion).
    // El data pesado (series de valores) NO depende del color.
    const cacheKey = historicoCacheKey({ metric, periodo, peerGroup: entidades, consolidar });

    const series = await historicoCache.getOrCompute(cacheKey, CACHE_TTL_MS, () =>
      computeHistoricoSeries(metric, periodo, entidades, consolidar, competidores),
    );

    // HTTP cache: el browser cachea 60s + puede mostrar stale hasta 5min
    // mientras revalida en background. Para clicks repetidos del usuario
    // en el mismo accordion, respuesta desde disco del browser (~0ms).
    // 'private' porque puede depender del user (session context futura).
    return NextResponse.json(
      { data: { series }, requestId: "cached" },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  });
}
