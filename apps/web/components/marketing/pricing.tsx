"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Info, Sparkles } from "lucide-react";
import { Container, Section, SectionHeading, Card, Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { ContratarPlanModal } from "./contratar-plan-modal";

/**
 * Pricing publico — 3 tiers claros (Free / Pro / Business) + Academic
 * como descuento automatico sobre Pro para emails .edu.pe verificados.
 *
 * Fuente de verdad de limites: lib/plans.ts (PLAN_LIMITS). Este archivo
 * es SOLO copy visible al usuario. Si cambian los limites, actualizar
 * ambos lugares.
 *
 * Toggle mensual/anual: el anual da 2 meses gratis (~17% off). Precios
 * primarios en soles (mercado peruano) + equivalente USD como secondary.
 *
 * Deep-link para "empresa"/"persona natural" desde el modal de contratacion:
 * simplifica el flujo de pago manual pre-Culqi.
 */

type Plan = {
  id: "free" | "pro" | "business";
  name: string;
  descripcion: string;
  precioMensualPen: number;
  precioMensualUsd: number;
  destacado: boolean;
  ctaLabel: string;
  ctaAction: "signup" | "modal" | "contact";
  features: string[];
};

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    descripcion: "Para probar la plataforma y ver el valor real antes de pagar.",
    precioMensualPen: 0,
    precioMensualUsd: 0,
    destacado: false,
    ctaLabel: "Empezar gratis",
    ctaAction: "signup",
    features: [
      "Hasta 2 competidores para comparar",
      "12 meses de histórico",
      "Benchmark básico + Punto de Equilibrio + DuPont",
      "Sin export ni API",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    descripcion: "Para analistas que arman informes mensuales de verdad.",
    precioMensualPen: 149,
    precioMensualUsd: 39,
    destacado: true,
    ctaLabel: "Contratar Pro",
    ctaAction: "modal",
    features: [
      "Hasta 10 competidores por informe",
      "5 años de histórico completo",
      "Estados Financieros + Análisis dinámico",
      "Insights AI en el dashboard",
      "Publicaciones con IA (20/mes)",
      "Exportar a PDF + Excel",
      "API pública + MCP para Claude Desktop",
    ],
  },
  {
    id: "business",
    name: "Business",
    descripcion: "Para consultoras, áreas de riesgo y gerencias.",
    precioMensualPen: 1500,
    precioMensualUsd: 399,
    destacado: false,
    ctaLabel: "Hablemos",
    ctaAction: "contact",
    features: [
      "Todo Pro sin límites",
      "Publicaciones AI ilimitadas",
      "5 usuarios incluidos (adicionales S/200 c/u)",
      "API con rate limit ampliado",
      "Colores del peer group personalizados",
      "Soporte prioritario 24h SLA",
      "Onboarding 1:1 y factura electrónica",
    ],
  },
];

const AHORRO_ANUAL_PCT = 0.17; // 2 meses gratis en anual (12/10 - 1)

const fmtPen = (n: number): string =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);

const fmtUsd = (n: number): string => `$${n.toLocaleString("en-US")}`;

export function Pricing() {
  const [anual, setAnual] = useState(false);
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);

  return (
    <Section id="planes">
      <Container size="xl">
        <SectionHeading
          eyebrow="Planes"
          title="Empieza gratis. Paga cuando lo necesites."
          description="Sin permanencia. Cancelas cuando quieras. Precios en soles con factura electrónica peruana."
        />

        {/* Toggle mensual / anual */}
        <div className="mt-10 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setAnual(false)}
            className={cn(
              "px-4 h-9 text-sm font-medium rounded-full transition-colors",
              !anual
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:text-slate-900",
            )}
            aria-pressed={!anual}
          >
            Mensual
          </button>
          <button
            type="button"
            onClick={() => setAnual(true)}
            className={cn(
              "px-4 h-9 text-sm font-medium rounded-full transition-colors inline-flex items-center gap-1.5",
              anual
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:text-slate-900",
            )}
            aria-pressed={anual}
          >
            Anual
            <span
              className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider",
                anual
                  ? "bg-emerald-500 text-white"
                  : "bg-emerald-100 text-emerald-800",
              )}
            >
              −17% · 2 meses gratis
            </span>
          </button>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              anual={anual}
              onContratar={() => setModalPlan(plan)}
            />
          ))}
        </div>

        {/* Nota: el sub-card "Tesistas con .edu.pe → S/29/mes" fue removido
            del landing publico. El descuento sigue vigente y se aplica
            AUTOMATICAMENTE al signup si el email es de una universidad
            peruana verificada (whitelist V171). Rationale: no ensuciar el
            pricing con multiples opciones, dejar que el tesista descubra
            el descuento en el signup como efecto sorpresa. */}

        {/* Enterprise footer */}
        <p className="text-center text-sm text-slate-500 mt-10 max-w-2xl mx-auto">
          ¿Necesitas white-label, on-premise, SLA con firma, single-tenant o
          integración a medida?{" "}
          <Link
            href={"/solicitar-acceso?plan=enterprise" as never}
            className="text-brand-600 hover:underline font-medium"
          >
            Hablemos del plan Enterprise
          </Link>
          .
        </p>
      </Container>

      {modalPlan && (
        <ContratarPlanModal
          plan={{
            id: modalPlan.id,
            name: modalPlan.name,
            precioMensualPen: modalPlan.precioMensualPen,
            precioMensualUsd: modalPlan.precioMensualUsd,
          }}
          anualDefault={anual}
          onClose={() => setModalPlan(null)}
        />
      )}
    </Section>
  );
}

