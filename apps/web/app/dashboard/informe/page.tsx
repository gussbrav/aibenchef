import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import {
  getInformeData,
  getPeriodoCompletenessStatus,
  getUltimoPeriodoPublicable,
  listPeriodosDisponibles,
  listEntidadesDisponibles,
  parseColorsOverride,
} from "@/lib/domains/informe/queries";
import { getServerSession, getUserPlan } from "@/lib/auth-helpers";
import { getUser, isAdmin } from "@/lib/domains/users";
import { PLAN_LIMITS } from "@/lib/plans";
import { InformeClient } from "./informe-client";

// PERF: Cache de queries auxiliares que casi nunca cambian (~1 vez/mes con
// la ingesta SBS). Reduce el TTFB en 200-500ms para toda navegacion
// subsecuente dentro del ventana de 10 min. Se invalida solo al refresh
// forzado o expirar el TTL.
const cachedListPeriodos = unstable_cache(
  () => listPeriodosDisponibles({ ultimosN: 240 }),
  ["informe:periodos-disponibles:240"],
  { revalidate: 600, tags: ["periodos"] },
);

const cachedListEntidades = unstable_cache(
  () => listEntidadesDisponibles({}),
  ["informe:entidades-disponibles"],
  { revalidate: 600, tags: ["entidades"] },
);

// Ultimo periodo publicable — cambia cuando termina la ingesta SBS
// (mensual). Cache 30 min. La ingesta corre 3x/dia y raramente cambia
// el 'ultimo publicable' — usualmente se activa 1-2 dias por mes.
const cachedUltimoPeriodo = unstable_cache(
  () => getUltimoPeriodoPublicable(),
  ["informe:ultimo-periodo-publicable"],
  { revalidate: 1800, tags: ["periodos"] },
);

// Completeness status por periodo — cambia con cada corrida de ingesta
// (3x/dia). Cache 30 min es seguro porque el usuario no espera cambios
// intra-hora. Key incluye periodo para no cache-stampede entre valores.
function cachedCompletenessStatus(periodo: number) {
  return unstable_cache(
    () => getPeriodoCompletenessStatus(periodo),
    ["informe:completeness", String(periodo)],
    { revalidate: 1800, tags: ["periodos", `completeness:${periodo}`] },
  )();
}

// =========================================================================
// CACHE AGRESIVO DEL RESULTADO COMPLETO — patron Vercel/Linear/GitHub.
//
// El bottleneck real es getInformeData (getCuadroResumenRaw + 3× PE + ...
// = ~5s incluso con las optimizaciones). El data cambia solo cuando corre
// la ingesta SBS (~3x/dia) o el peer group override cambia (URL).
//
// Cachear el resultado completo por (clienteSlug, periodo, peerGroup,
// entidadPropia, tema, orden, consolidar) hace que:
//   - Primera visita a una vista: paga los ~5s.
//   - Cualquier visita subsecuente dentro de 30min: <100ms (cache hit).
//   - Distintos usuarios que ven el mismo informe: comparten cache.
//
// El colorsOverride NO va en la key porque afecta solo la paleta visual
// de los competidores — se aplica post-cache mutando data.competidores.
// Asi 1 usuario que cambia colores no invalida el cache del resto.
//
// Tags de invalidacion:
//   - "informe": nuclear reset (usar al refrescar TODAS las MVs)
//   - "informe:${periodo}": invalidar solo un periodo (nueva ingesta)
//   - "informe:${clienteSlug}": invalidar solo un cliente (config edit)
// =========================================================================

type CacheableInformeOpts = {
  clienteSlug: string;
  periodo: number;
  peerGroupOverride?: string[];
  entidadPropiaOverride?: string;
  temaOverride?: string;
  ordenOverride?: string[];
  consolidar: boolean;
  colorsOverride: Map<string, string> | null;
  /** Limite de plan comercial (V167). undefined = admin o sin gating. */
  maxPeers?: number;
  /** V167: ventana historica maxima en meses. undefined = sin cap. */
  maxHistoricoMeses?: number;
};

