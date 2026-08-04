/**
 * Cache in-memory con TTL simple para queries del informe. Evita re-ejecutar
 * queries pesadas cuando N usuarios abren el mismo accordion con el mismo
 * peer group (caso comun: benchmark del mes con peer default).
 *
 * Diseño:
 *   - Map global (por proceso Node). En un despliegue multi-instancia cada
 *     proceso tiene su cache — no es distribuido. Para el volumen actual
 *     (1 EasyPanel container) es suficiente.
 *   - TTL por entrada. Al expirar se recomputa.
 *   - LRU implicito via limite de entradas (evita OOM si se acumulan
 *     muchas combinaciones de peer group).
 *   - Concurrent-safe para el caso comun: si 5 requests entran a la vez
 *     con la misma key, solo UNO ejecuta la query y los otros esperan la
 *     misma Promise (single-flight).
 *
 * NO usar para:
 *   - Data que cambia frecuentemente (usar TTL corto).
 *   - Data por-usuario (la key no incluye user context).
 *   - Escrituras.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type PendingEntry<T> = {
  promise: Promise<T>;
};

const MAX_ENTRIES = 200;

class QueryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, PendingEntry<unknown>>();

  /**
   * Ejecuta la funcion `compute` si no hay cache valido para `key`.
   * Si otra request esta ejecutando la misma key, comparte su Promise
   * (single-flight) para evitar N queries duplicadas.
   */
  async getOrCompute<T>(
    key: string,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    // Otra request esta computando la misma key -> esperar la suya.
    const pending = this.pending.get(key) as PendingEntry<T> | undefined;
    if (pending) {
      return pending.promise;
    }

    // Somos el primero. Ejecutar y guardar la Promise en pending para que
    // requests concurrentes la compartan.
    const promise = compute()
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        this.pending.delete(key);
        this.evictIfNeeded();
        return value;
      })
      .catch((err) => {
        // No cachear errores. La proxima request re-intenta.
        this.pending.delete(key);
        throw err;
      });
    this.pending.set(key, { promise });
    return promise;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= MAX_ENTRIES) return;
    // Evict las MAS VIEJAS (menor expiresAt) hasta bajar el tamaño.
    const entries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.expiresAt - b.expiresAt,
    );
    const toRemove = entries.slice(0, this.cache.size - MAX_ENTRIES);
    for (const [k] of toRemove) this.cache.delete(k);
  }
}

/**
 * Instancia global compartida entre requests del mismo proceso Node.
 * Sobrevive entre requests pero NO entre reinicios del container.
 */
export const historicoCache = new QueryCache();

/**
 * Helper: genera una key deterministica desde params. Ordena peerGroup
 * asi los mismos peers en distinto orden hitean el mismo cache.
 */
export function historicoCacheKey(params: {
  metric: string;
  periodo: number;
  peerGroup: string[];
  consolidar: boolean;
}): string {
  const peers = [...params.peerGroup].sort().join("|");
  return `hist:${params.metric}:${params.periodo}:${peers}:${params.consolidar}`;
}
