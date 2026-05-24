import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { Link2, Link2Off, Info } from "lucide-react";
import { tipoEntidadLabel } from "@/app/dashboard/_lib/format";

export const metadata: Metadata = {
  title: "Maestra de Entidades",
};

export const dynamic = "force-dynamic";

type NombreItem = {
  id: number;
  nombre: string;
  tipo: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  consolidar: boolean;
  fuente: string | null;
};

type EntidadMaestra = {
  id: number;
  nomb_correg_canonico: string;
  razon_social_actual: string | null;
  tipo_entidad_actual: string;
  codigo_sbs: string | null;
  es_microfinanciera: boolean;
  activa: boolean;
  fecha_constitucion: string | null;
  fecha_baja: string | null;
  notas: string | null;
  nombres: NombreItem[];
};

async function loadMaestra(): Promise<EntidadMaestra[]> {
  try {
    const rows = await db.execute<EntidadMaestra>(sql`
      SELECT id, nomb_correg_canonico, razon_social_actual, tipo_entidad_actual,
             codigo_sbs, es_microfinanciera, activa,
             fecha_constitucion::text, fecha_baja::text,
             notas, nombres
      FROM dw.v_entidad_maestra_completa
      WHERE activa
      ORDER BY tipo_entidad_actual, nomb_correg_canonico
    `);
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      es_microfinanciera: Boolean(r.es_microfinanciera),
      activa: Boolean(r.activa),
      nombres: Array.isArray(r.nombres) ? r.nombres : [],
    }));
  } catch (e) {
    console.error("loadMaestra failed", e);
    return [];
  }
}

const badgeTipo: Record<string, string> = {
  canonico: "bg-emerald-100 text-emerald-800 border-emerald-300",
  razon_social: "bg-blue-100 text-blue-800 border-blue-300",
  historico: "bg-amber-100 text-amber-800 border-amber-300",
  alias: "bg-violet-100 text-violet-800 border-violet-300",
  mayusculas: "bg-slate-100 text-slate-700 border-slate-300",
  raw_sbs: "bg-slate-100 text-slate-700 border-slate-300",
  con_anotacion: "bg-rose-50 text-rose-700 border-rose-200",
  rebranding: "bg-pink-100 text-pink-800 border-pink-300",
  typo: "bg-red-100 text-red-800 border-red-300",
};