async function getInformeDataCached(opts: CacheableInformeOpts) {
  // Key estable — colorsOverride va SERIALIZADO en la key porque el color
  // se propaga desde data.competidores a historicoEntidad.color, series de
  // charts, etc. Aplicar el override post-cache dejaria inconsistencia
  // visual. Trade-off: usuario que customiza colores genera entrada de
  // cache propia. Es raro (feature de admin) y las entradas son pequeñas.
  const key = JSON.stringify({
    c: opts.clienteSlug,
    p: opts.periodo,
    pg: opts.peerGroupOverride ?? null,
    e: opts.entidadPropiaOverride ?? null,
    t: opts.temaOverride ?? null,
    o: opts.ordenOverride ?? null,
    cs: opts.consolidar,
    co: opts.colorsOverride ? [...opts.colorsOverride.entries()].sort() : null,
    mp: opts.maxPeers ?? null,
    mh: opts.maxHistoricoMeses ?? null,
  });
  return unstable_cache(
    () => getInformeData(opts),
    ["informe:data", key],
    {
      revalidate: 1800,
      tags: [
        "informe",
        `informe:periodo:${opts.periodo}`,
        `informe:cliente:${opts.clienteSlug}`,
      ],
    },
  )();
}

export const metadata: Metadata = {
  title: "Benchmark Ejecutivo",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  cliente?: string;
  periodo?: string;
  peerGroup?: string;
  entidadPropia?: string;
  tema?: string;
  orden?: string;
  consolidar?: string;
  /**
   * Override de colores por entidad. Formato CSV:
   *   ?colors=Banco%20de%20Cr%C3%A9dito%20del%20Per%C3%BA:0F2A5E,Caja%20Arequipa:FFB300
   * Permite customizar color de cualquier entidad sin tocar config.peer_group.
   */
  colors?: string;
  /** Alias retrocompat de `colors`. */
  colorOverrides?: string;
}>;

// Default sin ningun parametro URL: BCP como cliente + entidad resaltada.
// Forzamos los 3 niveles (slug + entidadPropia + nombreCorto) para que aunque
// config.cliente tenga datos viejos o getClienteBySlug devuelva fallback raro,
// la pagina siempre arranca con BCP cuando no hay parametros.
const BCP_DEFAULT = {
  slug: "bcp",
  entidadPropia: "Banco de Crédito del Perú",
} as const;

