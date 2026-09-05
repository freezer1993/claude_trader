import { CACHE_NS, clearNamespace, readJson, writeJson } from './storage';

/**
 * Caché en LocalStorage con doble propósito:
 *  1. Evitar llamadas redundantes dentro del TTL (la API gratuita de CoinGecko
 *     limita a ~10-30 req/min y devuelve 429 con facilidad).
 *  2. Actuar como red de seguridad: si la red falla, se sirve la última copia
 *     válida aunque esté vencida, marcada como `stale` para avisar al usuario.
 */

export interface CacheEntry<T> {
  data: T;
  /** Epoch ms del momento en que se guardó. */
  savedAt: number;
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  const entry = readJson<CacheEntry<T>>(CACHE_NS, key);
  if (!entry || typeof entry.savedAt !== 'number' || entry.data === undefined) return null;
  return entry;
}

export function writeCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, savedAt: Date.now() };
  if (writeJson(CACHE_NS, key, entry)) return;
  // Cuota excedida: se purga solo la caché de red (nunca los datos del usuario)
  // y se reintenta una vez.
  clearNamespace(CACHE_NS);
  writeJson(CACHE_NS, key, entry);
}

export function isFresh(entry: CacheEntry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.savedAt < ttlMs;
}

export function clearCache(): void {
  clearNamespace(CACHE_NS);
}
