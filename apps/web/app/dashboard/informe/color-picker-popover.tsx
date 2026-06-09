"use client";

/**
 * Popover de color picker per entidad — click en el chip del comparativa
 * abre este popover con:
 *  - Paleta sugerida (16 colores corporativos peruanos)
 *  - Input HTML5 color (custom hex)
 *  - Boton "Reset" para volver al color default (hash determinista)
 *
 * Persiste en URL via ?colorOverrides=NombA:#hex,NombB:#hex (parseado en
 * page.tsx con parseColorOverrides). El cambio dispara router.replace
 * que re-SSRea con el color aplicado.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Palette, RotateCcw } from "lucide-react";

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

function parseColorOverridesParam(raw: string | null): Map<string, string> {
  const m = new Map<string, string>();
  if (!raw) return m;
  for (const pair of raw.split(",")) {
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) continue;
    const nomb = pair.slice(0, idx).trim();
    const hex = pair.slice(idx + 1).trim();
    if (!nomb || !/^#[0-9A-Fa-f]{6}$/.test(hex)) continue;
    m.set(nomb, hex);
  }
  return m;
}

function serializeColorOverrides(m: Map<string, string>): string {
  return Array.from(m.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}

export function ColorPickerPopover({
  nombCorreg,
  labelCorto,
  currentColor,
  onClose,
}: {
  nombCorreg: string;
  labelCorto: string;
  currentColor: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const [customHex, setCustomHex] = useState<string>(currentColor);

  // Cerrar con ESC o click fuera
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const applyColor = (hex: string) => {
    const overrides = parseColorOverridesParam(searchParams.get("colorOverrides"));
    overrides.set(nombCorreg, hex);
    const next = new URLSearchParams(searchParams.toString());
    next.set("colorOverrides", serializeColorOverrides(overrides));
    router.replace(`?${next.toString()}`, { scroll: false });
    onClose();
  };

  const resetColor = () => {
    const overrides = parseColorOverridesParam(searchParams.get("colorOverrides"));
    overrides.delete(nombCorreg);
    const next = new URLSearchParams(searchParams.toString());
    if (overrides.size === 0) {
      next.delete("colorOverrides");
    } else {
      next.set("colorOverrides", serializeColorOverrides(overrides));
    }
    router.replace(`?${next.toString()}`, { scroll: false });
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute z-50 mt-1 w-[280px] bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-slate-900"
      style={{ top: "100%", left: 0 }}
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
      </div>

      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Paleta sugerida</p>
      <div className="grid grid-cols-8 gap-1 mb-3">
        {PALETA_SUGERIDA.map((hex) => (
          <button
            type="button"
            key={hex}
            onClick={() => applyColor(hex)}
            className={`w-7 h-7 rounded border-2 transition-transform hover:scale-110 ${
              currentColor.toLowerCase() === hex.toLowerCase() ? "border-slate-900" : "border-transparent"
            }`}
            style={{ backgroundColor: hex }}
            title={hex}
            aria-label={`Color ${hex}`}
          />
        ))}
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
            if (/^#[0-9A-Fa-f]{6}$/.test(customHex)) applyColor(customHex);
          }}
          disabled={!/^#[0-9A-Fa-f]{6}$/.test(customHex)}
          className="px-3 py-1 text-xs bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
