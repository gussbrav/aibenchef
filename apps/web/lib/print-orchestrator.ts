"use client";

/**
 * Coordinador simple entre el boton 'Descargar PDF' y los N accordions
 * lazy-load del informe.
 *
 * Problema: los accordions cerrados NO estan en el DOM (usan {open && ...}),
 * asi que si el usuario clickea 'Descargar PDF' sin haber abierto todos,
 * el PDF queda incompleto.
 *
 * Solucion:
 *   1. InformeClient set printMode = true.
 *   2. Cada accordion escucha printMode; si esta true y su state es 'idle',
 *      auto-abre y dispara fetch. Registra el promise via trackPrintFetch().
 *   3. InformeClient espera a que TODOS los promises se resuelvan (o timeout).
 *   4. Llama window.print().
 *   5. Al terminar, resetea printMode = false.
 *
 * Modulo-level state (no context) — mas simple, funciona porque solo hay
 * 1 informe abierto por vez.
 */

let pendingFetches: Promise<unknown>[] = [];

/**
 * Un accordion registra su fetch actual cuando esta en modo print. El
 * orquestador espera todos estos antes de imprimir.
 */
export function trackPrintFetch(p: Promise<unknown>): void {
  pendingFetches.push(p);
}

/**
 * Espera a que todos los fetches registrados se resuelvan (allSettled —
 * no falla por uno solo). Timeout de gracia — si algo cuelga, no bloquea
 * el print indefinidamente.
 *
 * Al retornar, LIMPIA la lista para la proxima ejecucion.
 */
export async function waitForPrintFetches(timeoutMs = 10000): Promise<{
  total: number;
  timedOut: boolean;
}> {
  const current = pendingFetches;
  pendingFetches = [];
  if (current.length === 0) return { total: 0, timedOut: false };

  let timedOut = false;
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  await Promise.race([Promise.allSettled(current), timeoutPromise]);
  return { total: current.length, timedOut };
}
