/**
 * Plans comerciales de Aibenchef — Free / Pro / Business.
 *
 * Fuente unica de verdad para:
 *   - Limites por plan (cuantos peers, publicaciones, historico, etc.)
 *   - Features flags por plan (PDF export, insights AI, API, etc.)
 *   - Copy visible al usuario (nombres, precios sugeridos)
 *
 * Consumido desde:
 *   - Server: enforcement en API routes via getUserPlan() + PLAN_LIMITS
 *   - Client: mostrar badges + modal upgrade + hints "requiere Pro"
 *
 * Cambios de plan requieren:
 *   1. Actualizar PLAN_LIMITS aca
 *   2. Actualizar copy visible en components/marketing/pricing.tsx
 *   3. Migration si cambia el schema (columnas nuevas en auth.users)
 */

// Types
// ============================================================================

export type UserPlan = "free" | "pro" | "business";

export const USER_PLANS: readonly UserPlan[] = ["free", "pro", "business"] as const;

export type PlanLimits = {
  /** Numero maximo de entidades en el peer group (excluye la entidad propia). */
  maxPeers: number;
  /** Ventana temporal maxima consultable en meses (line charts, historicos). */
  maxHistoricoMeses: number;
  /** Publicaciones con AI permitidas por mes calendario. */
  publicacionesPorMes: number;
  /** Insights AI del dashboard (paneles de analisis del experto). */
  insightsAI: boolean;
  /** Export del informe/dashboard a PDF. */
  exportPDF: boolean;
  /** Export a Excel/CSV. */
  exportExcel: boolean;
  /** Personalizacion de colores de peer group (persistencia). */
  colorsPersistidos: boolean;
  /** API publica REST + JWT. */
  apiAccess: boolean;
  /** SLA + soporte dedicado. */
  slaEnterprise: boolean;
};

// Limites por plan
// ============================================================================

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    maxPeers: 2,
    // 24 meses = ultimos 2 anios. Suficiente para benchmark contra
    // pares recientes; historico profundo va en Pro (5 anios).
    maxHistoricoMeses: 24,
    // 0 = feature deshabilitada. Publicaciones AI son parte del valor Pro
    // (no se ofrecen en Free). El menu se oculta y el endpoint devuelve 402.
    publicacionesPorMes: 0,
    insightsAI: false,
    exportPDF: false,
    exportExcel: false,
    colorsPersistidos: false,
    apiAccess: false,
    slaEnterprise: false,
  },
  pro: {
    maxPeers: 10,
    maxHistoricoMeses: 60,
    publicacionesPorMes: 20,
    insightsAI: true,
    exportPDF: true,
    exportExcel: true,
    colorsPersistidos: true,
    apiAccess: false,
    slaEnterprise: false,
  },
  business: {
    maxPeers: 999,
    maxHistoricoMeses: 999,
    publicacionesPorMes: 999,
    insightsAI: true,
    exportPDF: true,
    exportExcel: true,
    colorsPersistidos: true,
    apiAccess: true,
    slaEnterprise: true,
  },
};

// Metadata visible al usuario
// ============================================================================

export const PLAN_META: Record<UserPlan, {
  label: string;
  labelCorto: string;
  precioMensualUsd: number;
  descripcion: string;
  color: "slate" | "brand" | "emerald";
}> = {
  free: {
    label: "Free",
    labelCorto: "Free",
    precioMensualUsd: 0,
    descripcion: "Para explorar la plataforma con limites suaves. Siempre gratis.",
    color: "slate",
  },
  pro: {
    label: "Pro",
    labelCorto: "Pro",
    precioMensualUsd: 149,
    descripcion: "Para equipos de analisis con cobertura multi-segmento.",
    color: "brand",
  },
  business: {
    label: "Business",
    labelCorto: "Business",
    precioMensualUsd: 399,
    descripcion: "Para gerencias y consultoras que necesitan TODA la data.",
    color: "emerald",
  },
};

// Helpers
// ============================================================================

/** Devuelve los limites del plan indicado. Fallback: free. */
export function limitsForPlan(plan: UserPlan | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan ?? "free"];
}

/**
 * True si el plan tiene acceso a un feature especifico. Ergonomia mejor
 * que llamar limitsForPlan(plan).xxx en cada check.
 */
export function planHasFeature(
  plan: UserPlan | null | undefined,
  feature: keyof PlanLimits,
): boolean {
  const l = limitsForPlan(plan);
  const v = l[feature];
  // features booleanas: return v; limites numericos: v > 0
  return typeof v === "boolean" ? v : v > 0;
}

/**
 * Error para lanzar cuando el user hace algo que su plan no permite.
 * El route handler puede catch y devolver 403 con hint de upgrade.
 */
export class PlanLimitExceededError extends Error {
  constructor(
    public readonly plan: UserPlan,
    public readonly limit: keyof PlanLimits,
    public readonly detalle: string,
  ) {
    super(`Plan ${plan} no permite: ${detalle}`);
    this.name = "PlanLimitExceededError";
  }
}
