import type { Metadata } from "next";
import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

export const metadata: Metadata = {
  title: "Diagnostico Informe",
};

export const dynamic = "force-dynamic";

type CheckResult = { ok: boolean; detail: string };

async function tryQuery<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function loadDiag() {
  const oficinasCount = await tryQuery(async () => {
    const r = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM raw.creditos_depositos_oficina`);
    return Number(r[0]?.count ?? 0);
  });

  const oficinasPeriodos = await tryQuery(async () => {
    const r = await db.execute<{ periodo: number; n: number }>(sql`
      SELECT periodo, COUNT(*)::int AS n
      FROM raw.creditos_depositos_oficina
      GROUP BY periodo
      ORDER BY periodo DESC
      LIMIT 12
    `);
    return r.map((x) => ({ periodo: Number(x.periodo), n: Number(x.n) }));
  });

  const oficinasEmpresas = await tryQuery(async () => {
    const r = await db.execute<{ empresa_sbs: string; n: number }>(sql`
      SELECT empresa_sbs, COUNT(*)::int AS n
      FROM raw.creditos_depositos_oficina
      GROUP BY empresa_sbs
      ORDER BY empresa_sbs
      LIMIT 40
    `);
    return r.map((x) => ({ empresa_sbs: String(x.empresa_sbs), n: Number(x.n) }));
  });

  const vistaUltimoPeriodo = await tryQuery(async () => {
    const r = await db.execute<{ nomb_correg: string; n_oficinas: number; periodo: number }>(sql`
      WITH ult AS (SELECT MAX(periodo) AS p FROM marts.v_oficinas_por_entidad)
      SELECT nomb_correg, n_oficinas, periodo
      FROM marts.v_oficinas_por_entidad
      WHERE periodo = (SELECT p FROM ult)
      ORDER BY n_oficinas DESC
      LIMIT 50
    `);
    return r.map((x) => ({
      nomb_correg: String(x.nomb_correg),
      n_oficinas: Number(x.n_oficinas),
      periodo: Number(x.periodo),
    }));
  });

  const migraciones = await tryQuery(async () => {
    const r = await db.execute<{ version: string; applied_at: string }>(sql`
      SELECT version, applied_at::text
      FROM public.schema_migrations
      WHERE version IN ('V043', 'V046', 'V047')
      ORDER BY version
    `);
    return r.map((x) => ({ version: String(x.version), applied_at: String(x.applied_at) }));
  });

  return { oficinasCount, oficinasPeriodos, oficinasEmpresas, vistaUltimoPeriodo, migraciones };
}

export default async function DiagnosticoPage() {
  const d = await loadDiag();

  const StatusPill = ({ check }: { check: CheckResult }) => (
    <span
      className={`inline-block text-[10px] px-2 py-0.5 rounded font-mono ${
        check.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {check.ok ? "OK" : "ERROR"}
    </span>
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto px-2">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Diagnóstico del Informe — Oficinas</h1>
        <p className="text-sm text-slate-600 mt-1">
          Verifica si <code className="bg-slate-100 px-1 rounded">raw.creditos_depositos_oficina</code>{" "}
          tiene data y si <code className="bg-slate-100 px-1 rounded">marts.v_oficinas_por_entidad</code>{" "}
          devuelve los nombres normalizados.
        </p>
      </header>

      {/* Migraciones aplicadas */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">
          Migraciones aplicadas (V043 + V046 + V047)
        </h2>
        {d.migraciones.ok ? (
          d.migraciones.data.length === 0 ? (
            <p className="text-sm text-rose-700">⚠️ Ninguna de V043/V046/V047 aplicada. El rebuild de EasyPanel no terminó.</p>
          ) : (
            <ul className="space-y-1">
              {d.migraciones.data.map((m) => (
                <li key={m.version} className="text-xs font-mono text-slate-700">
                  <strong>{m.version}</strong> — aplicada {m.applied_at}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-rose-700">ERROR: {d.migraciones.error}</p>
        )}
      </section>

      {/* Cantidad de filas en raw */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">
          raw.creditos_depositos_oficina
        </h2>
        {d.oficinasCount.ok ? (
          <p className="text-3xl font-bold text-slate-900">
            {d.oficinasCount.data.toLocaleString("es-PE")}
            <span className="text-xs text-slate-500 ml-2 font-normal">filas totales</span>
          </p>
        ) : (
          <p className="text-sm text-rose-700">ERROR: {d.oficinasCount.error}</p>
        )}
        {d.oficinasCount.ok && d.oficinasCount.data === 0 && (
          <p className="text-xs text-amber-700 mt-2">
            ⚠️ La tabla está vacía. El import del xlsx no llegó a la DB. Re-corre:{" "}
            <code className="bg-slate-100 px-1 rounded">aibenchef import base-oficinas {`"<path.xlsx>"`}</code>
          </p>
        )}
      </section>

      {/* Periodos disponibles */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">
          Períodos cargados (top 12 más recientes)
        </h2>
        {d.oficinasPeriodos.ok ? (
          d.oficinasPeriodos.data.length === 0 ? (
            <p className="text-sm text-slate-500">Sin datos.</p>
          ) : (
            <ul className="space-y-1 text-sm font-mono">
              {d.oficinasPeriodos.data.map((p) => (
                <li key={p.periodo} className="flex items-center gap-3">
                  <span className="font-bold text-slate-900 w-16">{p.periodo}</span>
                  <span className="text-slate-500">{p.n.toLocaleString("es-PE")} filas</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-rose-700">ERROR: {d.oficinasPeriodos.error}</p>
        )}
      </section>

      {/* Vista por entidad — último período */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">
          marts.v_oficinas_por_entidad — último período disponible
        </h2>
        {d.vistaUltimoPeriodo.ok ? (
          d.vistaUltimoPeriodo.data.length === 0 ? (
            <p className="text-sm text-amber-700">
              ⚠️ Vista existe pero devuelve 0 filas. La tabla raw probablemente está vacía.
            </p>
          ) : (
            <div>
              <p className="text-xs text-slate-500 mb-3">
                Período: <strong>{d.vistaUltimoPeriodo.data[0]?.periodo}</strong> · {d.vistaUltimoPeriodo.data.length} entidades
              </p>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2">nomb_correg</th>
                    <th className="text-right py-2">N de oficinas</th>
                  </tr>
                </thead>
                <tbody>
                  {d.vistaUltimoPeriodo.data.map((row) => (
                    <tr key={row.nomb_correg} className="border-b border-slate-100">
                      <td className="py-1.5 font-mono text-slate-900">{row.nomb_correg}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-700">
                        {row.n_oficinas.toLocaleString("es-PE")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div>
            <p className="text-sm text-rose-700">ERROR: {d.vistaUltimoPeriodo.error}</p>
            <p className="text-xs text-amber-700 mt-2">
              Si dice &quot;relation does not exist&quot;, V046/V047 todavía no se aplicaron. Espera 2 min más al rebuild.
            </p>
          </div>
        )}
      </section>

      {/* Empresas en raw — para entender qué nombres llegaron */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">
          empresa_sbs distintas en raw (top 40)
        </h2>
        {d.oficinasEmpresas.ok ? (
          d.oficinasEmpresas.data.length === 0 ? (
            <p className="text-sm text-slate-500">Sin datos.</p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
              {d.oficinasEmpresas.data.map((e) => (
                <li key={e.empresa_sbs} className="flex items-center justify-between border-b border-slate-100 py-1">
                  <span className="text-slate-900 truncate">{e.empresa_sbs}</span>
                  <span className="text-slate-400 tabular-nums">{e.n}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-rose-700">ERROR: {d.oficinasEmpresas.error}</p>
        )}
      </section>
    </div>
  );
}
