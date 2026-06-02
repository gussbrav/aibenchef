/**
 * GET /api/v1/informe/historico?metric=<key>&periodo=<int>&peerGroup=<csv>&consolidar=true|false
 *
 * Devuelve { series: HistoricoEntidadSerie[] } para la metrica solicitada —
 * usado por el accordion lazy-load del Benchmark. El SSR de /dashboard/informe
 * NO trae estas series; cada seccion fetcha bajo demanda cuando se expande.
 */

import type { NextRequest } from "next/server";
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
  listPeriodosDisponibles,
  periodoLabel,
  pickColorEstable,
} from "@/lib/domains/informe/queries";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";
import type { Competidor } from "@/lib/domains/informe/types";

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
      const periodos = await listPeriodosDisponibles({ ultimosN: 1 });
      periodo = periodos[0] ?? 202004;
    }

    let entidades: string[];
    if (peerGroupCsv) {
      entidades = peerGroupCsv.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      entidades = await getTop2PorGrupoByCartera(periodo);
    }
    if (entidades.length === 0) {
      return { series: [] };
    }

    // Construir competidores con colores estables (mismo algoritmo que SSR).
    const usados = new Set<string>();
    const competidores: Competidor[] = entidades.map((nombCorreg, i) => {
      const color = pickColorEstable(nombCorreg, usados);
      usados.add(color);
      return {
        nombCorreg,
        labelCorto: nombCorreg,
        color,
        orden: i,
        esPropio: false,
      };
    });

    // Dispatch a la query/builder segun metric.
    if (metric === "oficinas" || metric === "personal" || metric === "clientes") {
      const map = await getHistoricoEntidad({
        entidades, periodoActual: periodo, metric, consolidar, ultimosN: 5,
      });
      return { series: buildHistoricoSeries(map, competidores) };
    }

    if (metric === "carteraBruta") {
      const map = await getHistoricoFromMartView({
        view: "marts.v_colocaciones_total_por_entidad",
        field: "cartera_total / 1000",
        entidades, periodoActual: periodo,
      });
      return { series: buildHistoricoFromValueMap(map, competidores) };
    }

    if (metric === "cobCar") {
      const map = await getHistoricoFromMartView({
        view: "marts.v_cobertura_car_historica",
        field: "pct_cobertura_car",
        entidades, periodoActual: periodo,
      });
      return { series: buildHistoricoFromValueMap(map, competidores) };
    }

    if (metric === "mora" || metric === "moraVc" || metric === "atrasada" || metric === "car") {
      const all = await getHistoricoMoraConsolidado({
        entidades, periodoActual: periodo,
      });
      const map = all[metric];
      return { series: buildHistoricoFromValueMap(map, competidores) };
    }

    if (PE_FIELD_BY_METRIC[metric]) {
      const peMap = await getHistoricoPuntoEquilibrio({
        entidades, periodoActual: periodo, consolidar,
      });
      const series = buildHistoricoFromPE(peMap, competidores, PE_FIELD_BY_METRIC[metric]!);
      return { series };
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
    return { series };
  });
}
