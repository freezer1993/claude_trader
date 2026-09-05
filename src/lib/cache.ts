/**
 * Caché en LocalStorage con doble propósito:
 *  1. Evitar llamadas redundantes dentro del TTL (la API gratuita de CoinGecko
 *     limita a ~10-30 req/min y devuelve 429 con facilidad).
 *  2. Actuar como red de seguridad: si la red falla, se sirve la última copia
 *     válida aunque esté vencida, marcada como `stale` para avisar al usuario.
 */

const NAMESPACE = 'claude-trader:v1:';

export interface CacheEntry<T> {
  data: T;
  /** Epoch ms del momento en que se guardó. */
  savedAt: number;
}

/** LocalStorage puede lanzar (modo privado, cuota llena, SSR); nunca debe romper la app. */
function safeStorage(): Storage | null {
  try {
    const probe = '__ct_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(NAMESPACE + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (typeof parsed?.savedAt !== 'number' || parsed.data === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  const store = safeStorage();
  if (!store) return;
  const entry: CacheEntry<T> = { data, savedAt: Date.now() };
  try {
    store.setItem(NAMESPACE + key, JSON.stringify(entry));
  } catch {
    // Cuota excedida: se purgan las entradas propias y se reintenta una vez.
    try {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const k = store.key(i);
        if (k && k.startsWith(NAMESPACE)) store.removeItem(k);
      }
      store.setItem(NAMESPACE + key, JSON.stringify(entry));
    } catch {
      // Sin caché disponible: la app sigue funcionando solo con red.
    }
  }
}

export function isFresh(entry: CacheEntry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.savedAt < ttlMs;
}

export function clearCache(): void {
  const store = safeStorage();
  if (!store) return;
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const k = store.key(i);
    if (k && k.startsWith(NAMESPACE)) store.removeItem(k);
  }
}
