import type { Metadata } from "next";
import { unstable_cache } from "next/cache";

import {
  getUltimoPeriodoPublicable,
  listEntidadesDisponibles,
  listPeriodosDisponibles,
  parseColorsOverride,
} from "@/lib/domains/informe/queries";
import { getAnalisisDupont, type DupontOpts } from "@/lib/domains/dupont";
import { DupontClient } from "./dupont-client";

export const metadata: Metadata = {
  title: "Análisis DuPont",
  description:
    "Descomposicion jerarquica del ROE en componentes DuPont: ROA × Apalancamiento con drill-down por margenes y gastos.",
};

export const dynamic = "force-dynamic";

// Reuse cache wrappers (mismo patron que /informe — playbook cache-aggressive
// documentado en docs/design/informe-performance-v1.md).
const cachedListPeriodos = unstable_cache(
  () => listPeriodosDisponibles({ ultimosN: 240 }),
  ["dupont:periodos-disponibles:240"],
  { revalidate: 600, tags: ["periodos"] },
);

const cachedListEntidades = unstable_cache(
  () => listEntidadesDisponibles({}),
  ["dupont:entidades-disponibles"],
  { revalidate: 600, tags: ["entidades"] },
);

const cachedUltimoPeriodo = unstable_cache(
  () => getUltimoPeriodoPublicable(),
  ["dupont:ultimo-periodo-publicable"],
  { revalidate: 1800, tags: ["periodos"] },
);

// Cache aggressive del resultado completo — clave incluye TODOS los params
// que afectan output (entidades + periodos + colors sorted). Cambios generan
// entrada nueva; se sirven cacheadas por 30min hasta invalidacion por
// refreshMvs (tag "dupont").
async function getDupontCached(opts: {
  entidades: string[];
  periodos: number[];
  consolidar: boolean;
  colorsOverride: Map<string, string> | null;
}) {
  const key = JSON.stringify({
    e: [...opts.entidades].sort(),
    p: [...opts.periodos].sort(),
    c: opts.consolidar,
    co: opts.colorsOverride
      ? [...opts.colorsOverride.entries()].sort()
      : null,
  });
  return unstable_cache(
    () => getAnalisisDupont(opts as DupontOpts),
    ["dupont:data", key],
    {
      revalidate: 1800,
      tags: ["dupont", "informe"],
    },
  )();
}

type SearchParams = Promise<{
  entidades?: string;
  periodos?: string;
  consolidar?: string;
  /** ?colors=CMAC%20Arequipa:0F2A5E,Mibanco:E91E63 (mismo formato /informe) */
  colors?: string;
}>;

// Defaults sensatos: 4 entidades tipicas del sector microfinanciero peruano.
// IMPORTANTE: usar los nombres canonicos EXACTOS que estan en la maestra
// (config.peer_group + dw.entidad_maestra). Nombres incorrectos hacen que
// resolver_nomb_correg_canonico() devuelva NULL y las CTEs de la query
// vengan vacias -> barras faltantes en el chart. Fuente: PEER_GROUP_FALLBACK
// de informe/queries.ts.
const DEFAULT_ENTIDADES = [
  "CMAC Arequipa",
  "CMAC Huancayo",
  "Mibanco",
  "Financiera Compartamos",
];

export default async function DupontPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // Parse params
  const entidadesParam = params.entidades
    ? params.entidades.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ENTIDADES;

  const periodosParam = params.periodos
    ? params.periodos
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 200001)
    : null;

  const consolidar = params.consolidar !== "false";
  const colorsOverride = parseColorsOverride(params.colors);

  // Resolver defaults de periodos si no vinieron en URL
  let periodos: number[];
  if (periodosParam && periodosParam.length > 0) {
    periodos = periodosParam;
  } else {
    const ultimo = (await cachedUltimoPeriodo()) ?? 202412;
    const anio = Math.floor(ultimo / 100);
    // Default: Dic hace 2 años + Dic anterior + ultimo publicable
    periodos = [(anio - 2) * 100 + 12, (anio - 1) * 100 + 12, ultimo];
  }

  // Fetch en paralelo — cachedListPeriodos y cachedListEntidades sirven
  // los selectores; getDupontCached calcula todos los ratios.
  const [data, periodosDisponibles, entidadesDisponibles] = await Promise.all([
    getDupontCached({ entidades: entidadesParam, periodos, consolidar, colorsOverride }),
    cachedListPeriodos(),
    cachedListEntidades(),
  ]);

  return (
    <DupontClient
      data={data}
      periodosDisponibles={periodosDisponibles}
      entidadesDisponibles={entidadesDisponibles}
      consolidar={consolidar}
    />
  );
}
