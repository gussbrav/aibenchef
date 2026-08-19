"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Info, Sparkles } from "lucide-react";
import { Container, Section, SectionHeading, Card, Button } from "@/components/ui";

import { ContratarPlanModal } from "./contratar-plan-modal";

/**
 * Pricing publico — modelo simplificado 2 tiers (2026-08-15):
 *   - Free: pull marketing / lead generation
 *   - Business (A medida): monetizacion via cotizacion consultiva
 *
 * Pro fue removido temporalmente porque:
 *   - El equipo no tiene bandwidth para servir self-serve SaaS Pro
 *     hasta tener product-market fit claro.
 *   - Business "A medida" cubre todos los casos pagados de momento:
 *     cada engagement se cotiza segun necesidades reales.
 *   - Simplifica la decision del comprador (1 opcion clara vs 3 tiers).
 *
 * Cuando se re-active Pro, restaurar el objeto en `plans` (esta guardado
 * como comentario abajo) + re-agregar toggle mensual/anual.
 *
 * Academic (S/29 con .edu.pe verificado) sigue vigente en codigo pero no
 * se anuncia — se aplica manualmente al pagar via cotizacion (V172).
 *
 * Fuente de verdad de limites: lib/plans.ts (PLAN_LIMITS).
 */

type Plan = {
  id: "free" | "pro" | "business";
  name: string;
  descripcion: string;
  precioMensualPen: number;
  precioMensualUsd: number;
  /**
   * Precio "a medida" (custom quote). Cuando true, ignoramos los campos
   * numericos y mostramos "A medida" en la card + skipeamos el ciclo de
   * facturacion en el modal (va directo a "solicitud de cotizacion").
   */
  precioAcordar?: boolean;
  destacado: boolean;
  ctaLabel: string;
  ctaAction: "signup" | "modal" | "contact";
  features: string[];
};

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    descripcion:
      "Empieza con 14 días de acceso a todas las features. Después continúas Free permanente. Sin tarjeta.",
    precioMensualPen: 0,
    precioMensualUsd: 0,
    destacado: false,
    ctaLabel: "Empezar gratis",
    ctaAction: "signup",
    features: [
      "2 competidores + 12 meses de histórico",
      "🎁 14 días con insights AI + PDF + 3 publicaciones AI",
      "Benchmark + Punto de Equilibrio + DuPont siempre gratis",
      "Sin tarjeta ni auto-cargo",
    ],
  },
  // Pro tier removido temporalmente 2026-08-15. Ver header del archivo.
  // Cuando se re-active, restaurar:
  // {
  //   id: "pro", name: "Pro",
  //   descripcion: "Para analistas que arman informes mensuales de verdad.",
  //   precioMensualPen: 149, precioMensualUsd: 39,
  //   destacado: true, ctaLabel: "Contratar Pro", ctaAction: "modal",
  //   features: ["Hasta 10 competidores por informe", "5 años de histórico completo",
  //     "Estados Financieros + Análisis dinámico", "Insights AI en el dashboard",
  //     "Publicaciones con IA (20/mes)", "Exportar a PDF + Excel",
  //     "API pública + MCP para Claude Desktop"],
  // },
  {
    id: "business",
    name: "Business",
    descripcion:
      "Consultoría financiera especializada en el sistema financiero peruano.",
    precioMensualPen: 0,
    precioMensualUsd: 0,
    precioAcordar: true,
    destacado: true,
    ctaLabel: "Solicitar cotización",
    ctaAction: "contact",
    features: [
      "Análisis a medida por analistas financieros senior",
      "Diagnósticos ejecutivos con recomendaciones accionables",
      "Reportes customizados según el nivel de detalle que requieras",
      "Comparativas contra el peer group que definamos con tu equipo",
      "Contenido editorial listo para directorio, prensa o clientes",
      "Sesiones 1:1 de trabajo + capacitación al equipo",
      "Acceso a las herramientas de la plataforma durante el engagement",
      "Integración con tus flujos internos según el proyecto",
      "Factura electrónica peruana",
    ],
  },
];

export function Pricing() {
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);

  return (
    <Section id="planes">
      <Container size="xl">
        <SectionHeading
          eyebrow="Planes"
          title="Empieza gratis. Escala con nosotros cuando lo necesites."
          description="Explora la herramienta sin costo. Cuando tu equipo necesite análisis serio, armamos una propuesta a medida."
        />

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onContratar={() => setModalPlan(plan)}
            />
          ))}
        </div>

        {/* Nota: el sub-card "Tesistas con .edu.pe → S/29/mes" fue removido
            del landing publico. El descuento sigue vigente y se aplica
            manualmente al momento del pago (whitelist V171 + V172).
            Rationale: no ensuciar el pricing con multiples opciones. */}

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
            precioAcordar: modalPlan.precioAcordar,
          }}
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
  onContratar,
}: {
  plan: Plan;
  onContratar: () => void;
}) {
  return (
    <Card
      variant={plan.destacado ? "outlined" : "elevated"}
      className={
        plan.destacado
          ? "flex flex-col p-8 relative border-2 border-brand-500 shadow-lg"
          : "flex flex-col p-8 relative"
      }
    >
      {plan.destacado && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold tracking-wider text-white bg-gradient-to-r from-brand-600 to-brand-500 rounded-full uppercase shadow">
            <Sparkles className="w-3 h-3" />
            Recomendado
          </span>
        </div>
      )}
      <h3 className="text-2xl font-bold text-slate-900">{plan.name}</h3>
      <p className="text-sm text-slate-600 mt-2 min-h-[2.5rem]">
        {plan.descripcion}
      </p>

      <div className="mt-6">
        {plan.precioAcordar ? (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-bold text-slate-900">A medida</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Cotización personalizada según el alcance del engagement.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-bold text-slate-900">Gratis</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 min-h-[1rem]">
              Sin tarjeta de crédito. Siempre gratis.
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
