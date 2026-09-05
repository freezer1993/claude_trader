/**
 * Indicadores técnicos implementados a mano para evitar dependencias externas.
 * Convención: todas las funciones devuelven un array de la misma longitud que
 * la entrada, con `null` en las posiciones sin suficiente histórico. Alinear
 * índices de esta forma permite cruzar indicadores sin recalcular desfases.
 */

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * EMA sembrada con la SMA del primer bloque, que es el criterio usado por las
 * plataformas de trading (TradingView, MetaTrader) y evita el sesgo inicial de
 * arrancar la recursión directamente sobre el primer precio.
 */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i] as number;

  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD clásico (12, 26, 9) sobre precios de cierre. */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const macdLine: Series = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && f !== undefined && s !== null && s !== undefined ? f - s : null;
  });

  // La línea de señal es una EMA del MACD, por lo que solo se calcula sobre el
  // tramo definido y luego se re-alinea con los índices originales.
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: Series = new Array(values.length).fill(null);
  if (firstDefined >= 0) {
    const compact = macdLine.slice(firstDefined) as number[];
    const signalCompact = ema(compact, signalPeriod);
    for (let i = 0; i < signalCompact.length; i += 1) {
      signal[firstDefined + i] = signalCompact[i] ?? null;
    }
  }

  const histogram: Series = values.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m !== null && m !== undefined && s !== null && s !== undefined ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}

/** RSI de Wilder (suavizado exponencial con alfa = 1/period). */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }

  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Desviación estándar muestral de los retornos logarítmicos de la ventana final. */
export function returnStdDev(values: number[], window: number): number | null {
  if (values.length < window + 1) return null;
  const slice = values.slice(-(window + 1));
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i += 1) {
    const prev = slice[i - 1] as number;
    const curr = slice[i] as number;
    if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
  }
  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/** Último valor no nulo de una serie con huecos iniciales. */
export function lastDefined(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

export type CrossDirection = 'up' | 'down' | null;

/**
 * Detecta un cruce de `fast` sobre `slow` dentro de las últimas `lookback`
 * barras. La ventana existe porque una confirmación exige que MACD y RSI se
 * activen "casi a la vez", no exactamente en la misma vela.
 */
export function detectCross(
  fast: Series,
  slow: Series,
  lookback = 3,
): { direction: CrossDirection; barsAgo: number | null } {
  const n = fast.length;
  for (let back = 0; back < lookback; back += 1) {
    const i = n - 1 - back;
    if (i <= 0) break;
    const f0 = fast[i - 1];
    const s0 = slow[i - 1];
    const f1 = fast[i];
    const s1 = slow[i];
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
    if (f0 <= s0 && f1 > s1) return { direction: 'up', barsAgo: back };
    if (f0 >= s0 && f1 < s1) return { direction: 'down', barsAgo: back };
  }
  return { direction: null, barsAgo: null };
}

/** Cruce de una serie contra un nivel fijo (30 / 50 / 70 en el caso del RSI). */
export function detectLevelCross(
  series: Series,
  level: number,
  lookback = 3,
): { direction: CrossDirection; barsAgo: number | null } {
  const n = series.length;
  for (let back = 0; back < lookback; back += 1) {
    const i = n - 1 - back;
    if (i <= 0) break;
    const prev = series[i - 1];
    const curr = series[i];
    if (prev == null || curr == null) continue;
    if (prev <= level && curr > level) return { direction: 'up', barsAgo: back };
    if (prev >= level && curr < level) return { direction: 'down', barsAgo: back };
  }
  return { direction: null, barsAgo: null };
}
