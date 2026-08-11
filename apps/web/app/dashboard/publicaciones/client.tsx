"use client";

/**
 * PublicacionesClient — generacion de articulos long-form con voz
 * editorial senior para publicar en LinkedIn. Estilo tipo Hermes
 * Holguin / Jesus Ferreyra (referentes internos del prompt engineering
 * — NUNCA mencionar en UI).
 *
 * Vistas:
 *   - "lista" (default): grid de drafts + reviewed + published del user
 *   - "wizard": form para generar un articulo nuevo (tema + cliente +
 *     periodo + peer group + eventos macro opcional)
 *   - "editor": edicion del contenido markdown, hashtags, status
 *
 * Cada estado tiene su boton claro para volver a la lista.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft, Check, ChevronRight, Copy, FileText, Loader2, Plus, RefreshCw, Sparkles, Trash2, X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
// Imports client-safe: types puros (types.ts) + meta sin server-only (meta.ts).
// NO importar desde el barrel "@/lib/domains/publicaciones" — arrastra
// service.ts que tiene "server-only" y rompe el build.
import type {
  Publicacion,
  PublicacionListItem,
  PublicacionStatus,
  PublicacionTema,
} from "@/lib/domains/publicaciones/types";
import { PUBLICACION_TEMAS_META } from "@/lib/domains/publicaciones/meta";
import { EntidadFreshnessBadge } from "@/components/ui";
import { computeMaxUltimoPeriodo } from "@/lib/utils/periodo-freshness";

type EntidadDisponible = {
  nombCorreg: string;
  tipoEntidad?: string;
  ultimoPeriodo?: number;
};

type ClienteActivo = {
  slug: string;
  nombre: string;
  nombreCorto: string;
};

type PeriodoDisponible = {
  codigo: number;
  label: string;
};

type Props = {
  publicaciones: PublicacionListItem[];
  entidadesDisponibles: EntidadDisponible[];
  clientesActivos: ClienteActivo[];
  periodosDisponibles: PeriodoDisponible[];
  defaultClienteSlug: string;
  defaultEntidadPropia: string;
  defaultPeerGroup: string[];
  defaultPeriodo: number;
  userEmail: string;
};

type Vista =
  | { kind: "lista" }
  | { kind: "wizard" }
  | { kind: "editor"; publicacion: Publicacion };

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function formatPeriodo(p: number): string {
  const anio = Math.floor(p / 100);
  const mes = p % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}

const STATUS_META: Record<PublicacionStatus, { label: string; color: string }> = {
  draft:     { label: "Borrador",  color: "bg-slate-100 text-slate-700 border-slate-200" },
  reviewed:  { label: "Revisado",  color: "bg-amber-50 text-amber-800 border-amber-200" },
  published: { label: "Publicado", color: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  archived:  { label: "Archivado", color: "bg-slate-50 text-slate-400 border-slate-200" },
};

export function PublicacionesClient({
  publicaciones: initialList,
  entidadesDisponibles,
  clientesActivos,
  periodosDisponibles,
  defaultClienteSlug,
  defaultEntidadPropia,
  defaultPeerGroup,
  defaultPeriodo,
  userEmail: _userEmail,
}: Props) {
  const [vista, setVista] = useState<Vista>({ kind: "lista" });
  const [lista, setLista] = useState<PublicacionListItem[]>(initialList);

  const refreshLista = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/publicaciones");
      if (!res.ok) return;
      const json = await res.json();
      const items = (json?.data?.publicaciones ?? json?.publicaciones) as PublicacionListItem[] | undefined;
      if (items) setLista(items);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-brand-700" />
            <span className="text-[11px] uppercase tracking-wider font-semibold text-brand-700">
              Thought Leadership · IA
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Publica análisis sectoriales con tu firma
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Artículos long-form con voz de analista senior, construidos a partir
            de tu data de benchmarking SBS. Genera el draft, refina el tono, y
            publica en LinkedIn en un click.
          </p>
        </div>
        {vista.kind === "lista" && (
          <button
            type="button"
            onClick={() => setVista({ kind: "wizard" })}
            className="inline-flex items-center gap-1.5 h-9 px-3 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded"
          >
            <Plus className="w-4 h-4" />
            Nuevo artículo
          </button>
        )}
        {vista.kind !== "lista" && (
          <button
            type="button"
            onClick={() => setVista({ kind: "lista" })}
            className="inline-flex items-center gap-1.5 h-9 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
        )}
      </header>

      {vista.kind === "lista" && (
        <ListaVista
          items={lista}
          onOpen={(pub) => setVista({ kind: "editor", publicacion: pub })}
          onRefresh={refreshLista}
          onNew={() => setVista({ kind: "wizard" })}
        />
      )}

      {vista.kind === "wizard" && (
        <WizardVista
          entidadesDisponibles={entidadesDisponibles}
          clientesActivos={clientesActivos}
          periodosDisponibles={periodosDisponibles}
          defaultClienteSlug={defaultClienteSlug}
          defaultEntidadPropia={defaultEntidadPropia}
          defaultPeerGroup={defaultPeerGroup}
          defaultPeriodo={defaultPeriodo}
          onGenerated={async (pub) => {
            await refreshLista();
            setVista({ kind: "editor", publicacion: pub });
          }}
        />
      )}

      {vista.kind === "editor" && (
        <EditorVista
          publicacion={vista.publicacion}
          onUpdated={async (pub) => {
            await refreshLista();
            setVista({ kind: "editor", publicacion: pub });
          }}
          onArchived={async () => {
            await refreshLista();
            setVista({ kind: "lista" });
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// VISTA 1: Lista
// ============================================================================

function ListaVista({
  items, onOpen, onRefresh, onNew,
}: {
  items: PublicacionListItem[];
  onOpen: (pub: Publicacion) => void;
  onRefresh: () => Promise<void>;
  onNew: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    setLoading(id);
    try {
      const res = await fetch(`/api/v1/publicaciones/${id}`);
      if (!res.ok) {
        alert("No se pudo cargar el articulo");
        return;
      }
      const json = await res.json();
      const pub = (json?.data?.publicacion ?? json?.publicacion) as Publicacion | undefined;
      if (pub) onOpen(pub);
    } finally {
      setLoading(null);
    }
  };

  if (items.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-lg p-12 text-center">
        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-slate-900 mb-1">
          Tu biblioteca está vacía
        </h3>
        <p className="text-sm text-slate-500 mb-5 max-w-md mx-auto">
          Elige un tema, un cierre y el grupo comparable — la IA construye el
          primer draft con la data real de tu benchmarking en segundos.
        </p>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1.5 h-9 px-4 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded"
        >
          <Sparkles className="w-4 h-4" />
          Crear primer artículo
        </button>
      </section>
    );
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">
          Tus artículos ({items.length})
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded"
          title="Refrescar lista"
        >
          <RefreshCw className="w-3 h-3" />
          Refrescar
        </button>
      </header>
      <ul className="divide-y divide-slate-100">
        {items.map((item) => {
          const meta = PUBLICACION_TEMAS_META[item.tema];
          const stMeta = STATUS_META[item.status];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openDetail(item.id)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3"
                disabled={loading === item.id}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", stMeta.color)}>
                      {stMeta.label}
                    </span>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Cierre {formatPeriodo(item.periodo)} · {item.entidadPropia}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 truncate">
                    {item.titulo}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Actualizado {new Date(item.updatedAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
                <div className="flex-shrink-0 flex items-center">
                  {loading === item.id ? (
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ============================================================================
// VISTA 2: Wizard (generar nuevo)
// ============================================================================

function WizardVista({
  entidadesDisponibles, clientesActivos, periodosDisponibles, defaultClienteSlug, defaultEntidadPropia, defaultPeerGroup, defaultPeriodo, onGenerated,
}: {
  entidadesDisponibles: EntidadDisponible[];
  clientesActivos: ClienteActivo[];
  periodosDisponibles: PeriodoDisponible[];
  defaultClienteSlug: string;
  defaultEntidadPropia: string;
  defaultPeerGroup: string[];
  defaultPeriodo: number;
  onGenerated: (pub: Publicacion) => Promise<void>;
}) {
  const [tema, setTema] = useState<PublicacionTema>("benchmarking_sectorial");
  const [clienteSlug, setClienteSlug] = useState(defaultClienteSlug);
  // Prefill con la entidad canonica del cliente (BCP -> "Banco de Credito
  // del Peru"). Cae al primer valor disponible solo si la canonica no esta
  // en la lista (edge case: cambio de nombre reciente).
  const [entidadPropia, setEntidadPropia] = useState<string>(() => {
    const isValid = entidadesDisponibles.some(
      (e) => e.nombCorreg === defaultEntidadPropia,
    );
    return isValid
      ? defaultEntidadPropia
      : (entidadesDisponibles[0]?.nombCorreg ?? "");
  });
  // Peer group prefill = peer default del cliente (viene del backend
  // via getDefaultPeerGroup). Asi el user arranca con un grupo sensato y
  // solo lo edita si quiere personalizar.
  //
  // Fix 2026-08-10: antes era un input de texto libre donde el user podia
  // escribir cualquier cosa (typo -> no matcheaba entidad -> articulo con
  // data vacia). Ahora es una lista tipada validada contra entidades
  // reales via chips + modal picker (patron consistente con /pe y /dupont).
  const [peerGroup, setPeerGroup] = useState<string[]>(defaultPeerGroup);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [periodo, setPeriodo] = useState<number>(defaultPeriodo);
  const [eventosMacro, setEventosMacro] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opciones = useMemo(
    () => entidadesDisponibles.map((e) => e.nombCorreg).sort(),
    [entidadesDisponibles],
  );

  const maxUltimoPeriodo = useMemo(
    () => computeMaxUltimoPeriodo(entidadesDisponibles),
    [entidadesDisponibles],
  );

  const generate = async () => {
    setError(null);
    if (peerGroup.length === 0) {
      setError(
        "Agrega al menos una entidad para comparar. Sin comparación no hay ranking ni análisis competitivo.",
      );
      return;
    }
    if (!entidadPropia) {
      setError("Elige la entidad sobre la que quieres escribir.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/publicaciones/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tema,
          clienteSlug,
          entidadPropia,
          peerGroup,
          periodo,
          eventosMacro: tema === "coyuntura_macro" ? eventosMacro : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.error ?? `HTTP ${res.status}`;
        setError(String(msg));
        return;
      }
      const pub = (json?.data?.publicacion ?? json?.publicacion) as Publicacion | undefined;
      if (!pub) {
        setError("Respuesta vacía del servidor");
        return;
      }
      await onGenerated(pub);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-900 mb-1">Nuevo artículo</h2>
        <p className="text-xs text-slate-500">
          Configura el tema y el alcance del análisis. El draft se genera con
          la data real del cierre — sin inventos ni especulación.
        </p>
      </div>

      {/* Tema — cards clickeables */}
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-2 block">
          Tema del artículo
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(Object.keys(PUBLICACION_TEMAS_META) as PublicacionTema[]).map((t) => {
            const meta = PUBLICACION_TEMAS_META[t];
            const active = tema === t;
            // DuPont / Rentabilidad habilitado 2026-08-11 — usa
            // getAnalisisDupont con el shape que espera el prompt.
            const disabled = false;
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => setTema(t)}
                className={cn(
                  "text-left p-3 rounded-lg border-2 transition-colors",
                  active && !disabled && "border-brand-500 bg-brand-50",
                  !active && !disabled && "border-slate-200 hover:border-slate-300 bg-white",
                  disabled && "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed",
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {meta.label}
                  </h3>
                  {active && !disabled && (
                    <Check className="w-4 h-4 text-brand-700" />
                  )}
                  {disabled && (
                    <span className="text-[9px] font-medium text-slate-400 uppercase">
                      Próximamente
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {meta.descripcion}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cliente (solo si hay 2+ tenants) + Entidad propia + Cierre.
          Cuando hay 1 solo cliente, se auto-selecciona y el campo se
          oculta — el usuario no lo necesita elegir. */}
      <div className={cn(
        "grid grid-cols-1 gap-3",
        clientesActivos.length >= 2 ? "md:grid-cols-3" : "md:grid-cols-2",
      )}>
        {clientesActivos.length >= 2 && (
          <div>
            <label
              className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 flex items-center gap-1"
              title="Tenant comercial que firma la publicación. NO es la entidad SBS a analizar (eso es 'Tu entidad')."
            >
              Cliente
              <span className="normal-case font-normal text-slate-400">(quién firma)</span>
            </label>
            <select
              value={clienteSlug}
              onChange={(e) => setClienteSlug(e.target.value)}
              className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
            >
              {clientesActivos.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nombreCorto}
                </option>
              ))}
            </select>
          </div>
        )}
        {clientesActivos.length === 0 && (
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
              Cliente
            </label>
            <div className="w-full h-9 px-2 flex items-center text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
              ⚠ No hay clientes activos configurados
            </div>
          </div>
        )}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Tu entidad
          </label>
          <select
            value={entidadPropia}
            onChange={(e) => setEntidadPropia(e.target.value)}
            className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
          >
            {opciones.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Cierre
          </label>
          {periodosDisponibles.length === 0 ? (
            <input
              type="number"
              value={periodo}
              min={200901}
              max={210012}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (n >= 200901 && n <= 210012) setPeriodo(n);
              }}
              className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white font-mono"
            />
          ) : (
            <select
              value={periodo}
              onChange={(e) => setPeriodo(Number.parseInt(e.target.value, 10))}
              className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
            >
              {periodosDisponibles.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <p className="text-[10px] text-slate-400 mt-1">
            {periodosDisponibles.length > 0
              ? `${periodosDisponibles.length} periodos disponibles en el catálogo`
              : "Formato AAAAMM · ej. 202606 = Jun 2026"}
          </p>
        </div>
      </div>

      {/* Peer group — chips validados + modal picker (no input libre) */}
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 flex items-center justify-between">
          <span>Con quiénes comparar ({peerGroup.length})</span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="normal-case text-[11px] font-medium text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Editar comparación
          </button>
        </label>
        <div className="w-full min-h-[36px] px-2 py-1.5 rounded-md border border-slate-300 bg-white flex items-center flex-wrap gap-1.5">
          {peerGroup.length === 0 ? (
            <span className="text-xs text-slate-400 italic px-1">
              Sin entidades. Click en &quot;Editar comparación&quot; para elegir.
            </span>
          ) : (
            peerGroup.map((nomb) => (
              <span
                key={nomb}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs text-slate-700"
              >
                {nomb}
                <button
                  type="button"
                  onClick={() => setPeerGroup((prev) => prev.filter((n) => n !== nomb))}
                  className="text-slate-400 hover:text-rose-600"
                  title="Quitar"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
          Un artículo de benchmarking necesita <strong>al menos una entidad
          para comparar</strong> con la tuya — así el análisis puede decir
          quién lidera, quién queda rezagado y por qué. Ya te precargamos
          el grupo típico de tu segmento; edítalo con el botón de arriba.
        </p>
      </div>

      {pickerOpen && (
        <EntidadesPickerModal
          disponibles={entidadesDisponibles}
          seleccionadas={peerGroup}
          entidadPropia={entidadPropia}
          maxUltimoPeriodo={maxUltimoPeriodo}
          onSave={(nuevas) => {
            setPeerGroup(nuevas);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Eventos macro — solo si tema es coyuntura_macro */}
      {tema === "coyuntura_macro" && (
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Eventos macro a mencionar (opcional)
          </label>
          <textarea
            value={eventosMacro}
            onChange={(e) => setEventosMacro(e.target.value)}
            placeholder={"Ej: El ENFEN mantiene alerta de El Niño Costero hasta verano 2027. El BCRP bajó tasa de referencia a 4.5% en junio. La SBS declaró..."}
            rows={4}
            className="w-full px-2 py-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Si lo dejas vacío, el artículo se limita a data del cierre sin especular sobre eventos externos.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800 flex items-start gap-2">
          <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-10 px-4 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Redactando análisis...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generar artículo
            </>
          )}
        </button>
      </div>
    </section>
  );
}

// ============================================================================
// VISTA 3: Editor
// ============================================================================

function EditorVista({
  publicacion, onUpdated, onArchived,
}: {
  publicacion: Publicacion;
  onUpdated: (pub: Publicacion) => Promise<void>;
  onArchived: () => Promise<void>;
}) {
  const [titulo, setTitulo] = useState(publicacion.titulo);
  const [contenidoMd, setContenidoMd] = useState(publicacion.contenidoMd);
  const [hashtagsStr, setHashtagsStr] = useState(publicacion.hashtags.join(" "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const meta = PUBLICACION_TEMAS_META[publicacion.tema];
  const stMeta = STATUS_META[publicacion.status];

  const dirty =
    titulo !== publicacion.titulo ||
    contenidoMd !== publicacion.contenidoMd ||
    hashtagsStr !== publicacion.hashtags.join(" ");

  const save = async (nextStatus?: PublicacionStatus) => {
    setSaving(true);
    setError(null);
    try {
      const hashtags = hashtagsStr
        .split(/\s+/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((h) => (h.startsWith("#") ? h : `#${h}`));
      const res = await fetch(`/api/v1/publicaciones/${publicacion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          contenidoMd,
          hashtags,
          ...(nextStatus ? { status: nextStatus } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const pub = (json?.data?.publicacion ?? json?.publicacion) as Publicacion | undefined;
      if (pub) await onUpdated(pub);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!confirm("¿Archivar esta publicación? Puedes recuperarla desde la vista de admin.")) return;
    const res = await fetch(`/api/v1/publicaciones/${publicacion.id}`, { method: "DELETE" });
    if (res.ok) await onArchived();
  };

  const copyForLinkedIn = async () => {
    // Formato LinkedIn: sin markdown syntax, con saltos limpios + hashtags al final.
    // Removemos # de titulos, ** de bold, y otros markers que LinkedIn no interpreta.
    // Los placeholders [[CHART:xxx]] tambien se remueven (LinkedIn no soporta SVG).
    const clean = contenidoMd
      .replace(/\[\[CHART:[^\]]+\]\]/g, "") // placeholders de charts -> nada
      .replace(/^#+\s+/gm, "") // #, ##, ### -> quitar
      .replace(/\*\*(.*?)\*\*/g, "$1") // **bold** -> texto plano
      .replace(/\*(.*?)\*/g, "$1") // *italic* -> texto plano
      .replace(/^\s*[-*+]\s+/gm, "• ") // bullets -> viñeta unicode
      .replace(/\n{3,}/g, "\n\n") // colapsar 3+ saltos consecutivos
      .trim();
    const hashtags = hashtagsStr.split(/\s+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    const finalText = `${clean}\n\n${hashtags}`;
    try {
      await navigator.clipboard.writeText(finalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("No se pudo copiar al portapapeles. Selecciona manualmente.");
    }
  };

  const downloadHtml = () => {
    // Genera HTML autocontenido (con SVGs inline) para blog / newsletter.
    // Estilo NYT-inspired — sin dependencias, portable, todo inline.
    const hashtags = hashtagsStr.split(/\s+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    const html = renderArticuloHtml({
      titulo,
      contenidoMd,
      charts: publicacion.charts,
      hashtags,
      periodoLabel: formatPeriodo(publicacion.periodo),
      entidadPropia: publicacion.entidadPropia,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(titulo)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadChartPng = (chart: Publicacion["charts"][number]) => {
    // Convertir SVG a PNG via canvas para poder subirlo a LinkedIn (SVG
    // no es soportado como upload directo). 1200x675 (aspect 16:9) es
    // el sweet spot de preview en LinkedIn feed.
    const svgBlob = new Blob([chart.svg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const outW = 1200;
      const outH = Math.round(1200 * (img.height / img.width));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(svgUrl);
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, 0, 0, outW, outH);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = `${slugify(chart.titulo)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
        URL.revokeObjectURL(svgUrl);
      }, "image/png");
    };
    img.onerror = () => URL.revokeObjectURL(svgUrl);
    img.src = svgUrl;
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", stMeta.color)}>
            {stMeta.label}
          </span>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
            {meta.label}
          </span>
          <span className="text-[10px] text-slate-400">
            Cierre {formatPeriodo(publicacion.periodo)} · {publicacion.entidadPropia}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyForLinkedIn}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded border transition-colors",
              copied
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100",
            )}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copiado" : "Copiar para LinkedIn"}
          </button>
          {publicacion.charts.length > 0 && (
            <button
              type="button"
              onClick={downloadHtml}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded border bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
              title="Descargar HTML autocontenido (con gráficos SVG inline) para blog o newsletter"
            >
              <FileText className="w-3.5 h-3.5" />
              Descargar HTML
            </button>
          )}
          <button
            type="button"
            onClick={archive}
            className="inline-flex items-center gap-1.5 h-8 px-2 text-xs text-rose-600 hover:bg-rose-50 rounded border border-transparent hover:border-rose-200"
            title="Archivar publicación"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Preview del articulo con charts embebidos — solo si hay charts */}
      {publicacion.charts.length > 0 && (
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
              Vista previa del artículo
            </p>
            <p className="text-[10px] text-slate-400">
              {publicacion.charts.length} {publicacion.charts.length === 1 ? "gráfico" : "gráficos"} embebidos
            </p>
          </div>
          <ArticuloPreview
            titulo={titulo}
            contenidoMd={contenidoMd}
            charts={publicacion.charts}
            onDownloadChartPng={downloadChartPng}
          />
        </div>
      )}

      <div className="p-5 space-y-4">
        {/* Titulo */}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Título
          </label>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="w-full h-10 px-3 text-base font-semibold text-slate-900 rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
          />
        </div>

        {/* Contenido markdown */}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Contenido (markdown)
          </label>
          <textarea
            value={contenidoMd}
            onChange={(e) => setContenidoMd(e.target.value)}
            rows={20}
            className="w-full px-3 py-2 text-sm text-slate-800 font-mono rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white leading-relaxed"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            {contenidoMd.split(/\s+/).filter(Boolean).length} palabras · {contenidoMd.length} caracteres
          </p>
        </div>

        {/* Hashtags */}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Hashtags (separados por espacio)
          </label>
          <input
            type="text"
            value={hashtagsStr}
            onChange={(e) => setHashtagsStr(e.target.value)}
            className="w-full h-9 px-3 text-sm text-slate-800 rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white font-mono"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800">
            {error}
          </div>
        )}

        {/* Toolbar de status */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          {dirty && (
            <span className="text-[11px] text-amber-700 mr-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Cambios sin guardar
            </span>
          )}
          <button
            type="button"
            onClick={() => save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-slate-700"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Guardar cambios
          </button>
          {publicacion.status === "draft" && (
            <button
              type="button"
              onClick={() => save("reviewed")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium bg-amber-100 hover:bg-amber-200 disabled:opacity-50 rounded text-amber-900 border border-amber-200"
            >
              Marcar como revisado
            </button>
          )}
          {publicacion.status !== "published" && (
            <button
              type="button"
              onClick={() => save("published")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded text-white"
            >
              Marcar como publicado
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// EntidadesPickerModal — selector multi validado contra entidades reales.
// Reemplaza el input libre donde el user podia tipear cualquier cosa (typo
// -> no matcheaba entidad -> articulo con data vacia). Mismo patron que
// PeerGroupModal de /punto-equilibrio y el modal de DuPont.
// ============================================================================

function EntidadesPickerModal({
  disponibles,
  seleccionadas,
  entidadPropia,
  maxUltimoPeriodo,
  onSave,
  onClose,
}: {
  disponibles: EntidadDisponible[];
  seleccionadas: string[];
  entidadPropia: string;
  maxUltimoPeriodo: number;
  onSave: (nuevas: string[]) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState(new Set(seleccionadas));
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Excluimos la entidad propia — no tiene sentido "compararse consigo mismo"
    return disponibles.filter((e) => {
      if (e.nombCorreg === entidadPropia) return false;
      if (!q) return true;
      return e.nombCorreg.toLowerCase().includes(q);
    });
  }, [disponibles, search, entidadPropia]);

  const toggle = (n: string) => {
    const next = new Set(sel);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setSel(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ent-picker-title"
    >
      <div
        className="bg-white w-full max-w-2xl rounded-xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 id="ent-picker-title" className="text-base font-semibold text-slate-900">
              Con quiénes comparar
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Elige 2 a 5 entidades SBS reales. Tu entidad ({entidadPropia}) ya está incluida por defecto.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-5 py-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar entidad…"
            className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
            autoFocus
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            Seleccionadas: <strong>{sel.size}</strong> de {filtered.length}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filtered.map((e) => (
            <label
              key={e.nombCorreg}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-slate-50",
                sel.has(e.nombCorreg) && "bg-brand-50",
              )}
            >
              <input
                type="checkbox"
                checked={sel.has(e.nombCorreg)}
                onChange={() => toggle(e.nombCorreg)}
                className="w-4 h-4"
              />
              <span className="text-sm text-slate-800 flex-1 flex items-center gap-2 min-w-0">
                <span className="truncate">{e.nombCorreg}</span>
                <EntidadFreshnessBadge
                  ultimoPeriodo={e.ultimoPeriodo}
                  maxDisponible={maxUltimoPeriodo}
                />
              </span>
              {e.tipoEntidad && (
                <span className="text-[10px] text-slate-400 flex-shrink-0">
                  {e.tipoEntidad}
                </span>
              )}
            </label>
          ))}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              Sin resultados para &quot;{search}&quot;
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            className="px-3 h-9 text-sm text-slate-700 hover:bg-slate-100 rounded"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(Array.from(sel))}
            className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded"
          >
            Aplicar {sel.size > 0 && `(${sel.size})`}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// ArticuloPreview + helpers de rendering (charts embebidos, HTML export)
// ============================================================================

/**
 * Preview del articulo con SVG charts renderizados inline. Parser markdown
 * minimo intencional (headers + bold + parrafos + placeholder de charts).
 * Cero dependencias (no queremos arrastrar remark/rehype al client bundle).
 */
function ArticuloPreview({
  titulo,
  contenidoMd,
  charts,
  onDownloadChartPng,
}: {
  titulo: string;
  contenidoMd: string;
  charts: Publicacion["charts"];
  onDownloadChartPng: (chart: Publicacion["charts"][number]) => void;
}) {
  const chartById = useMemo(() => {
    const m = new Map<string, Publicacion["charts"][number]>();
    for (const c of charts) m.set(c.id, c);
    return m;
  }, [charts]);

  // Split del markdown por lineas + procesamiento minimo
  const bloques = useMemo(() => parseMarkdownBloques(contenidoMd), [contenidoMd]);

  return (
    <article className="bg-white rounded-lg border border-slate-200 p-6 md:p-8 shadow-sm max-w-3xl mx-auto text-slate-800 leading-relaxed">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4 leading-tight">
        {titulo}
      </h1>
      {bloques.map((b, i) => {
        if (b.tipo === "chart-placeholder") {
          const chart = chartById.get(b.chartId);
          if (!chart) {
            return (
              <div
                key={i}
                className="my-6 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800"
              >
                ⚠ Placeholder <code>[[CHART:{b.chartId}]]</code> sin chart asociado.
              </div>
            );
          }
          return (
            <figure key={i} className="my-6 -mx-2 md:-mx-4">
              <div
                className="rounded-lg border border-slate-200 overflow-hidden bg-white"
                dangerouslySetInnerHTML={{ __html: chart.svg }}
                role="img"
                aria-label={chart.altText}
              />
              <figcaption className="mt-2 flex items-start justify-between gap-3 text-[11px] text-slate-500">
                <span className="italic">{chart.subtitulo}</span>
                <button
                  type="button"
                  onClick={() => onDownloadChartPng(chart)}
                  className="flex-shrink-0 text-brand-700 hover:text-brand-800 font-medium inline-flex items-center gap-1"
                  title="Descargar como PNG para subir a LinkedIn"
                >
                  ⬇ PNG
                </button>
              </figcaption>
            </figure>
          );
        }
        if (b.tipo === "h1") {
          // Ya renderizamos el titulo arriba — omitir h1 duplicado
          return null;
        }
        if (b.tipo === "h2") {
          return (
            <h2 key={i} className="text-lg md:text-xl font-bold text-slate-900 mt-6 mb-3 leading-snug">
              {renderInline(b.texto)}
            </h2>
          );
        }
        if (b.tipo === "h3") {
          return (
            <h3 key={i} className="text-base font-semibold text-slate-800 mt-4 mb-2">
              {renderInline(b.texto)}
            </h3>
          );
        }
        // parrafo
        return (
          <p key={i} className="my-3 text-[15px]">
            {renderInline(b.texto)}
          </p>
        );
      })}
    </article>
  );
}

type MdBloque =
  | { tipo: "h1"; texto: string }
  | { tipo: "h2"; texto: string }
  | { tipo: "h3"; texto: string }
  | { tipo: "parrafo"; texto: string }
  | { tipo: "chart-placeholder"; chartId: string };

function parseMarkdownBloques(md: string): MdBloque[] {
  const lineas = md.split(/\r?\n/);
  const bloques: MdBloque[] = [];
  let bufferParrafo: string[] = [];
  const flush = () => {
    if (bufferParrafo.length > 0) {
      const texto = bufferParrafo.join(" ").trim();
      if (texto) bloques.push({ tipo: "parrafo", texto });
      bufferParrafo = [];
    }
  };
  for (const raw of lineas) {
    const linea = raw.trim();
    if (!linea) {
      flush();
      continue;
    }
    const chartMatch = linea.match(/^\[\[CHART:([^\]]+)\]\]$/);
    if (chartMatch) {
      flush();
      bloques.push({ tipo: "chart-placeholder", chartId: chartMatch[1]! });
      continue;
    }
    const h1 = linea.match(/^#\s+(.+)$/);
    if (h1) {
      flush();
      bloques.push({ tipo: "h1", texto: h1[1]! });
      continue;
    }
    const h2 = linea.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      bloques.push({ tipo: "h2", texto: h2[1]! });
      continue;
    }
    const h3 = linea.match(/^###\s+(.+)$/);
    if (h3) {
      flush();
      bloques.push({ tipo: "h3", texto: h3[1]! });
      continue;
    }
    bufferParrafo.push(linea);
  }
  flush();
  return bloques;
}

/** Render inline: **bold** -> <strong>. Preserva el resto plano. */
function renderInline(texto: string): React.ReactNode {
  const partes: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = regex.exec(texto)) !== null) {
    if (match.index > lastIdx) partes.push(texto.slice(lastIdx, match.index));
    partes.push(
      <strong key={k++} className="font-semibold text-slate-900">
        {match[1]}
      </strong>,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < texto.length) partes.push(texto.slice(lastIdx));
  return partes;
}

/**
 * Renderiza HTML autocontenido del articulo (para blog / newsletter).
 * Estilo NYT — tipografia serif, layout centrado max-width 720px,
 * SVGs inline, meta tags OG para preview en redes.
 */
function renderArticuloHtml(input: {
  titulo: string;
  contenidoMd: string;
  charts: Publicacion["charts"];
  hashtags: string;
  periodoLabel: string;
  entidadPropia: string;
}): string {
  const bloques = parseMarkdownBloques(input.contenidoMd);
  const chartById = new Map<string, Publicacion["charts"][number]>();
  for (const c of input.charts) chartById.set(c.id, c);
  const bodyHtml = bloques
    .map((b) => {
      if (b.tipo === "h1") return ""; // titulo va aparte
      if (b.tipo === "chart-placeholder") {
        const chart = chartById.get(b.chartId);
        if (!chart) return `<div class="chart-warn">Chart faltante: ${escapeHtml(b.chartId)}</div>`;
        return `<figure><div class="chart-wrap">${chart.svg}</div><figcaption>${escapeHtml(chart.subtitulo)}</figcaption></figure>`;
      }
      if (b.tipo === "h2") return `<h2>${renderInlineHtml(b.texto)}</h2>`;
      if (b.tipo === "h3") return `<h3>${renderInlineHtml(b.texto)}</h3>`;
      return `<p>${renderInlineHtml(b.texto)}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(input.titulo)}</title>
<meta property="og:title" content="${escapeHtml(input.titulo)}"/>
<meta property="og:description" content="Análisis del sistema financiero peruano · ${escapeHtml(input.entidadPropia)} · Cierre ${escapeHtml(input.periodoLabel)}"/>
<meta property="og:type" content="article"/>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; background: #ffffff; color: #1e293b; line-height: 1.7; -webkit-font-smoothing: antialiased; }
  .container { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
  .meta { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 12px; }
  h1 { font-size: 34px; font-weight: 800; color: #0f172a; line-height: 1.2; margin: 0 0 24px; letter-spacing: -0.02em; }
  h2 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 20px; font-weight: 700; color: #0f172a; margin: 32px 0 12px; line-height: 1.3; }
  h3 { font-size: 17px; font-weight: 700; margin: 24px 0 8px; }
  p { margin: 14px 0; font-size: 17px; }
  strong { font-weight: 700; color: #0f172a; }
  figure { margin: 32px -16px; padding: 0; }
  .chart-wrap { border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff; overflow: hidden; }
  .chart-wrap svg { display: block; width: 100%; height: auto; }
  figcaption { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-style: italic; color: #64748b; margin-top: 6px; text-align: center; }
  .chart-warn { padding: 12px; background: #fef3c7; border: 1px solid #fcd34d; color: #78350f; font-size: 13px; border-radius: 6px; }
  .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #64748b; }
  .hashtags { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #2563eb; margin-top: 8px; }
</style>
</head>
<body>
  <main class="container">
    <div class="meta">${escapeHtml(input.entidadPropia)} · Cierre ${escapeHtml(input.periodoLabel)}</div>
    <h1>${escapeHtml(input.titulo)}</h1>
    ${bodyHtml}
    <div class="footer">
      <div class="hashtags">${escapeHtml(input.hashtags)}</div>
      <p style="margin-top: 16px;">Fuente: Superintendencia de Banca, Seguros y AFP del Perú. Análisis generado con Aibenchef.</p>
    </div>
  </main>
</body>
</html>`;
}

function renderInlineHtml(texto: string): string {
  return escapeHtml(texto).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** slug filename-safe. Ej: "El ROE de..." -> "el-roe-de" */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "articulo";
}
