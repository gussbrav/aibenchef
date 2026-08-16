import type { Metadata } from "next";
import { Calendar, FileText } from "lucide-react";
import { Card, Container, PageHero } from "@/components/ui";
import { getRatios, getRatiosLatest, listEntidades } from "@/lib/domains/analytics";
import type { Moneda, RatioEeff } from "@/lib/domains/analytics";
import { getServerSession, getUserPlan } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import { PlanUpgradePage } from "@/components/plan-upgrade-page";
import { EntidadSelector } from "./entidad-selector";
import { MonedaTabs } from "./moneda-tabs";
import { KpiTrendCard } from "./kpi-trend-card";
import { TrendChart } from "./trend-chart";
import { HistoricTable } from "./historic-table";
import { formatPeriod } from "./_lib/format-period";

export const metadata: Metadata = {
  title: "Estados Financieros",
};

export const dynamic = "force-dynamic";

const VALID_MONEDAS: ReadonlySet<Moneda> = new Set(["MN", "ME", "TOTAL"]);

interface PageProps {
  searchParams: Promise<{ entidad?: string; moneda?: string }>;
}

export default async function EeffDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Gate V167: Estados Financieros historicos completos son Pro+.
  const session = await getServerSession().catch(() => null);
  if (session) {
    const admin = await isAdmin(session.user.id).catch(() => false);
    if (!admin) {
      const plan = await getUserPlan(session.user.id);
      if (plan === "free") {
        return (
          <PlanUpgradePage
            feature="Estados Financieros"
            titulo="Estados Financieros históricos"
            descripcion="Balance General y Estado de Resultados de cualquier entidad regulada del sistema financiero, con evolución mes a mes y comparativas contra pares."
            bullets={[
              "Balance General y ER mensual por entidad y moneda",
              "ER anualizado con tendencia de últimos 12 meses móviles",
              "Cambio automático MN / ME / Total",
              "5 años de histórico completo en Pro",
              "Base para reportes ejecutivos y análisis vertical/horizontal",
            ]}
            planRequerido="Pro"
          />
        );
      }
    }
  }

  const monedaParam = params.moneda as Moneda | undefined;
  const moneda: Moneda = monedaParam && VALID_MONEDAS.has(monedaParam) ? monedaParam : "TOTAL";

  const entidades = await listEntidades();

  // Si no hay entidad seleccionada, default = entidad mas grande por activo
  // del ultimo cierre. Mejor UX que mostrar vacio.
  let entidadSeleccionada = params.entidad?.trim();
  if (!entidadSeleccionada) {
    const latest = await getRatiosLatest({ moneda });
    entidadSeleccionada = pickDefaultEntidad(latest) ?? entidades[0]?.nombCorreg;
  }

  if (!entidadSeleccionada) {
    return (
      <Container size="xl" className="px-0">
        <EmptyState />
      </Container>
    );
  }

  const historia = await getRatios({ entidad: entidadSeleccionada, moneda });
  const ultimoIndex = historia.length - 1;
  const actual = historia[ultimoIndex];
  const haceUnAnio = ultimoIndex >= 12 ? historia[ultimoIndex - 12] : undefined;

  return (
    <Container size="xl" className="space-y-8 px-0">
      <PageHero
        icon={FileText}
        iconBg="from-sky-500 to-indigo-600"
        title="Estados Financieros mensuales"
        tagline="Balance General + Estado de Resultados de cualquier entidad regulada del sistema financiero peruano, con histórico completo desde 2009 y ratios calculados al instante"
        description="Cambia de entidad o moneda y ves todo recalculado — ROA, ROE, mora, eficiencia, evolución mensual y anual. Lo que antes tardaba días bajando archivos sueltos y haciendo cálculos manuales."
        stats={
          actual
            ? [
                { label: "Entidad", value: entidadSeleccionada },
                { label: "Último cierre", value: formatPeriod(actual.periodo), hint: actual.fechaCierre ?? undefined },
                { label: "Histórico desde", value: formatPeriod(historia[0]?.periodo) },
              ]
            : undefined
        }
      />

      <header className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-center">
          <EntidadSelector
            entidades={entidades}
            valor={entidadSeleccionada}
          />
          <MonedaTabs valor={moneda} />
        </div>
      </header>

      {!actual ? (
        <EmptyState />
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTrendCard
              label="ROA"
              hint="Utilidad neta / Activo"
              current={actual.roa}
              previous={haceUnAnio?.roa ?? null}
              kind="ratio"
              goodIfHigher
            />
            <KpiTrendCard
              label="ROE"
              hint="Utilidad neta / Patrimonio"
              current={actual.roe}
              previous={haceUnAnio?.roe ?? null}
              kind="ratio"
              goodIfHigher
            />
            <KpiTrendCard
              label="Mora"
              hint="Cartera atrasada / Cartera bruta"
              current={actual.ratioMora}
              previous={haceUnAnio?.ratioMora ?? null}
              kind="ratio"
              goodIfHigher={false}
            />
            <KpiTrendCard
              label="Eficiencia"
              hint="Gastos admin / Ingresos"
              current={actual.ratioEficiencia}
              previous={haceUnAnio?.ratioEficiencia ?? null}
              kind="ratio"
              goodIfHigher={false}
            />
          </section>

          <section>
            <Card variant="elevated" className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">
                Evolución de ratios
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Últimos {Math.min(historia.length, 36)} meses · ROA, ROE y Mora en %
              </p>
              <TrendChart data={historia.slice(-36)} />
            </Card>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Histórico mensual
            </h2>
            <HistoricTable rows={historia.slice(-24).reverse()} />
          </section>
        </>
      )}
    </Container>
  );
}

function pickDefaultEntidad(latest: RatioEeff[]): string | undefined {
  const sorted = [...latest].sort(
    (a, b) => (b.totalActivo ?? -Infinity) - (a.totalActivo ?? -Infinity),
  );
  return sorted[0]?.nombCorreg;
}

function EmptyState() {
  return (
    <Card variant="elevated" className="p-10 text-center">
      <p className="text-slate-600">
        No encontramos datos para esa combinación. Probá con otra entidad o cambia la moneda.
      </p>
    </Card>
  );
}