export default async function InformeEjecutivoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sinParams = !params.cliente && !params.entidadPropia;

  // Preferencia del usuario: si no vino ?cliente en la URL, intentamos usar
  // su default_cliente_slug guardado en el perfil. Si tampoco tiene, cae
  // al BCP_DEFAULT global. Esto NO restringe — cualquiera puede navegar a
  // otro ?cliente=X (modelo B / abierto), solo mejora el landing por default.
  let userDefaultCliente: string | null = null;
  const session = await getServerSession().catch(() => null);
  if (!params.cliente && session) {
    try {
      const user = await getUser(session.user.id);
      userDefaultCliente = user.defaultClienteSlug;
    } catch {
      // No romper el SSR si falla el lookup de perfil — cae a BCP.
    }
  }

  // Enforcement de plan (V167). Admins bypass total. Los demas usuarios
  // ven su peer group truncado segun PLAN_LIMITS[plan].maxPeers.
  // undefined = sin limite (admin o sin sesion — este ultimo caso raro
  // porque el layout ya redirect a /login).
  let maxPeers: number | undefined;
  let maxHistoricoMeses: number | undefined;
  let planLimited = false;
  let insightsAllowed = true;
  if (session) {
    const admin = await isAdmin(session.user.id).catch(() => false);
    if (!admin) {
      const plan = await getUserPlan(session.user.id);
      const limits = PLAN_LIMITS[plan];
      maxPeers = limits.maxPeers;
      maxHistoricoMeses = limits.maxHistoricoMeses;
      insightsAllowed = limits.insightsAI;
    }
  }

  const clienteSlug = params.cliente ?? userDefaultCliente ?? BCP_DEFAULT.slug;
  // entidadPropia: si viene explicita, respetar. Si no vino cliente ni
  // entidadPropia, forzar BCP (para preservar landing default consistente).
  // Si vino un default de usuario, dejamos que getClienteBySlug resuelva
  // la entidad propia canonica de ese cliente.
  const entidadPropiaOverride = params.entidadPropia
    ?? (sinParams && !userDefaultCliente ? BCP_DEFAULT.entidadPropia : undefined);

  // REGLA DE ORO V139: sin periodo en URL, arrancar en el ultimo mes con
  // EEFF publicado (>=4/5 grupos regulados). Los topicos secundarios
  // (castigos, tasas, geo, indicadores) que SBS publica con mas lag NO
  // bloquean — sus campos quedan en "—" si faltan, pero no privan al
  // usuario de ver los KPIs core del informe. Prioriza time-to-insight.
  let periodo: number;
  if (params.periodo) {
    periodo = Number.parseInt(params.periodo, 10);
  } else {
    periodo = (await cachedUltimoPeriodo()) ?? 202004;
  }

  let peerGroup = params.peerGroup
    ? params.peerGroup.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Si el user pego una URL con mas peers de los que su plan permite,
  // truncamos server-side. Bandera para el banner al cliente.
  if (peerGroup && typeof maxPeers === "number") {
    const propia = params.entidadPropia;
    const otros = propia
      ? peerGroup.filter((n) => n !== propia)
      : peerGroup;
    if (otros.length > maxPeers) {
      planLimited = true;
      peerGroup = propia
        ? [propia, ...otros.slice(0, maxPeers)]
        : otros.slice(0, maxPeers);
    }
  }
  const orden = params.orden
    ? params.orden.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  // consolidar: default true. Solo se desactiva si viene "?consolidar=false".
  const consolidar = params.consolidar !== "false";

  // Colores ad-hoc del usuario: ?colors=Mibanco:0F2A5E,BCP:E91E63
  // Override transitorio en URL — no se persiste en DB.
  // Soportamos `colorOverrides` como alias retrocompat (era el nombre original).
  const colorsOverride = parseColorsOverride(params.colors ?? params.colorOverrides);

  // 4 queries en paralelo — todas cacheadas (getInformeData con revalidate
  // 30min, auxiliares con 10-30min). En cache hit: ~100ms total. Cache miss:
  // paga getInformeData completo (~5s) pero solo el primer request.
  const [data, periodosDisponibles, entidadesDisponibles, completenessStatus] =
    await Promise.all([
      getInformeDataCached({
        clienteSlug,
        periodo,
        peerGroupOverride: peerGroup,
        entidadPropiaOverride,
        temaOverride: params.tema,
        ordenOverride: orden,
        consolidar,
        colorsOverride,
        maxPeers,
        maxHistoricoMeses,
      }),
      cachedListPeriodos(),
      cachedListEntidades(),
      cachedCompletenessStatus(periodo),
    ]);

  // Signal para banner: si el user esta con maxPeers y la vista renderizada
  // esta al tope del cap, mostramos la nota upgrade. Cubre tanto default (5
  // competidores del sistema truncado a maxPeers) como URL con demasiados.
  if (
    typeof maxPeers === "number" &&
    data.competidores.length - 1 >= maxPeers
  ) {
    planLimited = true;
  }

  return (
    <InformeClient
      data={data}
      periodosDisponibles={periodosDisponibles}
      entidadesDisponibles={entidadesDisponibles}
      completenessStatus={completenessStatus}
      planLimited={planLimited}
      planMaxPeers={maxPeers}
      insightsAllowed={insightsAllowed}
    />
  );
}
