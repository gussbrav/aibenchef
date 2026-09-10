"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReencolarButton({ archivoId }: { archivoId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/admin/pipeline/archivos/${archivoId}/reimport`,
        { method: "POST" },
      );
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-xs text-amber-600 hover:text-amber-800 hover:underline disabled:opacity-40 ml-2"
    >
      {loading ? "…" : "Re-encolar"}
    </button>
  );
}
