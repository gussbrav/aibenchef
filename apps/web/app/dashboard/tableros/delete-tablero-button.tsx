"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { useConfirm } from "@/components/ui";

/**
 * Delete button para tarjeta de tablero en la grilla.
 * Confirm + DELETE + router.refresh para recargar el listado.
 */
export function DeleteTableroButton({ id, nombre }: { id: string; nombre: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [borrando, setBorrando] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    // Evitamos que el Link contenedor navegue al detalle.
    e.preventDefault();
    e.stopPropagation();
    if (borrando) return;
    const ok = await confirm({
      title: `Eliminar tablero "${nombre}"`,
      message:
        "Vas a eliminar el tablero y todos sus widgets. Esta accion no se puede deshacer.",
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    setBorrando(true);
    setErrMsg(null);
    try {
      const r = await fetch(`/api/v1/tableros/${id}`, { method: "DELETE" });
      const json = await r.json().catch(() => ({}));
      if (json.error) {
        setErrMsg(`No se pudo eliminar: ${json.error.message ?? "error"}`);
        setTimeout(() => setErrMsg(null), 4000);
        return;
      }
      router.refresh();
    } catch (err) {
      setErrMsg(`Error de red: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setErrMsg(null), 4000);
    } finally {
      setBorrando(false);
    }
  };

  return (
    <>
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
      {errMsg && (
        <div className="absolute top-10 right-2 z-20 px-2 py-1 bg-rose-50 border border-rose-200 rounded text-[10px] text-rose-700 max-w-xs">
          {errMsg}
        </div>
      )}
    </>
  );
}
