import { isFresh, readCache, writeCache } from './cache';
import type { Candle, CoinId, CoinMarket, DataEnvelope, PricePoint } from '../types/crypto';

const API_BASE = 'https://api.coingecko.com/api/v3';

export const TRACKED_COINS: CoinId[] = ['bitcoin', 'ethereum', 'binancecoin'];

/** TTLs afinados al coste de cada endpoint y a la velocidad real del dato. */
export const TTL = {
  markets: 60_000,
  hourlySeries: 10 * 60_000,
  dailySeries: 6 * 60 * 60_000,
  ohlc: 30 * 60_000,
} as const;

export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('CoinGecko devolvió 429 (límite de peticiones alcanzado).');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Cola serializada con separación mínima entre peticiones. La API gratuita
 * penaliza ráfagas, así que se prefiere pagar latencia antes que arriesgar 429
 * que dejaría al usuario sin datos frescos durante un minuto entero.
 */
const MIN_GAP_MS = 1_200;
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const gap = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (gap > 0) await delay(gap);
    try {
      return await task();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  // La cola no debe romperse por un fallo individual.
  queueTail = run.catch(() => undefined);
  return run;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  return enqueue(async () => {
    let lastError: unknown;
    // Un solo reintento con backoff: más intentos agravan el rate limit.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${API_BASE}${path}`, {
          headers: { accept: 'application/json' },
          signal: signal ?? null,
        });

        if (response.status === 429) {
          const header = Number(response.headers.get('retry-after'));
          const retryAfterMs = Number.isFinite(header) && header > 0 ? header * 1000 : 15_000;
          if (attempt === 0) {
            await delay(Math.min(retryAfterMs, 5_000));
            continue;
          }
          throw new RateLimitError(retryAfterMs);
        }

        if (!response.ok) {
          throw new NetworkError(`CoinGecko respondió ${response.status} ${response.statusText}.`);
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastError = error;
        if (error instanceof RateLimitError) throw error;
        if (attempt === 0) {
          await delay(1_500);
          continue;
        }
      }
    }
    throw lastError instanceof Error
      ? new NetworkError(lastError.message)
      : new NetworkError('Fallo de red desconocido al contactar con CoinGecko.');
  });
}

/**
 * Patrón cache-first-con-red: sirve caché fresca sin tocar la red, y ante
 * cualquier fallo degrada a la última copia guardada marcándola como `stale`.
 */
async function cachedRequest<TRaw, TOut>(
  cacheKey: string,
  path: string,
  ttlMs: number,
  transform: (raw: TRaw) => TOut,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<DataEnvelope<TOut>> {
  const cached = readCache<TOut>(cacheKey);

  if (!options.force && cached && isFresh(cached, ttlMs)) {
    return { data: cached.data, stale: false, fetchedAt: cached.savedAt };
  }

  try {
    const raw = await request<TRaw>(path, options.signal);
    const data = transform(raw);
    writeCache(cacheKey, data);
    return { data, stale: false, fetchedAt: Date.now() };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (cached) {
      return {
        data: cached.data,
        stale: true,
        fetchedAt: cached.savedAt,
        staleReason:
          error instanceof RateLimitError
            ? 'Límite de peticiones de CoinGecko alcanzado.'
            : error instanceof Error
              ? error.message
              : 'Fallo de red.',
      };
    }
    throw error;
  }
}

interface RawMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
  high_24h: number | null;
  low_24h: number | null;
  last_updated: string | null;
}

export function fetchMarkets(
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<DataEnvelope<CoinMarket[]>> {
  const ids = TRACKED_COINS.join(',');
  return cachedRequest<RawMarket[], CoinMarket[]>(
    'markets',
    `/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`,
    TTL.markets,
    (raw) =>
      raw
        .filter((row): row is RawMarket => Boolean(row?.id))
        .map((row) => ({
          id: row.id as CoinId,
          symbol: row.symbol?.toUpperCase() ?? '',
          name: row.name ?? row.id,
          image: row.image ?? '',
          price: row.current_price ?? 0,
          marketCap: row.market_cap ?? 0,
          volume24h: row.total_volume ?? 0,
          change24hPct: row.price_change_percentage_24h ?? 0,
          high24h: row.high_24h ?? row.current_price ?? 0,
          low24h: row.low_24h ?? row.current_price ?? 0,
          lastUpdated: row.last_updated ?? null,
        }))
        // Orden estable BTC → ETH → BNB, independiente del orden de la API.
        .sort((a, b) => TRACKED_COINS.indexOf(a.id) - TRACKED_COINS.indexOf(b.id)),
    options,
  );
}

interface RawMarketChart {
  prices: [number, number][];
}

/** CoinGecko decide la granularidad por el rango: 2-90 días → horaria, >90 → diaria. */
function toPricePoints(raw: RawMarketChart): PricePoint[] {
  const points = (raw.prices ?? [])
    .filter((entry) => Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
    .map(([ms, value]) => ({ time: Math.floor(ms / 1000), value }));
  return dedupeAscending(points, (p) => p.time);
}

/** Lightweight Charts exige tiempos estrictamente crecientes y sin duplicados. */
function dedupeAscending<T>(items: T[], key: (item: T) => number): T[] {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const out: T[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const t = key(item);
    if (t === previous) {
      out[out.length - 1] = item; // conserva el valor más reciente del mismo timestamp
      continue;
    }
    out.push(item);
    previous = t;
  }
  return out;
}

/** Serie diaria (≈1 año) para los indicadores de temporalidad 1D y las medias móviles. */
export function fetchDailySeries(
  coinId: CoinId,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<DataEnvelope<PricePoint[]>> {
  return cachedRequest<RawMarketChart, PricePoint[]>(
    `series:daily:${coinId}`,
    `/coins/${coinId}/market_chart?vs_currency=usd&days=365`,
    TTL.dailySeries,
    toPricePoints,
    options,
  );
}

/**
 * Serie horaria de 30 días: los 10 últimos se muestran en el gráfico y el resto
 * alimenta el periodo de calentamiento de MACD(12,26,9) y RSI(14) en 1H.
 */
export function fetchHourlySeries(
  coinId: CoinId,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<DataEnvelope<PricePoint[]>> {
  return cachedRequest<RawMarketChart, PricePoint[]>(
    `series:hourly:${coinId}`,
    `/coins/${coinId}/market_chart?vs_currency=usd&days=30`,
    TTL.hourlySeries,
    toPricePoints,
    options,
  );
}

type RawOhlc = [number, number, number, number, number][];

/** Velas de 4h (days=14 en el plan gratuito), recortadas a los últimos 10 días. */
export function fetchCandles(
  coinId: CoinId,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<DataEnvelope<Candle[]>> {
  return cachedRequest<RawOhlc, Candle[]>(
    `ohlc:${coinId}`,
    `/coins/${coinId}/ohlc?vs_currency=usd&days=14`,
    TTL.ohlc,
    (raw) => {
      const candles = (raw ?? [])
        .filter((row) => Array.isArray(row) && row.length >= 5 && row.every(Number.isFinite))
        .map(([ms, open, high, low, close]) => ({
          time: Math.floor(ms / 1000),
          open,
          high,
          low,
          close,
        }));
      return dedupeAscending(candles, (c) => c.time);
    },
    options,
  );
}
