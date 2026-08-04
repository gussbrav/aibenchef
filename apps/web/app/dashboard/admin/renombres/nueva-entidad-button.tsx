"use client";

/**
 * NuevaEntidadButton — boton + modal para registrar una entidad nueva
 * en la maestra. Cubre el caso comun del pipeline: SBS reporta un
 * nombre nuevo (ej. 'Banco Efectiva') que no esta en dw.entidad_nombre.
 * En vez de escribir SQL, admin usa este formulario.
 */

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type TipoEntidad =
  | "BANCOS"
  | "FINANCIERAS"
  | "CMAC"
  | "CRAC"
  | "EDPYMES"
  | "BANCO_NACION"
  | "OTRO";

type EntidadOpcion = {
  id: number;
  nombreCanonico: string;
  tipoEntidad: TipoEntidad;
  activa: boolean;
};

const TIPOS: Array<{ value: TipoEntidad; label: string }> = [
  { value: "BANCOS", label: "Bancos" },
  { value: "FINANCIERAS", label: "Financieras" },
  { value: "CMAC", label: "Cajas Municipales (CMAC)" },
  { value: "CRAC", label: "Cajas Rurales (CRAC)" },
  { value: "EDPYMES", label: "Edpymes" },
  { value: "BANCO_NACION", label: "Banco de la Nación" },
  { value: "OTRO", label: "Otro" },
];

