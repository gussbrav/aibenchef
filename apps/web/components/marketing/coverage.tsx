import { Container, Section, SectionHeading } from "@/components/ui";

const groups = [
  { name: "Banca Múltiple", count: 17, color: "from-brand-500 to-brand-600" },
  { name: "Empresas Financieras", count: 9, color: "from-emerald-500 to-emerald-600" },
  { name: "Cajas Municipales (CMAC)", count: 12, color: "from-amber-500 to-amber-600" },
  { name: "Cajas Rurales (CRAC)", count: 6, color: "from-rose-500 to-rose-600" },
  { name: "EDPYMEs", count: 9, color: "from-violet-500 to-violet-600" },
];

const topics = [
  "Estados Financieros",
  "Colocaciones",
  "Depósitos",
  "Castigos",
  "Clientes Crédito",
  "Clientes Ahorro",
  "Oficinas y Geografía",
  "Personal",
  "Tasas Activas",
  "Indicadores Regulatorios",
];

export function Coverage() {
  return (
    <Section>
      <Container size="xl">
        <SectionHeading
          eyebrow="Cobertura"
          title="Todo el sistema bancario peruano, un solo lugar"
          description="200+ entidades reguladas por la SBS, 10 tópicos por entidad, histórico mensual desde 2010."
        />
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {groups.map((g) => (
            <div
              key={g.name}
              className="rounded-2xl border border-slate-200 bg-white p-6 hover:border-brand-300 transition-colors"
            >
              <div
                className={`w-12 h-12 rounded-lg bg-gradient-to-br ${g.color} mb-4`}
                aria-hidden
              />
              <p className="text-3xl font-bold text-slate-900">{g.count}</p>
              <p className="text-sm font-medium text-slate-600 mt-1">{g.name}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 max-w-4xl mx-auto">
          <p className="text-center text-sm font-semibold tracking-widest text-slate-500 uppercase mb-6">
            10 tópicos por entidad
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {topics.map((t) => (
              <span
                key={t}
                className="inline-flex items-center px-4 py-2 rounded-full bg-slate-100 text-slate-700 text-sm font-medium border border-slate-200"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
