/**
 * Visor del contenido crudo de un archivo .xls SBS — vista universal del grid.
 *
 * Lee raw.archivo_contenido (poblado por scripts/dump_archivo_contenido.py)
 * y renderiza cada hoja del .xls como tabla densa. Permite al operador
 * comparar visualmente "qué dice el archivo" vs lo procesado en raw.<topico>.
 */

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/infrastructure/db";
import { sql } from "drizzle-orm";
import { getArchivoContenido } from "@/lib/domains/pipeline/inspector-topicos";

export const dynamic = "force-dynamic";

type Params = Promise<{ topico: string; archivoId: string }>;

export default async function ArchivoContenidoPage({ params }: { params: Params }) {
  const { topico, archivoId } = await params;

  const meta = await db.execute<Record<string, unknown>>(sql`
    SELECT id::text, nombre_archivo, periodo, grupo, topico, status,
           source_url, path_local, filas_insertadas
    FROM raw.archivos_descargados
    WHERE id::text = ${archivoId}
  `);
  if (meta.length === 0) notFound();
  const m = meta[0]!;

  const contenido = await getArchivoContenido(archivoId);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div>
        <Link
          href={`/dashboard/admin/inspector-topicos/${topico}?periodo=${m.periodo}` as Route}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← Inspector {topico}
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-2">
          Contenido archivo SBS
        </h1>
        <div className="text-xs text-slate-600 mt-1 font-mono">{m.nombre_archivo as string}</div>
        <div className="flex gap-3 mt-2 text-[11px] text-slate-500">
          <span>Periodo: <span className="font-mono">{m.periodo as number}</span></span>
          <span>Grupo: <span className="font-mono uppercase">{m.grupo as string}</span></span>
          <span>Tópico: <span className="font-mono">{m.topico as string}</span></span>
          <span>Status: <span className="font-semibold">{m.status as string}</span></span>
          {m.filas_insertadas != null && (
            <span>Filas insertadas: <span className="font-mono">{Number(m.filas_insertadas).toLocaleString()}</span></span>
          )}
          {m.source_url ? (
            <a
              href={m.source_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline ml-auto"
            >
              Ver Original SBS ↗
            </a>
          ) : null}
        </div>
      </div>

      {!contenido && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="font-semibold mb-1">⚠ Contenido aún no procesado</p>
          <p>
            Este archivo no tiene celdas dumpeadas en <code>raw.archivo_contenido</code>.
            Correr en el container:
          </p>
          <pre className="mt-2 bg-white border border-amber-200 rounded p-2 overflow-x-auto">
            uv run python scripts/dump_archivo_contenido.py --periodo {String(m.periodo)} --grupo {String(m.grupo)}
          </pre>
        </div>
      )}

      {contenido?.sheets.map((sh) => (
        <section key={sh.idx} className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">
              Hoja [{sh.idx}] <span className="font-mono">"{sh.name}"</span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {sh.nRows} filas × {sh.nCols} columnas
            </div>
          </div>
          <div className="overflow-auto max-h-[600px]">
            <table className="text-[10px] border-collapse w-max">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="bg-slate-200 px-1 py-0.5 border-r border-slate-300 text-slate-500 font-mono w-10 text-center">
                    #
                  </th>
                  {Array.from({ length: sh.nCols }, (_, c) => (
                    <th
                      key={c}
                      className="bg-slate-200 px-2 py-0.5 border-r border-slate-300 text-slate-500 font-mono text-center min-w-[80px]"
                    >
                      {colLabel(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sh.cells.map((row, r) => (
                  <tr key={r} className="border-b border-slate-100">
                    <td className="bg-slate-50 px-1 py-0.5 border-r border-slate-200 text-slate-500 font-mono text-right">
                      {r + 1}
                    </td>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={`px-2 py-0.5 border-r border-slate-100 ${
                          cell == null
                            ? "bg-slate-50/50"
                            : isNum(cell)
                              ? "text-right font-mono text-slate-900"
                              : "text-slate-700"
                        }`}
                      >
                        {cell == null
                          ? ""
                          : cell.length > 60
                            ? cell.slice(0, 60) + "…"
                            : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function colLabel(c: number): string {
  // Excel-style: 0=A, 25=Z, 26=AA, etc.
  let s = "";
  let n = c;
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

function isNum(s: string): boolean {
  return /^-?\d/.test(s.trim());
}
