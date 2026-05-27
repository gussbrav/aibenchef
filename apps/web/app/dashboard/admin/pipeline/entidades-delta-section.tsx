/**
 * Sección 4 — Entidades nuevas o desaparecidas (marts.v_entidades_delta).
 *
 * Separa visualmente las que requieren acción (en_maestra=false) de las
 * que ya están canonizadas en dw.entidad_nombre.
 */

import Link from "next/link";

import type { EntidadDelta } from "@/lib/domains/pipeline";

export function EntidadesDeltaSection({ entidades }: { entidades: EntidadDelta[] }) {
  if (entidades.length === 0) {
    return (
      <p className="text-sm text-emerald-700">
        ✅ Sin cambios en el catálogo entre los últimos 2 periodos.
      </p>
    );
  }

  const requierenAccion = entidades.filter((e) => !e.enMaestra);
  const canonizados = entidades.filter((e) => e.enMaestra);

  const periodoActual = entidades[0]?.periodoActual;
  const periodoPrevio = entidades[0]?.periodoPrevio;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Comparando <code className="font-mono">{periodoActual}</code> vs{" "}
        <code className="font-mono">{periodoPrevio}</code>
      </p>

      {requierenAccion.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <h3 className="text-sm font-semibold text-amber-900">
            ⚠️ Requieren acción ({requierenAccion.length})
          </h3>
          <ul className="space-y-1">
            {requierenAccion.map((e, idx) => (
              <EntidadItem key={idx} entidad={e} />
            ))}
          </ul>
          <p className="text-[11px] text-amber-800 mt-2 border-t border-amber-200 pt-2">
            👉 Si es un rename real, agregalo a{" "}
            <Link href="/dashboard/admin/renombres" className="underline">
              dw.entidad_nombre
            </Link>
            . Si es una entidad nueva, registrala como canónica.
          </p>
        </div>
      )}

      {canonizados.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">
            ℹ️ Canonizados ({canonizados.length}) — no requieren acción
          </h3>
          <ul className="space-y-1">
            {canonizados.map((e, idx) => (
              <EntidadItem key={idx} entidad={e} muted />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EntidadItem({
  entidad,
  muted = false,
}: {
  entidad: EntidadDelta;
  muted?: boolean;
}) {
  const accionIcon = entidad.accion === "nueva" ? "🆕" : "🚫";
  const accionLabel = entidad.accion === "nueva" ? "nueva" : "desaparecida";
  return (
    <li className={`text-xs ${muted ? "text-slate-600" : "text-slate-900"}`}>
      <span className="mr-1">{accionIcon}</span>
      <span className="font-mono text-[11px]">{entidad.tipoEntidad}</span>
      {" — "}
      <span className="font-semibold">{entidad.nombCorreg}</span>
      <span className="text-slate-500"> ({accionLabel})</span>
    </li>
  );
}
