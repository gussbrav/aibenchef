/**
 * /dashboard/admin/eeff-inspector — Validar mapeo cuenta-por-cuenta (issue #26).
 *
 * Permite al operador inspeccionar el balance y ER de una entidad+periodo,
 * iterando la cabecera-base de dw.cabecera_maestra y comparando contra
 * raw.eeff_observacion. Detecta:
 *   - faltaEnRaw: cabecera espera la fila pero parser no la persistio
 *   - nombreMismatch: nombre archivo SBS difiere del canonico
 *   - qualityStatus: hay un quality_check abierto sobre la cuenta
 *   - extras: filas en raw que NO estan en la cabecera-base
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileSpreadsheet, Search } from "lucide-react";

import {
  getEeffInspectorData,
  listAllPeriodos,
  listEntidadesPorPeriodo,
} from "@/lib/domains/pipeline";

import { EeffInspectorClient } from "./inspector-client";

export const metadata: Metadata = {
  title: "EEFF Inspector",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    entidad?: string;
    periodo?: string;
  }>;
}

export default async function EeffInspectorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodos = await listAllPeriodos();

  if (periodos.length === 0) {
    return (
      <div className="space-y-6 px-4 lg:px-6">
        <Header />
        <p className="text-slate-500 italic">
          No hay data de EEFF en la base. Corre <code>aibenchef sbs work-jobs</code>{" "}
          para descargar e importar archivos SBS primero.
        </p>
      </div>
    );
  }

  // Default periodo: el más reciente.
  const periodoNum = params.periodo ? Number(params.periodo) : periodos[0];
  if (!Number.isFinite(periodoNum) || !periodos.includes(periodoNum)) {
    redirect(`/dashboard/admin/eeff-inspector?periodo=${periodos[0]}` as never);
  }

  const entidades = await listEntidadesPorPeriodo(periodoNum);
  if (entidades.length === 0) {
    return (
      <div className="space-y-6 px-4 lg:px-6">
        <Header />
        <p className="text-slate-500 italic">
          No hay entidades con data para periodo {periodoNum}.
        </p>
      </div>
    );
  }

  const entidadParam = params.entidad?.trim();
  const entidad =
    entidadParam && entidades.find((e) => e.nombCorreg === entidadParam)
      ? entidadParam
      : entidades[0].nombCorreg;

  const data = await getEeffInspectorData(entidad, periodoNum);

  return (
    <div className="space-y-6 px-4 lg:px-6">
      <Header />
      <EeffInspectorClient
        periodos={periodos}
        entidades={entidades}
        currentPeriodo={periodoNum}
        currentEntidad={entidad}
        data={data}
      />
    </div>
  );
}

function Header() {
  return (
    <header className="space-y-1">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-6 h-6 text-slate-600" />
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          EEFF Inspector
        </h1>
      </div>
      <p className="text-slate-600 text-sm flex items-center gap-1">
        <Search className="w-4 h-4" />
        Valida cuenta-por-cuenta el balance (BG) y estado de resultados (ER) de
        una entidad+periodo. Driver = <code className="font-mono text-xs">dw.cabecera_maestra</code> (la verdad-base).
      </p>
    </header>
  );
}
