/**
 * Detalle por tópico — inspector funcional con pivots específicos.
 *
 * Estructura:
 *  1. Resumen últimos 24 periodos (cobertura por periodo)
 *  2. Archivos descargados del periodo seleccionado (con links + status)
 *  3. Resumen por entidad (total agregado de la métrica principal)
 *  4. Detalle de UNA entidad (pivot dim × metricas específico del tópico)
 */

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, AlertCircle, CheckCircle2, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { labelGrupo, ordenGrupo } from "@/lib/domains/shared/grupos";
import {
  TOPICO_REGISTRY,
  getArchivosTopico,
  getDetalleEntidad,
  getResumenPorEntidad,
  getTopicoResumen,
  getVerificacionEntidades,
  getVerificacionTopico,
  type VerificacionArchivo,
} from "@/lib/domains/pipeline/inspector-topicos";

export const dynamic = "force-dynamic";

type Params = Promise<{ topico: string }>;
type Search = Promise<{ periodo?: string; entidad?: string }>;

export default async function InspectorTopicoDetallePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { topico } = await params;
  const sp = await searchParams;
  const info = TOPICO_REGISTRY[topico];
  if (!info) notFound();

  // Todos los periodos disponibles (sin limit). Lista larga pero util para
  // navegar histórico SBS completo (2009 → presente, ~220 periodos).
  const resumen = await getTopicoResumen(topico);
  const periodoActual = sp.periodo ? Number(sp.periodo) : resumen[0]?.periodo ?? 0;

  // Agrupar resumen por año para mostrar tabla colapsable por decada.
  const resumenPorAnio = new Map<number, typeof resumen>();
  for (const r of resumen) {
    const anio = Math.floor(r.periodo / 100);
    if (!resumenPorAnio.has(anio)) resumenPorAnio.set(anio, []);
    resumenPorAnio.get(anio)!.push(r);
  }
  const aniosOrdenados = Array.from(resumenPorAnio.keys()).sort((a, b) => b - a);
  const anioActual = Math.floor(periodoActual / 100);

  const [archivos, resumenEntidades, verifArchivos, verifEntidades] = await Promise.all([
    getArchivosTopico(topico, periodoActual),
    getResumenPorEntidad(topico, periodoActual),
    getVerificacionTopico(topico, periodoActual),
    getVerificacionEntidades(topico, periodoActual),
  ]);
  // Ordenar verifArchivos por grupo oficial (Bancos, Financieras, ...)
  verifArchivos.sort((a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo));
  // Solo entidades del peer-group oficial (5 grupos)
  const verifEntidadesOrdenadas = [...verifEntidades].sort((a, b) => {
    const og = ordenGrupo(a.tipoEntidad) - ordenGrupo(b.tipoEntidad);
    if (og !== 0) return og;
    return a.entidad.localeCompare(b.entidad);
  });

  const entidadActual =
    sp.entidad ?? resumenEntidades[0]?.entidad ?? "";
  const detalle = entidadActual
    ? await getDetalleEntidad(topico, periodoActual, entidadActual)
    : { dimColumns: [], metricColumns: [], rows: [] };

  // Filtrar entidades por tipo (BANCOS, CMAC, etc) para selectores agrupados
  const entidadesPorTipo = new Map<string, typeof resumenEntidades>();
  for (const e of resumenEntidades) {
    const k = e.tipoEntidad ?? "(sin tipo)";
    if (!entidadesPorTipo.has(k)) entidadesPorTipo.set(k, []);
    entidadesPorTipo.get(k)!.push(e);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div>
        <Link href={"/dashboard/admin/inspector-topicos" as Route} className="text-xs text-slate-500 hover:text-slate-700">
          ← Tópicos
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2 capitalize">
          Inspector: {info.topico.replace(/_/g, " ")}
        </h1>
        <p className="text-xs text-slate-500 font-mono">{info.tablaRaw}</p>
      </div>

      {/* 1. Resumen periodos — agrupados por año, colapsables (año seleccionado abierto) */}
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          Cobertura por periodo · {resumen.length} periodos en total ({aniosOrdenados.at(-1)}–{aniosOrdenados[0]})
        </h2>
        <div className="space-y-2">
          {aniosOrdenados.map((anio) => {
            const periodosDelAnio = resumenPorAnio.get(anio)!;
            const isOpen = anio === anioActual;
            const totalArchivos = periodosDelAnio.reduce((s, r) => s + r.archivos, 0);
            const totalProcesados = periodosDelAnio.reduce((s, r) => s + r.procesados, 0);
            const totalErrores = periodosDelAnio.reduce((s, r) => s + r.errores, 0);
            const totalFilasRaw = periodosDelAnio.reduce((s, r) => s + r.filasRaw, 0);
            return (
              <details key={anio} open={isOpen} className="rounded border border-slate-200 bg-white overflow-hidden">
                <summary className="cursor-pointer px-3 py-2 flex items-center justify-between hover:bg-slate-50 text-xs">
                  <span className="font-semibold text-slate-900">
                    {anio} · {periodosDelAnio.length} periodos
                  </span>
                  <span className="text-slate-500 flex gap-3 items-center">
                    <span>Archivos: <span className="font-mono">{totalArchivos}</span></span>
                    <span>Procesados: <span className="font-mono">{totalProcesados}</span></span>
                    {totalErrores > 0 && (
                      <span className="text-red-700 font-semibold">Errores: <span className="font-mono">{totalErrores}</span></span>
                    )}
                    <span>Filas: <span className="font-mono">{totalFilasRaw.toLocaleString()}</span></span>
                  </span>
                </summary>
                <div className="overflow-x-auto border-t border-slate-200">
                  <table className="text-xs w-full">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="text-left p-2">Periodo</th>
                        <th className="text-right p-2">Archivos</th>
                        <th className="text-right p-2">Procesados</th>
                        <th className="text-right p-2">Errores</th>
                        <th className="text-right p-2">Filas raw</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodosDelAnio.map((r) => {
                        const esActual = r.periodo === periodoActual;
                        return (
                          <tr
                            key={r.periodo}
                            className={`border-t ${esActual ? "bg-amber-50 font-semibold" : "hover:bg-slate-50"}`}
                          >
                            <td className="p-2">
                              <Link
                                href={`/dashboard/admin/inspector-topicos/${topico}?periodo=${r.periodo}` as Route}
                                className="text-sky-700 hover:underline font-mono"
                              >
                                {r.periodo}
                              </Link>
                            </td>
                            <td className="p-2 text-right font-mono">{r.archivos}</td>
                            <td className="p-2 text-right font-mono">{r.procesados}</td>
                            <td className={`p-2 text-right font-mono ${r.errores > 0 ? "text-red-700" : ""}`}>
                              {r.errores}
                            </td>
                            <td className="p-2 text-right font-mono">{r.filasRaw.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {/* 2. Archivos del periodo */}
      {archivos.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Archivos SBS — periodo {periodoActual}
          </h2>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="text-xs w-full">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-left p-2">Archivo</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-right p-2">Filas insertadas</th>
                  <th className="text-left p-2">Ver crudo</th>
                  <th className="text-left p-2">SBS</th>
                </tr>
              </thead>
              <tbody>
                {archivos.map((a) => (
                  <tr key={a.id} className="border-t hover:bg-slate-50">
                    <td className="p-2">{labelGrupo(a.grupo)}</td>
                    <td className="p-2 font-mono">{a.nombreArchivo}</td>
                    <td className="p-2">
                      <StatusBadge status={a.status} />
                      {a.errorMensaje && (
                        <div className="text-[10px] text-red-700 mt-0.5">
                          {a.errorMensaje.slice(0, 60)}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {a.filasInsertadas?.toLocaleString() ?? "—"}
                    </td>
                    <td className="p-2">
                      <Link
                        href={`/dashboard/admin/inspector-topicos/${topico}/archivo/${a.id}` as Route}
                        className="text-sky-700 hover:underline text-[11px]"
                      >
                        Grid →
                      </Link>
                    </td>
                    <td className="p-2">
                      {a.sourceUrl && (
                        <a
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline inline-flex items-center gap-0.5"
                        >
                          <ExternalLink className="w-3 h-3" /> Original
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3. Verificacion archivo vs raw */}
      {verifArchivos.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Verificación archivo SBS vs procesado — periodo {periodoActual}
          </h2>
          <p className="text-[11px] text-slate-500 mb-2">
            Compara las filas que el importer reportó insertar (snapshot del
            momento del import) vs las que actualmente están en{" "}
            <code className="text-[10px]">{info.tablaRaw}</code>. Diff &gt; 0 = filas
            perdidas post-import. Diff &lt; 0 = filas agregadas posteriormente
            (re-import / backfill).
          </p>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="text-xs w-full">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-left p-2">Archivo</th>
                  <th className="text-right p-2">Snapshot importer</th>
                  <th className="text-right p-2">Filas actuales raw</th>
                  <th className="text-right p-2">Diff</th>
                  <th className="text-left p-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {verifArchivos.map((v) => (
                  <tr key={v.archivoId} className="border-t hover:bg-slate-50">
                    <td className="p-2">{labelGrupo(v.grupo)}</td>
                    <td className="p-2 font-mono text-[11px]">{v.nombreArchivo}</td>
                    <td className="p-2 text-right font-mono">
                      {v.filasInsertadasSnapshot?.toLocaleString() ?? "—"}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {v.filasActualesRaw.toLocaleString()}
                    </td>
                    <td
                      className={`p-2 text-right font-mono ${
                        v.diff === 0
                          ? "text-slate-400"
                          : v.diff > 0
                            ? "text-red-700 font-semibold"
                            : "text-amber-700 font-semibold"
                      }`}
                    >
                      {v.diff === 0 ? "—" : v.diff > 0 ? `+${v.diff}` : v.diff}
                    </td>
                    <td className="p-2">
                      <VerifBadge estado={v.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. Verificacion entidades esperadas vs presentes */}
      {verifEntidadesOrdenadas.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Entidades esperadas vs presentes — periodo {periodoActual}
          </h2>
          <p className="text-[11px] text-slate-500 mb-2">
            Lista todas las entidades del peer-group oficial SBS. Si una está
            declarada en <code>dw.entidad_maestra</code> pero NO tiene filas
            en raw para el periodo, aparece marcada como faltante.
          </p>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="text-xs w-full">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left p-2">Entidad</th>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-right p-2">Filas raw</th>
                  <th className="text-left p-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {verifEntidadesOrdenadas.map((e) => (
                  <tr
                    key={`${e.tipoEntidad}-${e.entidad}`}
                    className={`border-t ${e.presente ? "hover:bg-slate-50" : "bg-red-50/40 hover:bg-red-50"}`}
                  >
                    <td className="p-2">{e.entidad}</td>
                    <td className="p-2 text-slate-500 text-[11px]">{labelGrupo(e.tipoEntidad)}</td>
                    <td className="p-2 text-right font-mono">
                      {e.presente ? e.filasRaw.toLocaleString() : "—"}
                    </td>
                    <td className="p-2">
                      {e.presente ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> presente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 text-[11px] font-semibold">
                          <AlertCircle className="w-3 h-3" /> faltante
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 5. Resumen por entidad */}
      {resumenEntidades.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Resumen por entidad — periodo {periodoActual}
          </h2>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="text-xs w-full">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left p-2">Entidad</th>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-right p-2">{resumenEntidades[0]?.totalLabel ?? "Total"}</th>
                  <th className="text-left p-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {resumenEntidades.map((e) => {
                  const esActual = e.entidad === entidadActual;
                  return (
                    <tr
                      key={e.entidad}
                      className={`border-t ${esActual ? "bg-blue-50 font-semibold" : "hover:bg-slate-50"}`}
                    >
                      <td className="p-2">{e.entidad}</td>
                      <td className="p-2 text-slate-500 text-[11px]">{labelGrupo(e.tipoEntidad)}</td>
                      <td className="p-2 text-right font-mono">
                        {e.total != null ? e.total.toLocaleString() : "—"}
                      </td>
                      <td className="p-2">
                        <Link
                          href={
                            `/dashboard/admin/inspector-topicos/${topico}?periodo=${periodoActual}&entidad=${encodeURIComponent(e.entidad)}` as Route
                          }
                          className="text-sky-700 hover:underline text-[11px]"
                        >
                          ver →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. Detalle entidad seleccionada */}
      {entidadActual && detalle.rows.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Detalle — <span className="text-slate-900">{entidadActual}</span>{" "}
            ({periodoActual})
          </h2>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="text-xs w-full">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  {detalle.dimColumns.map((d) => (
                    <th key={d} className="text-left p-2 font-semibold">
                      {d}
                    </th>
                  ))}
                  {detalle.metricColumns.map((m) => (
                    <th key={m} className="text-right p-2 font-semibold">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalle.rows.map((r, idx) => (
                  <tr key={idx} className="border-t hover:bg-slate-50">
                    {detalle.dimColumns.map((d) => (
                      <td key={d} className="p-2">
                        {r.dims[d] ?? "—"}
                      </td>
                    ))}
                    {detalle.metricColumns.map((m) => {
                      const v = r.metricas[m];
                      return (
                        <td key={m} className="p-2 text-right font-mono">
                          {v == null ? "—" : v.toLocaleString()}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {entidadActual && detalle.rows.length === 0 && (
        <section className="text-xs text-slate-500 italic">
          {entidadesPorTipo.size === 0
            ? `Sin filas raw para periodo ${periodoActual}.`
            : `${entidadActual} no tiene detalle en este periodo. Probá otra entidad arriba.`}
        </section>
      )}
    </div>
  );
}

function VerifBadge({ estado }: { estado: VerificacionArchivo["estado"] }) {
  const map: Record<
    VerificacionArchivo["estado"],
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    ok: {
      label: "ok",
      cls: "bg-emerald-100 text-emerald-800",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    diff_perdidas: {
      label: "filas perdidas",
      cls: "bg-red-100 text-red-800",
      icon: <AlertCircle className="w-3 h-3" />,
    },
    diff_agregadas: {
      label: "filas agregadas",
      cls: "bg-amber-100 text-amber-800",
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    sin_data: {
      label: "sin data",
      cls: "bg-slate-100 text-slate-600",
      icon: <Clock className="w-3 h-3" />,
    },
    no_procesado: {
      label: "no procesado",
      cls: "bg-slate-100 text-slate-500",
      icon: <Clock className="w-3 h-3" />,
    },
  };
  const v = map[estado];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${v.cls}`}
    >
      {v.icon}
      {v.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    procesado: {
      label: "procesado",
      cls: "bg-emerald-100 text-emerald-800",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    descargado: {
      label: "pendiente",
      cls: "bg-amber-100 text-amber-800",
      icon: <Clock className="w-3 h-3" />,
    },
    procesando: {
      label: "procesando",
      cls: "bg-blue-100 text-blue-800",
      icon: <Clock className="w-3 h-3" />,
    },
    error: {
      label: "error",
      cls: "bg-red-100 text-red-800",
      icon: <AlertCircle className="w-3 h-3" />,
    },
    no_publicado_sbs: {
      label: "no publicado",
      cls: "bg-slate-100 text-slate-600",
      icon: <Clock className="w-3 h-3" />,
    },
    omitido: {
      label: "omitido",
      cls: "bg-slate-100 text-slate-600",
      icon: <Clock className="w-3 h-3" />,
    },
  };
  const v = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${v.cls}`}>
      {v.icon}
      {v.label}
    </span>
  );
}
