/**
 * /dashboard/admin/cabecera-aligner — agregar codigos faltantes en
 * dw.cabecera_maestra que el parser detecto en raw.eeff_observacion.
 *
 * Workflow: selector (tipoEstado, tipoEntidad, periodo) → tabla con missing
 * → checkbox selecciona codigos a agregar → POST align → audit log.
 */

import type { Metadata } from "next";
import { Layers } from "lucide-react";

import {
  listAllPeriodos,
  listCabeceraAuditLog,
  listCabeceraDiff,
} from "@/lib/domains/pipeline";
import type { TipoEstado } from "@/lib/domains/pipeline";

import { CabeceraAlignerClient } from "./aligner-client";

export const metadata: Metadata = {
  title: "Cabecera Aligner",
};

export const dynamic = "force-dynamic";

const TIPOS_ESTADO: TipoEstado[] = ["balance", "resultados"];
const TIPOS_ENTIDAD = ["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"];

interface PageProps {
  searchParams: Promise<{
    tipoEstado?: string;
    tipoEntidad?: string;
    periodo?: string;
  }>;
}

export default async function CabeceraAlignerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodos = await listAllPeriodos();

  const tipoEstado: TipoEstado =
    params.tipoEstado && (TIPOS_ESTADO as string[]).includes(params.tipoEstado)
      ? (params.tipoEstado as TipoEstado)
      : "balance";
  const tipoEntidad =
    params.tipoEntidad && TIPOS_ENTIDAD.includes(params.tipoEntidad)
      ? params.tipoEntidad
      : "BANCOS";
  const periodo =
    params.periodo && periodos.includes(Number(params.periodo))
      ? Number(params.periodo)
      : (periodos[0] ?? 0);

  const [diff, auditLog] = await Promise.all([
    periodo ? listCabeceraDiff(tipoEstado, tipoEntidad, periodo, true) : Promise.resolve([]),
    listCabeceraAuditLog(tipoEstado, tipoEntidad, 50),
  ]);

  return (
    <div className="space-y-6 px-4 lg:px-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Layers className="w-6 h-6 text-slate-600" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Cabecera Aligner
          </h1>
        </div>
        <p className="text-slate-600 text-sm">
          Detecta cuentas que el parser persistió en{" "}
          <code className="font-mono text-xs">raw.eeff_observacion</code>{" "}
          pero que NO están en{" "}
          <code className="font-mono text-xs">dw.cabecera_maestra</code>.
          Agregalas en una sola acción.
        </p>
      </header>

      <CabeceraAlignerClient
        tiposEstado={TIPOS_ESTADO}
        tiposEntidad={TIPOS_ENTIDAD}
        periodos={periodos}
        currentTipoEstado={tipoEstado}
        currentTipoEntidad={tipoEntidad}
        currentPeriodo={periodo}
        diff={diff}
        auditLog={auditLog}
      />
    </div>
  );
}