export default async function MaestraPage() {
  const data = await loadMaestra();
  const porTipo = data.reduce(
    (acc, e) => {
      (acc[e.tipo_entidad_actual] ??= []).push(e);
      return acc;
    },
    {} as Record<string, EntidadMaestra[]>,
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-2">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Maestra de Entidades Financieras</h1>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Fuente única de verdad de todas las entidades reguladas. Cada fila aquí es UNA entidad conceptual
          (independiente del nombre que haya tenido). Los nombres históricos, aliases, razones sociales y
          variantes en mayúsculas son entradas relacionadas que apuntan a la misma fila.
        </p>
      </header>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-600" />
          <div className="space-y-2 leading-relaxed">
            <p>
              <strong>Cómo se resuelve un nombre crudo del SBS:</strong>
            </p>
            <p>
              El SBS publica entidades con nombres en mayúsculas, asteriscos y variantes (ej.{" "}
              <code className="bg-white px-1 rounded">MIBANCO</code>,{" "}
              <code className="bg-white px-1 rounded">BANCO DE CREDITO**</code>). La función{" "}
              <code className="bg-white px-1 rounded">dw.lookup_entidad_canonica(raw, periodo)</code>{" "}
              busca cualquier variante en <code className="bg-white px-1 rounded">dw.entidad_nombre</code> y
              devuelve el <strong>nomb_correg_canonico</strong> de la entidad maestra correspondiente.
            </p>
            <p>
              <strong>Tipos de nombre:</strong>
              {" "}
              <Pill tipo="canonico">canónico</Pill> oficial actual ·
              {" "}
              <Pill tipo="razon_social">razón social</Pill> legal SBS ·
              {" "}
              <Pill tipo="historico">histórico</Pill> nombre anterior ·
              {" "}
              <Pill tipo="alias">alias</Pill> variante común ·
              {" "}
              <Pill tipo="raw_sbs">raw_sbs</Pill> como llega del .xls
            </p>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <Stat label="Entidades" value={data.length} />
        <Stat label="Bancos" value={(porTipo.BANCOS ?? []).length} />
        <Stat label="Financieras" value={(porTipo.FINANCIERAS ?? []).length} />
        <Stat label="Cajas M." value={(porTipo.CMAC ?? []).length} />
        <Stat label="Cajas R." value={(porTipo.CRAC ?? []).length} />
        <Stat label="Edpymes" value={(porTipo.EDPYMES ?? []).length} />
      </section>

      {Object.entries(porTipo)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tipo, entidades]) => (
          <section key={tipo}>
            <h2 className="text-base font-bold text-slate-900 mb-3 inline-block px-3 py-1.5 rounded bg-slate-900 text-white">
              {tipoEntidadLabel(tipo)} ({entidades.length})
            </h2>
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Entidad
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Razón social
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Todos los nombres conocidos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entidades.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-slate-900 text-sm">{e.nomb_correg_canonico}</div>
                        {e.es_microfinanciera && (
                          <div className="text-[10px] text-amber-700 mt-0.5">microfinanciera</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-600">
                        {e.razon_social_actual ?? <span className="text-slate-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {e.nombres.length === 0 ? (
                            <span className="text-xs text-slate-400 italic">Solo el canónico</span>
                          ) : (
                            e.nombres.map((n) => (
                              <span
                                key={n.id}
                                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${
                                  badgeTipo[n.tipo] ?? "bg-slate-100 text-slate-700 border-slate-300"
                                } ${!n.consolidar ? "opacity-60 line-through" : ""}`}
                                title={
                                  `${n.tipo}` +
                                  (n.vigente_desde ? ` · desde ${n.vigente_desde}` : "") +
                                  (n.vigente_hasta ? ` · hasta ${n.vigente_hasta}` : "") +
                                  (n.fuente ? ` · fuente: ${n.fuente}` : "")
                                }
                              >
                                {n.consolidar ? (
                                  <Link2 className="w-2.5 h-2.5" />
                                ) : (
                                  <Link2Off className="w-2.5 h-2.5" />
                                )}
                                <span className="font-mono">{n.nombre}</span>
                                {n.vigente_hasta && (
                                  <span className="text-[9px] opacity-70">hasta {n.vigente_hasta.slice(0, 7)}</span>
                                )}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

      <section className="bg-slate-50 border border-slate-200 rounded-lg p-5 mt-8">
        <h2 className="text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">
          Cómo agregar/modificar nombres (por ahora via SQL)
        </h2>
        <p className="text-xs text-slate-600 mb-3">
          Agregar un alias nuevo (ej. typo común que aparece en algún reporte):
        </p>
        <pre className="bg-slate-900 text-emerald-300 text-xs p-4 rounded overflow-x-auto">
{`-- Encontrar la entidad
SELECT id FROM dw.entidad_maestra WHERE nomb_correg_canonico = 'Mibanco';
-- = 42

-- Agregar variante
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
VALUES (42, 'MI BANCO', 'typo', TRUE, 'manual 2026-05');`}
        </pre>
        <p className="text-xs text-slate-600 mt-4 mb-2">
          Registrar un renombre futuro (ej. una entidad cambia de nombre el mes que viene):
        </p>
        <pre className="bg-slate-900 text-emerald-300 text-xs p-4 rounded overflow-x-auto">
{`-- 1. Actualizar el canonico en la maestra
UPDATE dw.entidad_maestra
SET nomb_correg_canonico = 'Nuevo Nombre', updated_at = now()
WHERE id = 42;

-- 2. Marcar el anterior como histórico con vigencia
UPDATE dw.entidad_nombre
SET tipo = 'historico', vigente_hasta = '2026-08-31'
WHERE entidad_id = 42 AND tipo = 'canonico' AND nombre = 'Nombre Anterior';

-- 3. Agregar el nuevo como canónico vigente
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, vigente_desde, consolidar, fuente)
VALUES (42, 'Nuevo Nombre', 'canonico', '2026-09-01', TRUE, 'SBS Resolución N°...');`}
        </pre>
        <p className="text-xs text-slate-500 mt-3">
          <Link href={"/dashboard/sql" as const} className="text-brand-600 hover:underline">Abrir SQL Workbench →</Link>
          {" "} ·{" "} Próximamente: formulario CRUD desde esta página.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
      <div className="text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function Pill({ tipo, children }: { tipo: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${
        badgeTipo[tipo] ?? "bg-slate-100 text-slate-700 border-slate-300"
      }`}
    >
      {children}
    </span>
  );
}