export function NuevaEntidadButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md shadow-sm transition-colors"
      >
        <Plus className="w-4 h-4" />
        Nueva entidad canónica
      </button>
      {open && <NuevaEntidadModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NuevaEntidadModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [entidades, setEntidades] = useState<EntidadOpcion[] | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  // Form state
  const [nombreCanonico, setNombreCanonico] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [tipoEntidad, setTipoEntidad] = useState<TipoEntidad>("BANCOS");
  const [nombreRawSbs, setNombreRawSbs] = useState("");
  const [esMicro, setEsMicro] = useState(false);
  const [notas, setNotas] = useState("");
  const [reemplazaId, setReemplazaId] = useState<string>(""); // string para el select
  const [reemplazaSearch, setReemplazaSearch] = useState("");
  const [fechaBaja, setFechaBaja] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useMemo(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/admin/maestra/entidades");
        const json = await r.json();
        if (json.data?.rows) setEntidades(json.data.rows as EntidadOpcion[]);
      } catch {
        setEntidades([]);
      } finally {
        setLoadingList(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entidadesFiltradas = useMemo(() => {
    if (!entidades) return [];
    const q = reemplazaSearch.trim().toLowerCase();
    return entidades
      .filter((e) => e.activa)
      .filter((e) => !q || e.nombreCanonico.toLowerCase().includes(q));
  }, [entidades, reemplazaSearch]);

  const puedeGuardar =
    nombreCanonico.trim().length > 0 &&
    (!reemplazaId || fechaBaja.length === 10);

  const guardar = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const r = await fetch("/api/v1/admin/maestra/entidades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombreCanonico: nombreCanonico.trim(),
          razonSocial: razonSocial.trim() || null,
          tipoEntidad,
          nombreRawSbs: nombreRawSbs.trim() || null,
          esMicrofinanciera: esMicro,
          notas: notas.trim() || null,
          reemplazaEntidadId: reemplazaId ? Number(reemplazaId) : null,
          fechaBajaReemplaza: reemplazaId ? fechaBaja : null,
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        setOk(`Entidad "${json.data.nombreCanonico}" registrada (id=${json.data.id}).`);
        // Refrescar la maestra para que aparezca la nueva fila
        setTimeout(() => {
          router.refresh();
          onClose();
        }, 1200);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl rounded-xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-brand-700" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Nueva entidad canónica</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Se registra en la maestra y se mapea el nombre raw del SBS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Info banner */}
          <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg flex items-start gap-2 text-xs text-sky-900">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p>
                Usa este formulario cuando el pipeline reporta una entidad{" "}
                <strong>nueva</strong> que el sistema no reconoce.
              </p>
              <p className="mt-1">
                Si es una <strong>conversión</strong> de otra existente
                (ej. Financiera → Banco), marcá el toggle &quot;Reemplaza a&quot; y elegí
                la vieja — se marca con fecha de baja automáticamente.
              </p>
            </div>
          </div>

          {/* Nombre canónico */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Nombre canónico <span className="text-rose-600">*</span>
            </label>
            <input
              value={nombreCanonico}
              onChange={(e) => setNombreCanonico(e.target.value)}
              placeholder="Ej: Banco Efectiva"
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
              autoFocus
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Como aparecerá en la UI (informe, benchmark, EEFF). Convención: cada palabra con mayúscula inicial.
            </p>
          </div>

          {/* Razón social + Tipo */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Razón social
              </label>
              <input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Ej: BANCO EFECTIVA S.A."
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tipo <span className="text-rose-600">*</span>
              </label>
              <select
                value={tipoEntidad}
                onChange={(e) => setTipoEntidad(e.target.value as TipoEntidad)}
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white transition-colors"
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Nombre RAW SBS */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Nombre como aparece en el archivo SBS
            </label>
            <input
              value={nombreRawSbs}
              onChange={(e) => setNombreRawSbs(e.target.value)}
              placeholder="Ej: BANCO EFECTIVA (todo mayúsculas)"
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Copia el nombre <em>exacto</em> como aparece en la columna &quot;Requieren acción&quot; del Pipeline.
              Así el próximo import lo reconoce automáticamente. Si es idéntico al canónico, dejalo vacío.
            </p>
          </div>

          {/* Micro checkbox */}
          <div className="flex items-center gap-2">
            <input
              id="esMicro"
              type="checkbox"
              checked={esMicro}
              onChange={(e) => setEsMicro(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300"
            />
            <label htmlFor="esMicro" className="text-sm text-slate-700 select-none cursor-pointer">
              Es microfinanciera
            </label>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Notas (opcional)
            </label>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: Nueva licencia SBS Res. N° 1234/2026"
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
            />
          </div>

          {/* Reemplaza a — sección colapsable */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-semibold text-slate-700">
                ¿Reemplaza a otra entidad existente? (opcional)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Marcá esto si esta entidad es una <strong>conversión regulatoria</strong> de una existente
              (ej. Financiera Efectiva → Banco Efectiva). La vieja se marca con fecha de baja y
              su historia queda preservada bajo su tipo original.
            </p>

            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={reemplazaSearch}
                onChange={(e) => setReemplazaSearch(e.target.value)}
                placeholder="Buscar entidad a reemplazar..."
                className="w-full h-9 pl-8 pr-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 outline-none transition-colors"
                disabled={loadingList}
              />
            </div>

            <select
              value={reemplazaId}
              onChange={(e) => setReemplazaId(e.target.value)}
              disabled={loadingList}
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 outline-none bg-white transition-colors"
              size={5}
            >
              <option value="">— Ninguna (es una entidad totalmente nueva) —</option>
              {entidadesFiltradas.slice(0, 30).map((e) => (
                <option key={e.id} value={e.id}>
                  [{e.tipoEntidad}] {e.nombreCanonico}
                </option>
              ))}
            </select>
            {entidadesFiltradas.length > 30 && (
              <p className="text-[10px] text-slate-500 mt-1">
                Mostrando 30 de {entidadesFiltradas.length}. Refiná la búsqueda.
              </p>
            )}

            {reemplazaId && (
              <div className="mt-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Fecha de baja de la entidad reemplazada <span className="text-rose-600">*</span>
                </label>
                <input
                  type="date"
                  value={fechaBaja}
                  onChange={(e) => setFechaBaja(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Último mes con reporte SBS de la entidad reemplazada. Su data histórica hasta esta fecha se preserva.
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded flex items-start gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {ok && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded flex items-start gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{ok} La maestra se actualiza en un momento…</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 flex-shrink-0 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-3 h-9 text-sm text-slate-700 hover:bg-slate-100 rounded transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!puedeGuardar || saving}
            className={cn(
              "px-4 h-9 text-sm font-medium rounded-md inline-flex items-center gap-1.5 transition-colors shadow-sm",
              puedeGuardar && !saving
                ? "bg-brand-600 hover:bg-brand-700 text-white"
                : "bg-slate-300 text-slate-500 cursor-not-allowed",
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {saving ? "Guardando…" : "Registrar entidad"}
          </button>
        </footer>
      </div>
    </div>
  );
}
