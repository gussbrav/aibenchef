"use client";

/**
 * FormulaPopover — popover click-to-toggle para explicar fórmulas de métricas.
 *
 * Reemplaza el atributo `title=...` nativo del HTML, que en tooltips largos
 * se trunca en Windows/Chrome (limite ~256 chars o pierde saltos de línea).
 *
 * Diseño:
 *  - Trigger = icono ⓘ (recibido como children para flexibilidad)
 *  - Click abre popover posicionado abajo-izquierda
 *  - Click fuera o Escape cierra
 *  - Multiline con `\n` respetado (whitespace-pre-line)
 *  - Ancho max 380px para que sea legible sin scroll horizontal
 *  - Backdrop transparente que captura click-outside
 */

import { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";

type Props = {
  titulo?: string;
  contenido: string;
  /** Color del icono cuando NO esta activo. Default slate-500. */
  iconoColor?: string;
  /** Detiene la propagacion del click al padre (util dentro de accordion header). */
  stopPropagation?: boolean;
};

export function FormulaPopover({
  titulo,
  contenido,
  iconoColor = "text-slate-500",
  stopPropagation = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  const handleClick = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    setOpen((v) => !v);
  };

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center rounded-full hover:bg-slate-100 transition-colors p-0.5 ${iconoColor} hover:text-slate-700`}
        aria-label="Ver fórmula"
        aria-expanded={open}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-2 w-[380px] max-w-[calc(100vw-32px)] bg-white border border-slate-200 rounded-lg shadow-xl p-4 text-slate-800"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          <button
            type="button"
            onClick={(e) => {
              if (stopPropagation) e.stopPropagation();
              setOpen(false);
            }}
            className="absolute top-2 right-2 text-slate-400 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          {titulo && (
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5 pr-6">
              {titulo}
            </p>
          )}
          <div className="text-[12.5px] leading-relaxed whitespace-pre-line">
            {contenido}
          </div>
        </div>
      )}
    </span>
  );
}
