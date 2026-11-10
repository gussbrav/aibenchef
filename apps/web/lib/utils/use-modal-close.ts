"use client";

import { useRef } from "react";

/**
 * Evita que un modal se cierre cuando el usuario arrastra texto desde
 * dentro del modal hacia afuera (drag-select). El backdrop solo se cierra
 * si tanto el mousedown como el click ocurrieron directamente sobre él.
 *
 * Uso:
 *   const backdropProps = useModalClose(onClose);
 *   <div className="fixed inset-0 ..." {...backdropProps}>
 */
export function useModalClose(onClose: () => void) {
  const mouseDownOnSelf = useRef(false);
  return {
    onMouseDown(e: React.MouseEvent) {
      mouseDownOnSelf.current = e.target === e.currentTarget;
    },
    onClick() {
      if (mouseDownOnSelf.current) onClose();
      mouseDownOnSelf.current = false;
    },
  };
}
