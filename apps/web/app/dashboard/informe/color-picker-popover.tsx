"use client";

/**
 * Popover de color picker per entidad.
 *
 * Arquitectura: este componente es PURE PRESENTATION. No conoce URLs,
 * routers o estado global. Solo recibe el color actual y un callback
 * onColorChange. El parent (InformeClient) maneja el estado de
 * colorOverrides y sincroniza con la URL.
 *
 * Renderizado via React Portal a document.body con position:fixed para
 * esquivar el overflow:hidden del header gradiente.
 *
 * UX:
 *  - Click en chip de entidad abre el popover
 *  - Paleta sugerida (16 colores corporativos peruanos) + HTML5 color picker
 *  - Click en paleta o "Aplicar" en custom hex: aplica + (opcionalmente cierra)
 *  - Boton Reset: vuelve al color default y cierra
 *  - Boton X / ESC / click fuera: cierra
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette, RotateCcw, X } from "lucide-react";

const PALETA_SUGERIDA = [
  "#0F2A5E", // azul BCP
  "#1E40AF", // azul indigo
  "#2563EB", // azul medio
  "#1E90FF", // celeste
  "#06B6D4", // cyan
  "#10B981", // emerald
  "#16A34A", // verde
  "#FFB300", // dorado Arequipa
  "#F59E0B", // ambar
  "#EA580C", // naranja
  "#DC2626", // rojo
  "#C8102E", // rojo Huancayo
  "#E91E63", // fucsia
  "#7C3AED", // violeta
  "#722F37", // vino Cusco
  "#475569", // slate
];

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT = 310;
const GAP = 4;

export function ColorPickerPopover({
  labelCorto,
  currentColor,
  triggerRef,
  onColorChange,
  onClose,
}: {
  nombCorreg: string;
  labelCorto: string;
  currentColor: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** hex = aplica; null = reset al color del server */
  onColorChange: (hex: string | null) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [customHex, setCustomHex] = useState<string>(currentColor);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Sync customHex cuando el currentColor prop cambia (parent state se actualizo)
  useEffect(() => {
    setCustomHex(currentColor);
  }, [currentColor]);

  // Calcular posicion contra el trigger. useLayoutEffect para evitar flicker.
  useLayoutEffect(() => {
    const compute = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      let top: number;
      if (spaceBelow >= POPOVER_HEIGHT + GAP) {
        top = rect.bottom + GAP;
      } else if (spaceAbove >= POPOVER_HEIGHT + GAP) {
        top = rect.top - POPOVER_HEIGHT - GAP;
      } else {
        top = Math.max(8, vh / 2 - POPOVER_HEIGHT / 2);
      }

      let left = rect.left;
      if (left + POPOVER_WIDTH > vw - 8) {
        left = Math.max(8, rect.right - POPOVER_WIDTH);
      }
      left = Math.max(8, left);

      setCoords({ top, left });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [triggerRef]);

  // Cerrar con ESC o click fuera
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose, triggerRef]);

  // Aplicar color: notifica al parent. El popover NO se cierra para que el
  // user pueda probar varios colores en vivo. Cierre manual via X, ESC o
  // click afuera.
  const applyColor = (hex: string) => {
    setCustomHex(hex);
    onColorChange(hex);
  };

  const resetColor = () => {
    onColorChange(null);
    onClose();
  };

  if (!mounted || !coords) return null;

  const popover = (
    <div
      ref={popoverRef}
      className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-slate-900"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: POPOVER_WIDTH,
        zIndex: 9999,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Palette className="w-4 h-4 text-slate-500" />
        <p className="text-xs font-semibold truncate flex-1">{labelCorto}</p>
        <button
          type="button"
          onClick={resetColor}
          className="text-[10px] text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
          title="Volver al color default"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-900 transition-colors"
          title="Cerrar"
          aria-label="Cerrar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
        Paleta sugerida — click para aplicar
      </p>
      <div className="grid grid-cols-8 gap-1.5 mb-3">
        {PALETA_SUGERIDA.map((hex) => {
          const isSelected = currentColor.toLowerCase() === hex.toLowerCase();
          return (
            <button
              type="button"
              key={hex}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                applyColor(hex);
              }}
              className={`relative w-9 h-9 rounded-md border-2 cursor-pointer transition-all hover:shadow-md ${
                isSelected ? "border-slate-900 ring-2 ring-slate-900/30" : "border-white/0 hover:border-slate-300"
              }`}
              style={{ backgroundColor: hex }}
              title={hex}
              aria-label={`Aplicar color ${hex}`}
            >
              {isSelected && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold drop-shadow">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Custom (hex)</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={customHex}
          onChange={(e) => setCustomHex(e.target.value)}
          className="w-10 h-9 rounded border border-slate-200 cursor-pointer"
          aria-label="Selector de color custom"
        />
        <input
          type="text"
          value={customHex}
          onChange={(e) => setCustomHex(e.target.value)}
          placeholder="#RRGGBB"
          maxLength={7}
          className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded font-mono"
        />
        <button
          type="button"
          onClick={() => {
            if (/^#[0-9A-Fa-f]{6}$/.test(customHex)) {
              applyColor(customHex);
              onClose();
            }
          }}
          disabled={!/^#[0-9A-Fa-f]{6}$/.test(customHex)}
          className="px-3 py-1 text-xs bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Aplicar
        </button>
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
