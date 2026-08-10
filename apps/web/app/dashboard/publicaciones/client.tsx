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

type EntidadDisponible = {
  nombCorreg: string;
};

type Props = {
  publicaciones: PublicacionListItem[];
  entidadesDisponibles: EntidadDisponible[];
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
  entidadesDisponibles, defaultClienteSlug, defaultEntidadPropia, defaultPeerGroup, defaultPeriodo, onGenerated,
}: {
  entidadesDisponibles: EntidadDisponible[];
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
  const [peerGroupInput, setPeerGroupInput] = useState<string>(
    defaultPeerGroup.join(", "),
  );
  const [periodo, setPeriodo] = useState<number>(defaultPeriodo);
  const [eventosMacro, setEventosMacro] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opciones = useMemo(
    () => entidadesDisponibles.map((e) => e.nombCorreg).sort(),
    [entidadesDisponibles],
  );

  const generate = async () => {
    setError(null);
    const peerGroup = peerGroupInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
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
            const disabled = t === "dupont_rentabilidad";
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

      {/* Cliente + Entidad propia + Periodo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
            Cliente
          </label>
          <input
            type="text"
            value={clienteSlug}
            onChange={(e) => setClienteSlug(e.target.value)}
            placeholder="bcp"
            className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white font-mono"
          />
        </div>
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
          <p className="text-[10px] text-slate-400 mt-1">
            Formato AAAAMM · ej. 202606 = Jun 2026
          </p>
        </div>
      </div>

      {/* Peer group */}
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider mb-1 block">
          Con quiénes comparar
        </label>
        <input
          type="text"
          value={peerGroupInput}
          onChange={(e) => setPeerGroupInput(e.target.value)}
          placeholder="Ej: CMAC Arequipa, CMAC Cusco, CMAC Huancayo"
          className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
        />
        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
          Un artículo de benchmarking necesita <strong>al menos una entidad
          para comparar</strong> con la tuya — así el análisis puede decir
          quién lidera, quién queda rezagado y por qué. Escribe 2 a 5
          nombres separados por coma. Ya te precargamos el grupo típico
          de tu segmento; puedes ajustarlo.
        </p>
      </div>

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
    const clean = contenidoMd
      .replace(/^#+\s+/gm, "") // #, ##, ### -> quitar
      .replace(/\*\*(.*?)\*\*/g, "$1") // **bold** -> texto plano
      .replace(/\*(.*?)\*/g, "$1") // *italic* -> texto plano
      .replace(/^\s*[-*+]\s+/gm, "• ") // bullets -> viñeta unicode
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
