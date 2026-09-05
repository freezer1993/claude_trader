import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCandles,
  fetchDailySeries,
  fetchHourlySeries,
  fetchMarkets,
} from '../lib/coingecko';
import type { Candle, CoinId, CoinMarket, DataEnvelope, LoadState, PricePoint } from '../types/crypto';

export interface AsyncResource<T> {
  data: T | null;
  state: LoadState;
  error: string | null;
  stale: boolean;
  staleReason: string | null;
  fetchedAt: number | null;
  refresh: (force?: boolean) => void;
}

type Fetcher<T> = (options: { signal?: AbortSignal; force?: boolean }) => Promise<DataEnvelope<T>>;

/**
 * Núcleo compartido por todos los recursos. Mantiene el último dato válido
 * durante los refrescos para que la UI no parpadee, y aborta la petición en
 * curso al desmontar o al cambiar de moneda.
 */
function useAsyncResource<T>(fetcher: Fetcher<T>, enabled = true): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>(enabled ? 'loading' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(
    async (force = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => (prev === 'success' ? 'success' : 'loading'));
      setError(null);

      try {
        const envelope = await fetcherRef.current({ signal: controller.signal, force });
        if (controller.signal.aborted) return;
        setData(envelope.data);
        setStale(envelope.stale);
        setStaleReason(envelope.staleReason ?? null);
        setFetchedAt(envelope.fetchedAt);
        setState('success');
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error desconocido al obtener datos.');
        setState('error');
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }
    void run();
    return () => abortRef.current?.abort();
  }, [enabled, run]);

  return { data, state, error, stale, staleReason, fetchedAt, refresh: run };
}

const MARKETS_POLL_MS = 60_000;

export function useMarkets(): AsyncResource<CoinMarket[]> {
  const resource = useAsyncResource<CoinMarket[]>(fetchMarkets);
  const { refresh } = resource;

  // Polling pausado con la pestaña oculta: refrescar en segundo plano solo
  // consume cuota de la API gratuita sin que nadie mire el dato.
  useEffect(() => {
    let timer: number | undefined;

    const start = () => {
      stop();
      timer = window.setInterval(() => refresh(), MARKETS_POLL_MS);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return resource;
}

export function useDailySeries(coinId: CoinId | null): AsyncResource<PricePoint[]> {
  const fetcher = useCallback<Fetcher<PricePoint[]>>(
    (options) => fetchDailySeries(coinId as CoinId, options),
    [coinId],
  );
  return useAsyncResource(fetcher, coinId !== null);
}

export function useHourlySeries(coinId: CoinId | null): AsyncResource<PricePoint[]> {
  const fetcher = useCallback<Fetcher<PricePoint[]>>(
    (options) => fetchHourlySeries(coinId as CoinId, options),
    [coinId],
  );
  return useAsyncResource(fetcher, coinId !== null);
}

/** Las velas solo se piden cuando el usuario activa la vista de velas. */
export function useCandles(coinId: CoinId | null, enabled: boolean): AsyncResource<Candle[]> {
  const fetcher = useCallback<Fetcher<Candle[]>>(
    (options) => fetchCandles(coinId as CoinId, options),
    [coinId],
  );
  return useAsyncResource(fetcher, enabled && coinId !== null);
}
