"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * TopProgressBar — barra de progreso fija al top del viewport que se
 * activa en cada navegacion interna. Signature move de apps premium
 * (Vercel, YouTube, Linear, GitHub).
 *
 * Como funciona:
 * 1. Interceptamos clicks en cualquier <a href="..."> interno.
 *    Si el href apunta a otra ruta del app, arrancamos la barra.
 * 2. La barra progresa exponencialmente hacia 90% (nunca 100 real hasta
 *    que Next termine de navegar) — patron NProgress clasico.
 * 3. Cuando pathname/searchParams cambia -> Next termino de navegar
 *    -> completamos a 100% y hacemos fade out.
 * 4. Tambien reaccionamos a popstate (back/forward del navegador).
 *
 * Detalles premium:
 * - Color brand con glow / drop shadow (no es una barra gris plana).
 * - Peek animation opcional para dar sensacion 'viva' cuando esta al top.
 * - z-index encima de TODO (sticky nav esta en z-40).
 * - Ignora clicks con modificadores (cmd/ctrl-click = new tab).
 * - Ignora links con target=_blank o external.
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Interceptar navegaciones (click en link o back/forward)
  useEffect(() => {
    const start = () => {
      startedRef.current = true;
      setVisible(true);
      setProgress(15);
    };

    const onClick = (e: MouseEvent) => {
      // Ignorar clicks con modificadores (abrir en nueva pestaña, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (anchor.target === "_blank") return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        // Misma URL exacta = no navigation real
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
          return;
        }
        start();
      } catch {
        /* href invalido — ignorar */
      }
    };

    const onPopState = () => start();

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Cuando pathname o searchParams cambian => navegacion termino
  useEffect(() => {
    if (!startedRef.current) return;
    setProgress(100);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      startedRef.current = false;
      // Reset al toque despues del fade para que el proximo click empiece
      // desde 0 sin que se vea el reset.
      setTimeout(() => setProgress(0), 200);
    }, 220);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname, searchParams]);

  // Progresion exponencial hacia 90% (nunca llega solo — necesita el "termino")
  useEffect(() => {
    if (!visible || progress >= 90) return;
    const t = setTimeout(() => {
      setProgress((p) => Math.min(90, p + (90 - p) * 0.12));
    }, 220);
    return () => clearTimeout(t);
  }, [visible, progress]);

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 pointer-events-none"
      style={{
        zIndex: 100,
        opacity: visible ? 1 : 0,
        transition: "opacity 260ms ease-out",
      }}
    >
      <div
        className="h-[3px] bg-gradient-to-r from-brand-500 via-brand-400 to-brand-600 rounded-r-full"
        style={{
          width: `${progress}%`,
          transition: "width 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          boxShadow:
            "0 0 10px rgba(59, 130, 246, 0.55), 0 0 4px rgba(59, 130, 246, 0.6)",
        }}
      />
      {/* Punta con glow — leve blur al filo derecho para sensacion 'viva' */}
      <div
        className="absolute top-0 h-[3px] w-8 pointer-events-none"
        style={{
          left: `calc(${progress}% - 32px)`,
          transition: "left 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          background:
            "linear-gradient(90deg, transparent, rgba(96, 165, 250, 0.9))",
          filter: "blur(2px)",
          opacity: visible && progress > 5 && progress < 100 ? 1 : 0,
        }}
      />
    </div>
  );
}
