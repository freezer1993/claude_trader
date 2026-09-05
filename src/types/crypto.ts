/** Identificadores de CoinGecko para el universo cubierto por el dashboard. */
export type CoinId = 'bitcoin' | 'ethereum' | 'binancecoin';

export interface CoinMeta {
  id: CoinId;
  symbol: string;
  name: string;
  /** Color de acento por moneda, usado en gráficos y acentos de UI. */
  accent: string;
}

/** Fila normalizada de /coins/markets. */
export interface CoinMarket {
  id: CoinId;
  symbol: string;
  name: string;
  image: string;
  price: number;
  marketCap: number;
  volume24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  lastUpdated: string | null;
}

/** Punto de una serie temporal de precios (time en segundos UNIX, UTC). */
export interface PricePoint {
  time: number;
  value: number;
}

/** Vela OHLC (time en segundos UNIX, UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Timeframe = '1D' | '1H';

/** Envoltorio común: todo dato servido indica si proviene de caché vencida. */
export interface DataEnvelope<T> {
  data: T;
  /** true cuando la red falló y se sirvió la última copia válida de LocalStorage. */
  stale: boolean;
  /** Epoch ms en el que se obtuvo el dato realmente servido. */
  fetchedAt: number;
  /** Motivo por el que el dato está obsoleto (rate limit, red caída, etc.). */
  staleReason?: string;
}

export type LoadState = 'idle' | 'loading' | 'success' | 'error';
