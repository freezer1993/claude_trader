import { formatRelative } from '../lib/format';

interface StaleDataBannerProps {
  fetchedAt: number | null;
  reason?: string | null;
}

/**
 * Aviso discreto de dato obsoleto: se sirve la última copia de LocalStorage
 * porque la red falló o CoinGecko devolvió 429.
 */
export function StaleDataBanner({ fetchedAt, reason }: StaleDataBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warn-400/30 bg-warn-400/5 px-3 py-2 text-xs text-warn-400"
    >
      <span aria-hidden="true">●</span>
      <span className="font-medium">Datos en caché</span>
      <span className="text-mist-400">
        {reason ?? 'Sin conexión con CoinGecko.'} Mostrando la última copia válida
        {fetchedAt ? ` (${formatRelative(fetchedAt)})` : ''}.
      </span>
    </div>
  );
}
