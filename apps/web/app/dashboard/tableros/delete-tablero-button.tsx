"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Delete button para tarjeta de tablero en la grilla.
 * Confirm + DELETE + router.refresh para recargar el listado.
 */
export function DeleteTableroButton({ id, nombre }: { id: string; nombre: string }) {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    // Evitamos que el Link contenedor navegue al detalle.
    e.preventDefault();
    e.stopPropagation();
    if (borrando) return;
    if (!window.confirm(`Eliminar el tablero "${nombre}"? Esta accion no se puede deshacer.`)) {
      return;
    }
    setBorrando(true);
    try {
      const r = await fetch(`/api/v1/tableros/${id}`, { method: "DELETE" });
      const json = await r.json().catch(() => ({}));
      if (json.error) {
        window.alert(`No se pudo eliminar: ${json.error.message ?? "error"}`);
        return;
      }
      router.refresh();
    } catch (err) {
      window.alert(`Error de red: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBorrando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={borrando}
      className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition opacity-0 group-hover:opacity-100"
      aria-label="Eliminar tablero"
      title="Eliminar tablero"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
