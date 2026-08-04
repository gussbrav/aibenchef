/**
 * GET /api/v1/punto-equilibrio
 *
 * Endpoint dinamico para el modulo PE. Soporta 3 modos via ?tipo=:
 *   - historico   -> ?entidad=X&desde=YYYY&hasta=YYYYMM&granularidad=anual|semestral|trimestral|mensual
 *   - comparativo -> ?entidades=csv&periodo=YYYYMM
 *   - series      -> ?entidades=csv&desde=YYYY&hasta=YYYYMM&granularidad=...
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import {
  getPuntoEquilibrioComparativo,
  getPuntoEquilibrioHistorico,
  getPuntoEquilibrioSeries,
  type Granularidad,
} from "@/lib/domains/punto-equilibrio";
import { pickColorEstable } from "@/lib/domains/informe/queries";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const GRANULARIDADES: Granularidad[] = ["anual", "semestral", "trimestral", "mensual"];

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const url = new URL(req.url);
    const tipo = url.searchParams.get("tipo") ?? "historico";

    if (tipo === "historico") {
      const entidad = url.searchParams.get("entidad");
      const desdeStr = url.searchParams.get("desde");
      const hastaStr = url.searchParams.get("hasta");
      const granRaw = (url.searchParams.get("granularidad") ?? "anual") as Granularidad;

      if (!entidad) throw new ValidationError("entidad requerida", {});
      if (!desdeStr || !hastaStr) throw new ValidationError("desde y hasta requeridos", {});
      if (!GRANULARIDADES.includes(granRaw)) {
        throw new ValidationError(`granularidad invalida: ${granRaw}`, { validas: GRANULARIDADES });
      }
      const rows = await getPuntoEquilibrioHistorico({
        entidad,
        desdeAnio: Number.parseInt(desdeStr, 10),
        hastaPeriodo: Number.parseInt(hastaStr, 10),
        granularidad: granRaw,
      });
      return NextResponse.json(
        { data: { rows }, requestId: "cached" },
        { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } },
      );
    }

    if (tipo === "comparativo") {
      const entidadesCsv = url.searchParams.get("entidades");
      const periodoStr = url.searchParams.get("periodo");
      const entidadPropia = url.searchParams.get("entidadPropia") ?? "";
      if (!entidadesCsv || !periodoStr) {
        throw new ValidationError("entidades y periodo requeridos", {});
      }
      const entidadesNames = entidadesCsv.split(",").map((s) => s.trim()).filter(Boolean);
      const usados = new Set<string>();
      const entidades = entidadesNames.map((nombCorreg) => {
        const color = pickColorEstable(nombCorreg, usados);
        usados.add(color);
        return { nombCorreg, color, esPropio: nombCorreg === entidadPropia };
      });
      const rows = await getPuntoEquilibrioComparativo({
        entidades,
        periodo: Number.parseInt(periodoStr, 10),
      });
      return NextResponse.json(
        { data: { rows }, requestId: "cached" },
        { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } },
      );
    }

    if (tipo === "series") {
      const entidadesCsv = url.searchParams.get("entidades");
      const desdeStr = url.searchParams.get("desde");
      const hastaStr = url.searchParams.get("hasta");
      const granRaw = (url.searchParams.get("granularidad") ?? "anual") as Granularidad;
      const entidadPropia = url.searchParams.get("entidadPropia") ?? "";
      if (!entidadesCsv || !desdeStr || !hastaStr) {
        throw new ValidationError("entidades, desde y hasta requeridos", {});
      }
      if (!GRANULARIDADES.includes(granRaw)) {
        throw new ValidationError(`granularidad invalida: ${granRaw}`, { validas: GRANULARIDADES });
      }
      const entidadesNames = entidadesCsv.split(",").map((s) => s.trim()).filter(Boolean);
      const usados = new Set<string>();
      const entidades = entidadesNames.map((nombCorreg) => {
        const color = pickColorEstable(nombCorreg, usados);
        usados.add(color);
        return { nombCorreg, color, esPropio: nombCorreg === entidadPropia };
      });
      const series = await getPuntoEquilibrioSeries({
        entidades,
        desdeAnio: Number.parseInt(desdeStr, 10),
        hastaPeriodo: Number.parseInt(hastaStr, 10),
        granularidad: granRaw,
      });
      return NextResponse.json(
        { data: { series }, requestId: "cached" },
        { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } },
      );
    }

    throw new ValidationError(`tipo invalido: ${tipo}`, { validos: ["historico", "comparativo", "series"] });
  });
}