// ============================================================================
// PlanCard
// ============================================================================

function PlanCard({
  plan,
  anual,
  onContratar,
}: {
  plan: Plan;
  anual: boolean;
  onContratar: () => void;
}) {
  const precioMostrarPen = anual
    ? Math.round(plan.precioMensualPen * (1 - AHORRO_ANUAL_PCT))
    : plan.precioMensualPen;
  const precioMostrarUsd = anual
    ? Math.round(plan.precioMensualUsd * (1 - AHORRO_ANUAL_PCT))
    : plan.precioMensualUsd;
  const cargoAnualPen = Math.round(precioMostrarPen * 12);

  return (
    <Card
      variant={plan.destacado ? "outlined" : "elevated"}
      className={cn(
        "flex flex-col p-8 relative",
        plan.destacado && "border-2 border-brand-500 shadow-lg",
      )}
    >
      {plan.destacado && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold tracking-wider text-white bg-gradient-to-r from-brand-600 to-brand-500 rounded-full uppercase shadow">
            <Sparkles className="w-3 h-3" />
            Más popular
          </span>
        </div>
      )}
      <h3 className="text-2xl font-bold text-slate-900">{plan.name}</h3>
      <p className="text-sm text-slate-600 mt-2 min-h-[2.5rem]">
        {plan.descripcion}
      </p>

      <div className="mt-6">
        {plan.precioMensualPen === 0 ? (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-bold text-slate-900">Gratis</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 min-h-[1rem]">
              Sin tarjeta de crédito. Siempre gratis.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-bold text-slate-900 tabular-nums">
                {fmtPen(precioMostrarPen)}
              </span>
              <span className="text-slate-500">/mes</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              ≈ {fmtUsd(precioMostrarUsd)}/mes ·{" "}
              {anual ? (
                <>
                  {fmtPen(cargoAnualPen)} cobrado anualmente ·{" "}
                  <span className="text-emerald-700 font-semibold">
                    Ahorras {fmtPen(plan.precioMensualPen * 12 - cargoAnualPen)}
                  </span>
                </>
              ) : (
                <>Facturación mensual · factura electrónica</>
              )}
            </p>
          </>
        )}
      </div>

      <ul className="mt-8 space-y-3 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
            <Check className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        {plan.ctaAction === "signup" && (
          <Link href="/signup">
            <Button
              fullWidth
              size="lg"
              variant={plan.destacado ? "primary" : "outline"}
            >
              {plan.ctaLabel}
            </Button>
          </Link>
        )}
        {plan.ctaAction === "modal" && (
          <Button
            fullWidth
            size="lg"
            variant={plan.destacado ? "primary" : "outline"}
            onClick={onContratar}
          >
            {plan.ctaLabel}
          </Button>
        )}
        {plan.ctaAction === "contact" && (
          <Button
            fullWidth
            size="lg"
            variant={plan.destacado ? "primary" : "outline"}
            onClick={onContratar}
          >
            {plan.ctaLabel}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-slate-400 text-center mt-3 inline-flex items-center justify-center gap-1">
        <Info className="w-3 h-3" />
        Sin permanencia · cancelas cuando quieras
      </p>
    </Card>
  );
}
