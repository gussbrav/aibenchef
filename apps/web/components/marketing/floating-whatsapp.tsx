"use client";

/**
 * FloatingWhatsApp — CTA persistente bottom-right visible en pages publicas.
 *
 * Behavior premium (portado de azoramind.com):
 *   - Delayed entrance (700ms) para no robar atencion en first paint.
 *   - Scroll-direction aware: se oculta scrolleando hacia abajo, reaparece
 *     al scrollear hacia arriba.
 *   - Hover/focus revela tooltip navy con el label.
 *   - Anillos pulsantes (2 offset) para señal "live".
 *
 * Se auto-oculta en /dashboard, /login, /signup y flujos auth para no
 * interferir con la experiencia logueada (el usuario ya es cliente).
 */

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const WHATSAPP_PHONE_RAW = "51941352492";
const WHATSAPP_PHONE_DISPLAY = "+51 941 352 492";
const WHATSAPP_LABEL = "Escríbenos por WhatsApp";
const WHATSAPP_MESSAGE =
  "Hola, tengo una consulta sobre Aibenchef.";

// Rutas donde el CTA NO debe aparecer (usuario ya es cliente o esta en flujo
// transaccional donde el CTA es distraccion).
const HIDDEN_PREFIXES = [
  "/dashboard",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/waitlist",
] as const;

export function FloatingWhatsApp() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 700);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let lastY = typeof window !== "undefined" ? window.scrollY : 0;
    let raf = 0;
    const HIDE_THRESHOLD = 220;
    const DELTA = 8;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (Math.abs(dy) > DELTA) {
          if (dy > 0 && y > HIDE_THRESHOLD) setHidden(true);
          else if (dy < 0) setHidden(false);
          lastY = y;
        }
        raf = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Hide en rutas privadas / auth. Retornar null despues del hook para no
  // romper la regla de hooks (siempre se ejecutan los efectos).
  if (pathname && HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const url = `https://wa.me/${WHATSAPP_PHONE_RAW}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={[
          "fwa",
          visible ? "is-visible" : "",
          hidden ? "is-hidden" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={`${WHATSAPP_LABEL} — ${WHATSAPP_PHONE_DISPLAY}`}
        title={`${WHATSAPP_LABEL} · ${WHATSAPP_PHONE_DISPLAY}`}
      >
        <span className="fwa-ring" aria-hidden="true" />
        <span className="fwa-ring fwa-ring--2" aria-hidden="true" />
        <span className="fwa-core">
          <WhatsAppIcon />
        </span>
        <span className="fwa-tooltip" aria-hidden="true">
          {WHATSAPP_LABEL}
        </span>
      </a>

      <style jsx global>{`
        .fwa {
          position: fixed;
          right: max(1.25rem, env(safe-area-inset-right, 1.25rem));
          bottom: max(1.25rem, env(safe-area-inset-bottom, 1.25rem));
          z-index: 90;
          width: 62px;
          height: 62px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          isolation: isolate;
          opacity: 0;
          transform: translateY(24px) scale(0.85);
          transition:
            opacity 0.45s ease,
            transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform, opacity;
        }
        .fwa.is-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .fwa.is-visible.is-hidden {
          opacity: 0;
          transform: translateX(110%) scale(0.9);
          pointer-events: none;
        }

        .fwa-core {
          position: relative;
          z-index: 2;
          width: 100%;
          height: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background:
            radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.28), transparent 55%),
            linear-gradient(140deg, #25d366 0%, #128c3b 100%);
          color: #fff;
          box-shadow:
            0 14px 36px -10px rgba(18, 140, 59, 0.55),
            0 2px 8px rgba(0, 0, 0, 0.24),
            inset 0 1px 0 rgba(255, 255, 255, 0.22),
            0 0 0 1px rgba(255, 255, 255, 0.08);
          transition:
            transform 0.35s cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 0.35s ease;
        }

        .fwa-ring {
          position: absolute;
          inset: 0;
          z-index: 1;
          border-radius: 50%;
          border: 1.5px solid rgba(37, 211, 102, 0.5);
          opacity: 0;
          animation: fwa-pulse 2.6s ease-out infinite;
          pointer-events: none;
        }
        .fwa-ring.fwa-ring--2 {
          animation-delay: 1.3s;
        }
        @keyframes fwa-pulse {
          0% {
            transform: scale(0.94);
            opacity: 0.7;
          }
          70% {
            transform: scale(1.6);
            opacity: 0;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        /* Hover: aibenchef brand-400 halo en lugar de gold. */
        .fwa:hover .fwa-core {
          transform: scale(1.07);
          box-shadow:
            0 20px 44px -10px rgba(18, 140, 59, 0.65),
            0 4px 12px rgba(0, 0, 0, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.28),
            0 0 0 2px #60a5fa,
            0 0 32px rgba(96, 165, 250, 0.38);
        }
        .fwa:focus-visible {
          outline: none;
        }
        .fwa:focus-visible .fwa-core {
          box-shadow:
            0 14px 36px -10px rgba(18, 140, 59, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.22),
            0 0 0 3px #60a5fa;
        }

        /* Tooltip navy oscuro (#0f1e3a — el mismo de headers dashboard). */
        .fwa-tooltip {
          position: absolute;
          right: calc(100% + 0.75rem);
          top: 50%;
          transform: translateY(-50%) translateX(6px);
          background: #0f1e3a;
          color: #fff;
          padding: 0.55rem 0.9rem;
          border-radius: 999px;
          font-size: 0.74rem;
          font-weight: 600;
          font-family: inherit;
          white-space: nowrap;
          box-shadow:
            0 8px 24px -8px rgba(15, 30, 58, 0.55),
            0 0 0 1px rgba(255, 255, 255, 0.06);
          opacity: 0;
          pointer-events: none;
          transition:
            opacity 0.2s ease,
            transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .fwa-tooltip::after {
          content: "";
          position: absolute;
          right: -3px;
          top: 50%;
          width: 8px;
          height: 8px;
          background: #0f1e3a;
          transform: translateY(-50%) rotate(45deg);
          border-radius: 1px;
        }
        .fwa:hover .fwa-tooltip,
        .fwa:focus-visible .fwa-tooltip {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }

        @media (max-width: 640px) {
          .fwa {
            width: 54px;
            height: 54px;
            right: max(1.5rem, env(safe-area-inset-right, 1.5rem));
            bottom: max(1.5rem, env(safe-area-inset-bottom, 1.5rem));
          }
          .fwa-ring {
            animation-name: fwa-pulse-mobile;
          }
          .fwa-tooltip {
            display: none;
          }
        }
        @keyframes fwa-pulse-mobile {
          0% {
            transform: scale(0.96);
            opacity: 0.55;
          }
          70% {
            transform: scale(1.22);
            opacity: 0;
          }
          100% {
            transform: scale(1.22);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .fwa-ring {
            animation: none;
          }
          .fwa {
            transition: opacity 0.3s ease;
            transform: none;
          }
          .fwa.is-visible {
            transform: none;
          }
          .fwa.is-visible.is-hidden {
            transform: none;
          }
        }
      `}</style>
    </>
  );
}

function WhatsAppIcon() {
  // SVG oficial minimal (proporciones logo WhatsApp). 26px para que respire
  // dentro del core de 62px. En mobile el core baja a 54 y el SVG queda 26.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.966-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488" />
    </svg>
  );
}
