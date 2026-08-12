/**
 * Seccion comparativa "Alternativas a Aibenchef" — 4 opciones que el
 * cliente evalua antes de decidir. Formato tabla honesta con checks +
 * cruces. Tono neutral y editorial: sin bashing agresivo, solo trade-offs
 * verificables.
 *
 * Columnas: Excel manual · Consultora externa · Terminal financiera · Aibenchef
 * Filas: Costo · Actualizacion · Cobertura · Time-to-insight · Auditabilidad · Trazable
 */

import type { ReactElement } from "react";
import { Check, X, Minus } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui";

type Estado = "yes" | "no" | "partial";

type Fila = {
  atributo: string;
  detalle?: string;
  excel: { estado: Estado; texto: string };
  consultora: { estado: Estado; texto: string };
  terminal: { estado: Estado; texto: string };
  aibenchef: { estado: Estado; texto: string };
};

const filas: Fila[] = [
  {
    atributo: "Costo mensual",
    excel: { estado: "yes", texto: "$0 pero 40h/mes analista" },
    consultora: { estado: "no", texto: "$3,000-8,000 por informe" },
    terminal: { estado: "no", texto: "~$2,000/usuario" },
    aibenchef: { estado: "yes", texto: "Desde $49" },
  },
  {
    atributo: "Cobertura SBS Perú",
    detalle: "50+ entidades activas, todos los grupos regulados",
    excel: { estado: "yes", texto: "Solo lo que descargas" },
    consultora: { estado: "partial", texto: "El scope contratado" },
    terminal: { estado: "no", texto: "Cobertura global, sin foco SBS Perú" },
    aibenchef: { estado: "yes", texto: "50+ entidades activas, 10 tópicos" },
  },
  {
    atributo: "Actualización automática",
    excel: { estado: "no", texto: "Descargas cada mes manual" },
    consultora: { estado: "no", texto: "Encargas cada vez" },
    terminal: { estado: "yes", texto: "Tiempo real" },
    aibenchef: { estado: "yes", texto: "Día siguiente del cierre" },
  },
  {
    atributo: "Time to insight",
    detalle: "Desde tener la data cruda hasta responder al directorio",
    excel: { estado: "no", texto: "3-5 días" },
    consultora: { estado: "no", texto: "2-4 semanas" },
    terminal: { estado: "partial", texto: "1-2 días (sin data SBS local)" },
    aibenchef: { estado: "yes", texto: "5 minutos" },
  },
  {
    atributo: "Auditabilidad",
    detalle: "Cada número enlaza a su fuente oficial",
    excel: { estado: "partial", texto: "Depende del analista" },
    consultora: { estado: "partial", texto: "Depende del entregable" },
    terminal: { estado: "yes", texto: "Sí" },
    aibenchef: { estado: "yes", texto: "Sí, a nivel celda" },
  },
  {
    atributo: "Comparativos multi-entidad",
    excel: { estado: "partial", texto: "Manual con tablas dinámicas" },
    consultora: { estado: "yes", texto: "Sí (paga por peer)" },
    terminal: { estado: "partial", texto: "Cobertura global" },
    aibenchef: { estado: "yes", texto: "Sí, peer group configurable" },
  },
  {
    atributo: "Publicable en LinkedIn",
    detalle: "Con gráficos + prosa editorial lista",
    excel: { estado: "no", texto: "Copy-paste + Photoshop" },
    consultora: { estado: "no", texto: "Escribe tú" },
    terminal: { estado: "no", texto: "No aplica" },
    aibenchef: { estado: "yes", texto: "Sí, artículos con AI" },
  },
];

const iconByEstado: Record<Estado, ReactElement> = {
  yes: <Check className="w-4 h-4 text-emerald-600" strokeWidth={2.5} />,
  no: <X className="w-4 h-4 text-rose-500" strokeWidth={2.5} />,
  partial: <Minus className="w-4 h-4 text-amber-500" strokeWidth={2.5} />,
};

export function Comparison() {
  return (
    <Section>
      <Container size="xl">
        <SectionHeading
          eyebrow="Alternativas"
          title="Cómo se compara Aibenchef con lo que ya usas"
          description="No decimos que somos los mejores en todo. Somos los mejores en una cosa: benchmarking SBS Perú, ejecutable en minutos."
        />
        <div className="mt-16 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className="text-left px-4 py-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  Atributo
                </th>
                <th className="text-center px-4 py-4 text-sm font-semibold text-slate-700 border-b-2 border-slate-200">
                  Excel manual
                </th>
                <th className="text-center px-4 py-4 text-sm font-semibold text-slate-700 border-b-2 border-slate-200">
                  Consultora
                </th>
                <th className="text-center px-4 py-4 text-sm font-semibold text-slate-700 border-b-2 border-slate-200">
                  Terminal financiera
                </th>
                <th className="text-center px-4 py-4 text-sm font-semibold border-b-2 border-brand-500 bg-brand-50/50 rounded-t-lg">
                  <span className="text-brand-900">Aibenchef</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.atributo} className="border-b border-slate-100">
                  <td className="px-4 py-4 align-top">
                    <p className="text-sm font-medium text-slate-900">{f.atributo}</p>
                    {f.detalle && (
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{f.detalle}</p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      {iconByEstado[f.excel.estado]}
                      <span className="text-[11px] text-slate-600 leading-tight">
                        {f.excel.texto}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      {iconByEstado[f.consultora.estado]}
                      <span className="text-[11px] text-slate-600 leading-tight">
                        {f.consultora.texto}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      {iconByEstado[f.terminal.estado]}
                      <span className="text-[11px] text-slate-600 leading-tight">
                        {f.terminal.texto}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center align-top bg-brand-50/30">
                    <div className="flex flex-col items-center gap-1">
                      {iconByEstado[f.aibenchef.estado]}
                      <span className="text-[11px] text-slate-700 font-medium leading-tight">
                        {f.aibenchef.texto}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-center text-xs text-slate-500 mt-8 max-w-2xl mx-auto italic">
          Los precios de terminales financieras y consultoras son referenciales del mercado peruano.
          Aibenchef no reemplaza al analista — le devuelve las horas.
        </p>
      </Container>
    </Section>
  );
}
