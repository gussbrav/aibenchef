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

export type UserPlan = "free" | "academic" | "pro" | "business";

export const USER_PLANS: readonly UserPlan[] = [
  "free",
  "academic",
  "pro",
  "business",
] as const;

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
    // V171 (revisado): 2 peers + 12m — Free debe SENTIR el limite pero dar
    // "aha moment" para conversion. 1 peer no basta para benchmark real
    // (sesgo de N=1); 2 peers muestra "mi entidad vs 2 competidores del
    // mismo grupo". 12m obliga upgrade para series temporales year-over-year.
    maxPeers: 2,
    maxHistoricoMeses: 12,
    publicacionesPorMes: 0,
    insightsAI: false,
    exportPDF: false,
    exportExcel: false,
    colorsPersistidos: false,
    apiAccess: false,
    slaEnterprise: false,
  },
  // V168: plan Academico — tesistas/estudiantes verificados con email
  // institucional peruano (.edu.pe). Sin publicaciones AI (unit economics).
  // Con API + MCP acceso para consumir data desde Claude Desktop / scripts.
  academic: {
    maxPeers: 5,
    maxHistoricoMeses: 60,
    publicacionesPorMes: 0,
    insightsAI: false,
    exportPDF: true,
    exportExcel: true,
    colorsPersistidos: true,
    apiAccess: true,
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
    // Pro tambien tiene API access (para clientes que quieran automatizar
    // sus reportes mensuales). V168.
    apiAccess: true,
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
    // SLA + soporte con firma: bandera reservada al plan Enterprise
    // (custom via /solicitar-acceso). Business estandar tiene soporte
    // prioritario por email pero no SLA firmado.
    slaEnterprise: false,
  },
};

// Metadata visible al usuario
// ============================================================================

export const PLAN_META: Record<UserPlan, {
  label: string;
  labelCorto: string;
  precioMensualUsd: number;
  descripcion: string;
  color: "slate" | "brand" | "emerald" | "sky";
}> = {
  free: {
    label: "Free",
    labelCorto: "Free",
    precioMensualUsd: 0,
    descripcion: "Para explorar la plataforma con limites suaves. Siempre gratis.",
    color: "slate",
  },
  academic: {
    label: "Académico",
    labelCorto: "Académico",
    precioMensualUsd: 9,
    descripcion: "Para tesistas y estudiantes con email institucional peruano (.edu.pe).",
    color: "sky",
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

/**
 * V168: helper para detectar email institucional peruano (.edu.pe).
 * Usado en el flujo de signup para pre-mostrar el chip "Plan Académico
 * detectado". La logica DEFINITIVA de asignar plan academic vive en el
 * trigger de la DB (auth.detect_academic_email); esto es solo UX.
 */
export function isEmailAcademicoPeruano(email: string | null | undefined): boolean {
  if (!email) return false;
  return /\.edu\.pe$/i.test(email.trim());
}

// Helpers
// ============================================================================

/** Devuelve los limites del plan indicado. Fallback: free. */
export function limitsForPlan(plan: UserPlan | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan ?? "free"];
}

/**
 * Calcula el periodo YYYYMM mas antiguo permitido dado un hasta-periodo y
 * una ventana en meses. Ejemplo: (202606, 24) → 202407.
 *
 * IMPORTANTE: usa aritmetica de meses reales, NO restar sobre YYYYMM
 * (esto ultimo da valores basura porque no hay 13 meses en un anio).
 */
export function earliestPeriodoForWindow(
  hastaPeriodo: number,
  windowMonths: number,
): number {
  const anio = Math.floor(hastaPeriodo / 100);
  const mes = hastaPeriodo % 100;
  // Convertir a "meses totales desde el año 0" (mes 0 = Ene).
  const totalMesHasta = anio * 12 + (mes - 1);
  const totalMesEarly = totalMesHasta - windowMonths + 1;
  const earlyAnio = Math.floor(totalMesEarly / 12);
  // Corrige mod negativo si la ventana cae antes del año 0 (edge muy raro).
  const earlyMesIdx = ((totalMesEarly % 12) + 12) % 12;
  return earlyAnio * 100 + (earlyMesIdx + 1);
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
