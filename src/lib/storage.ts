/**
 * Acceso a LocalStorage tolerante a fallos. Se separa en espacios de nombres
 * para que una purga de la caché de red nunca borre datos introducidos por el
 * usuario (las tenencias de la cartera).
 */

export const CACHE_NS = 'claude-trader:v1:';
export const USER_NS = 'claude-trader:user:';

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

export function readJson<T>(namespace: string, key: string): T | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(namespace + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeJson<T>(namespace: string, key: string, value: T): boolean {
  const store = safeStorage();
  if (!store) return false;
  try {
    store.setItem(namespace + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Elimina todas las claves de un espacio de nombres. */
export function clearNamespace(namespace: string): void {
  const store = safeStorage();
  if (!store) return;
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const key = store.key(i);
    if (key && key.startsWith(namespace)) store.removeItem(key);
  }
}
