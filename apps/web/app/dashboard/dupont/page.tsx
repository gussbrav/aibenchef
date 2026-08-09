import type { Metadata } from "next";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";

import {
  getDefaultPeerGroup,
  getUltimoPeriodoPublicable,
  listEntidadesDisponibles,
  listPeriodosDisponibles,
  parseColorsOverride,
} from "@/lib/domains/informe/queries";
import { getAnalisisDupont, type DupontOpts } from "@/lib/domains/dupont";
import { db } from "@/lib/infrastructure/db";
import { DupontClient } from "./dupont-client";

export const metadata: Metadata = {
  title: "Análisis DuPont",
  description:
    "Descomposicion jerarquica del ROE en componentes DuPont: ROA × Apalancamiento con drill-down por margenes y gastos.",
};

export const dynamic = "force-dynamic";

// Cookie key donde el cliente persiste los filtros aplicados. La cookie
// viaja al server automaticamente → server renderiza con los filtros
// correctos DESDE EL PRIMER FRAME (sin flash SSR→hydration).
const COOKIE_KEY_DUPONT_FILTERS = "dupont_filters_v1";

type DupontFiltersSnapshot = {
  entidades?: string[];
  periodos?: number[];
  colors?: Array<[string, string]>;
};

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

// PERF: normalizar labels de entidades a sus canonicos ACTUALES + dedupear.
// Fix del bug donde "Financiera Compartamos" y "Compartamos Banco" (post
// V152 merge) daban 2 chips con la misma data. Ahora ambos resuelven al
// mismo canonico y solo 1 chip aparece en el chart.
//
// Cacheado 30min con tag 'entidades' — invalidado cuando cambia la maestra.
const cachedNormalizarCanonicos = unstable_cache(
  async (labels: string[]): Promise<string[]> => {
    if (labels.length === 0) return [];
    const rows = await db.execute<{ input_label: string; canonico: string | null }>(sql`
      SELECT DISTINCT ON (canonico)
             label AS input_label,
             dw.resolver_nomb_correg_canonico(label) AS canonico
      FROM unnest(${labels}::text[]) WITH ORDINALITY AS t(label, ord)
      ORDER BY canonico, ord
    `);
    // Mantener el orden original de labels — deduplicar preservando
    // primer aparicion.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const label of labels) {
      const row = rows.find((r) => r.input_label === label);
      const canon = row?.canonico ?? label; // fallback al label si no resuelve
      if (seen.has(canon)) continue;
      seen.add(canon);
      out.push(canon);
    }
    return out;
  },
  ["dupont:normalizar-canonicos"],
  { revalidate: 1800, tags: ["entidades"] },
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

// Default peer group: reusa el mismo que /informe (getDefaultPeerGroup del
// clienteSlug — configurable por cliente en config.peer_group). Fallback
// hardcoded si la config no existe. Asi la vista arranca con exactamente
// las mismas entidades que el Benchmark, garantizando consistencia UX.
const CLIENTE_DEFAULT = "bcp";
const PEER_HARDCODED_FALLBACK = [
  "CMAC Arequipa",
  "CMAC Huancayo",
  "Mibanco",
  "Financiera Compartamos",
];

/**
 * Lee la cookie dupont_filters_v1 (server-side). Si existe y es valida,
 * devuelve el snapshot. Sirve como fuente de defaults cuando el user llega
 * a /dashboard/dupont sin params en URL (ej. desde otro tab del nav).
 */
async function readFiltersCookie(): Promise<DupontFiltersSnapshot | null> {
  try {
    const store = await cookies();
    const raw = store.get(COOKIE_KEY_DUPONT_FILTERS)?.value;
    if (!raw) return null;
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as DupontFiltersSnapshot;
    // Validaciones basicas — cookies pueden venir corruptas
    if (parsed.entidades && !Array.isArray(parsed.entidades)) return null;
    if (parsed.periodos && !Array.isArray(parsed.periodos)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default async function DupontPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // Prioridad de resolucion de filtros (mayor → menor):
  //   1. URL params explicitos (share link, deep link, refresh con filters)
  //   2. Cookie del user (ultimos filtros aplicados — sobrevive nav entre tabs)
  //   3. Default del sistema (getDefaultPeerGroup + ultimoPeriodo)
  //
  // Leer cookie solo si NO hay params — asi el usuario puede compartir un
  // link con filtros custom y sobreescribir su default personal.
  const cookieFilters =
    !params.entidades && !params.periodos ? await readFiltersCookie() : null;

  // Resolver entidades: URL > cookie > default sistema
  let entidadesRaw: string[];
  if (params.entidades) {
    entidadesRaw = params.entidades.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (cookieFilters?.entidades?.length) {
    entidadesRaw = cookieFilters.entidades;
  } else {
    const peerDefault = await getDefaultPeerGroup(CLIENTE_DEFAULT).catch(() => []);
    entidadesRaw = peerDefault.length > 0 ? peerDefault : PEER_HARDCODED_FALLBACK;
  }

  // Normalizar a canonicos actuales + dedupear. Fix del bug donde 2 labels
  // que resuelven al mismo canonico daban 2 chips duplicados.
  const entidadesParam = await cachedNormalizarCanonicos(entidadesRaw);

  // Resolver periodos: URL > cookie > default sistema
  const periodosParam = params.periodos
    ? params.periodos
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 200001)
    : cookieFilters?.periodos && cookieFilters.periodos.length > 0
      ? cookieFilters.periodos
      : null;

  const consolidar = params.consolidar !== "false";

  // Resolver colors: URL > cookie
  let colorsOverride = parseColorsOverride(params.colors);
  if (!colorsOverride && cookieFilters?.colors && cookieFilters.colors.length > 0) {
    const m = new Map<string, string>();
    for (const [n, hex] of cookieFilters.colors) {
      m.set(n, hex.startsWith("#") ? hex : `#${hex}`);
    }
    colorsOverride = m;
  }

  // Resolver defaults de periodos si no vinieron
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
