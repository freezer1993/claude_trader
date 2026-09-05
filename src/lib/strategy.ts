import {
  detectCross,
  detectLevelCross,
  lastDefined,
  macd as computeMacd,
  rsi as computeRsi,
  sma,
  type MacdResult,
  type Series,
} from './indicators';
import type { PricePoint, Timeframe } from '../types/crypto';

export type SignalAction = 'BUY' | 'SELL' | 'WAIT';

export interface IndicatorSnapshot {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  rsi: number | null;
  /** Distancia porcentual del precio a la SMA20 de la temporalidad. */
  sma20DeviationPct: number | null;
  aboveZeroLine: boolean | null;
}

export interface TimeframeSignal {
  timeframe: Timeframe;
  action: SignalAction;
  /** 0-100. Refleja cuántas condiciones de la regla se cumplieron y su frescura. */
  strength: number;
  reasons: string[];
  warnings: string[];
  ranging: boolean;
  snapshot: IndicatorSnapshot;
  /** Series completas, reutilizadas por el gráfico para pintar los paneles. */
  series: { macd: MacdResult; rsi: Series };
  /** Barras analizadas tras descartar el calentamiento de los indicadores. */
  bars: number;
}

export interface Recommendation {
  action: SignalAction;
  headline: string;
  detail: string;
  /** 0-100, combinando ambas temporalidades. */
  confidence: number;
  contradiction: boolean;
  warnings: string[];
  timeframes: TimeframeSignal[];
}

/** Ventana de confirmación: MACD y RSI deben activarse dentro de estas barras. */
const CONFIRMATION_LOOKBACK = 3;

/** Umbrales de la definición de mercado lateral (histograma normalizado y RSI). */
const RANGE_HISTOGRAM_PCT = 0.12; // |hist| < 0.12 % del precio
const RANGE_RSI_BAND = 8; // RSI dentro de 50 ± 8

export function analyzeTimeframe(points: PricePoint[], timeframe: Timeframe): TimeframeSignal | null {
  // MACD(12,26,9) necesita ~35 barras solo para arrancar; por debajo de 60 el
  // resultado sería estadísticamente ruido y es preferible no emitir señal.
  if (points.length < 60) return null;

  const closes = points.map((p) => p.value);
  const macdResult = computeMacd(closes);
  const rsiSeries = computeRsi(closes, 14);
  const sma20 = sma(closes, 20);

  const price = closes[closes.length - 1] as number;
  const macdCross = detectCross(macdResult.macd, macdResult.signal, CONFIRMATION_LOOKBACK);
  const rsiValue = lastDefined(rsiSeries);
  const macdValue = lastDefined(macdResult.macd);
  const signalValue = lastDefined(macdResult.signal);
  const histValue = lastDefined(macdResult.histogram);
  const sma20Value = lastDefined(sma20);

  const rsiCross30 = detectLevelCross(rsiSeries, 30, CONFIRMATION_LOOKBACK);
  const rsiCross50 = detectLevelCross(rsiSeries, 50, CONFIRMATION_LOOKBACK);
  const rsiCross70 = detectLevelCross(rsiSeries, 70, CONFIRMATION_LOOKBACK);

  const label = timeframe === '1D' ? 'diaria' : 'de 1 hora';
  const reasons: string[] = [];
  const warnings: string[] = [];

  // El histograma se normaliza por precio para que el umbral de lateralidad
  // sea comparable entre BTC (~10⁵ USD) y BNB (~10² USD).
  const histPct = histValue !== null && price > 0 ? Math.abs(histValue / price) * 100 : null;
  const ranging =
    histPct !== null &&
    histPct < RANGE_HISTOGRAM_PCT &&
    rsiValue !== null &&
    Math.abs(rsiValue - 50) < RANGE_RSI_BAND;

  let action: SignalAction = 'WAIT';
  let strength = 0;

  const bullishRsi =
    rsiCross30.direction === 'up'
      ? { text: `RSI recuperándose de sobreventa (cruce al alza del nivel 30)`, weight: 40 }
      : rsiCross50.direction === 'up'
        ? { text: `RSI cruzando al alza el nivel neutro 50`, weight: 32 }
        : null;

  const bearishRsi =
    rsiCross70.direction === 'down'
      ? { text: `RSI abandonando sobrecompra (cruce a la baja del nivel 70)`, weight: 40 }
      : rsiCross50.direction === 'down'
        ? { text: `RSI perdiendo el nivel neutro 50`, weight: 32 }
        : null;

  if (macdCross.direction === 'up' && bullishRsi) {
    action = 'BUY';
    reasons.push(
      `Cruce alcista del MACD en temporalidad ${label}${formatBarsAgo(macdCross.barsAgo)}.`,
    );
    reasons.push(`${bullishRsi.text}${formatBarsAgo(rsiCross30.barsAgo ?? rsiCross50.barsAgo)}.`);
    strength = 45 + bullishRsi.weight;
    if (macdValue !== null && macdValue > 0) {
      reasons.push('El MACD opera por encima del nivel cero: la tendencia de fondo acompaña.');
      strength += 10;
    } else {
      warnings.push(
        'El cruce se produce con el MACD bajo el nivel cero: rebote dentro de tendencia bajista, no confirmación de giro.',
      );
      strength -= 8;
    }
  } else if (macdCross.direction === 'down' && bearishRsi) {
    action = 'SELL';
    reasons.push(
      `Cruce bajista del MACD en temporalidad ${label}${formatBarsAgo(macdCross.barsAgo)}.`,
    );
    reasons.push(`${bearishRsi.text}${formatBarsAgo(rsiCross70.barsAgo ?? rsiCross50.barsAgo)}.`);
    strength = 45 + bearishRsi.weight;
    if (macdValue !== null && macdValue < 0) {
      reasons.push('El MACD opera por debajo del nivel cero: la tendencia de fondo acompaña.');
      strength += 10;
    } else {
      warnings.push(
        'El cruce se produce con el MACD sobre el nivel cero: corrección dentro de tendencia alcista, no confirmación de giro.',
      );
      strength -= 8;
    }
  } else {
    // Sin confirmación cruzada: se explica qué falta para que la regla dispare.
    if (macdCross.direction === 'up') {
      reasons.push(
        `Cruce alcista del MACD ${label} sin confirmación del RSI (no ha cruzado 30 ni 50 al alza).`,
      );
      strength = 30;
    } else if (macdCross.direction === 'down') {
      reasons.push(
        `Cruce bajista del MACD ${label} sin confirmación del RSI (no ha cruzado 70 ni 50 a la baja).`,
      );
      strength = 30;
    } else if (bullishRsi || bearishRsi) {
      reasons.push(
        `Movimiento del RSI sin cruce reciente del MACD en temporalidad ${label}: falta la señal de tendencia.`,
      );
      strength = 25;
    } else {
      reasons.push(`Sin cruces de MACD ni de niveles clave del RSI en las últimas velas ${label}.`);
      strength = 12;
    }
    warnings.push(
      'Indicadores sin alineación: esperar al margen. Operar cruces no confirmados en mercado lateral produce señales falsas.',
    );
  }

  if (ranging) {
    warnings.push(
      'Mercado lateral detectado (histograma MACD plano y RSI pegado a 50): riesgo elevado de señales falsas.',
    );
    if (action !== 'WAIT') strength -= 20;
  }

  const sma20DeviationPct =
    sma20Value !== null && sma20Value > 0 ? ((price - sma20Value) / sma20Value) * 100 : null;

  if (action !== 'WAIT' && sma20DeviationPct !== null && Math.abs(sma20DeviationPct) > 8) {
    warnings.push(
      `El precio está a ${sma20DeviationPct.toFixed(1)} % de su SMA20 ${label}: entrada extendida, riesgo de reversión a la media.`,
    );
    strength -= 10;
  }

  return {
    timeframe,
    action,
    strength: clamp(Math.round(strength), 0, 100),
    reasons,
    warnings,
    ranging: Boolean(ranging),
    snapshot: {
      macd: macdValue,
      signal: signalValue,
      histogram: histValue,
      rsi: rsiValue,
      sma20DeviationPct,
      aboveZeroLine: macdValue === null ? null : macdValue > 0,
    },
    series: { macd: macdResult, rsi: rsiSeries },
    bars: closes.length,
  };
}

/**
 * Combina las temporalidades diaria y horaria. La regla del spec admite señal
 * en 1D *o* en 1H, pero una contradicción explícita entre ambas degrada a
 * "Esperar al Margen": es el escenario clásico de señal falsa en rango.
 */
export function buildRecommendation(signals: (TimeframeSignal | null)[]): Recommendation {
  const valid = signals.filter((s): s is TimeframeSignal => s !== null);

  if (valid.length === 0) {
    return {
      action: 'WAIT',
      headline: 'Datos insuficientes',
      detail:
        'No hay suficiente histórico para calcular MACD(12,26,9) y RSI(14) con fiabilidad. No se emite recomendación.',
      confidence: 0,
      contradiction: false,
      warnings: ['Sin histórico suficiente no se especula: espera a que se carguen más velas.'],
      timeframes: [],
    };
  }

  const buys = valid.filter((s) => s.action === 'BUY');
  const sells = valid.filter((s) => s.action === 'SELL');
  const warnings = Array.from(new Set(valid.flatMap((s) => s.warnings)));
  const contradiction = buys.length > 0 && sells.length > 0;

  if (contradiction) {
    return {
      action: 'WAIT',
      headline: 'Esperar al Margen — señales contradictorias',
      detail:
        'La temporalidad diaria y la de 1 hora apuntan en direcciones opuestas. Sin acuerdo entre marcos temporales, la probabilidad de señal falsa es alta.',
      confidence: 25,
      contradiction: true,
      warnings: [
        'Contradicción entre temporalidades: no se recomienda abrir posición direccional.',
        ...warnings,
      ],
      timeframes: valid,
    };
  }

  const active = buys.length > 0 ? buys : sells;

  if (active.length === 0) {
    const ranging = valid.some((s) => s.ranging);
    return {
      action: 'WAIT',
      headline: 'Esperar al Margen',
      detail: ranging
        ? 'El mercado no muestra tendencia clara: histograma MACD plano y RSI en zona neutra. En rango, los cruces suelen ser señales falsas.'
        : 'Ninguna temporalidad cumple la regla completa MACD + RSI. Sin confirmación cruzada, la recomendación es no operar.',
      confidence: Math.round(average(valid.map((s) => s.strength))),
      contradiction: false,
      warnings,
      timeframes: valid,
    };
  }

  const action = active[0]!.action;
  const agreement = active.length > 1;
  // Acuerdo entre 1D y 1H sube la confianza; una sola temporalidad la limita.
  const base = Math.max(...active.map((s) => s.strength));
  const confidence = clamp(Math.round(agreement ? Math.min(100, base + 12) : base * 0.85), 0, 100);
  const scope = agreement
    ? 'confirmada en temporalidad diaria y de 1 hora'
    : `detectada en temporalidad ${active[0]!.timeframe === '1D' ? 'diaria' : 'de 1 hora'}`;

  return {
    action,
    headline: action === 'BUY' ? 'Señal de Compra (Bullish)' : 'Señal de Venta (Bearish)',
    detail:
      action === 'BUY'
        ? `Cruce alcista del MACD con confirmación del RSI, ${scope}.`
        : `Cruce bajista del MACD con confirmación del RSI, ${scope}.`,
    confidence,
    contradiction: false,
    warnings,
    timeframes: valid,
  };
}

function formatBarsAgo(barsAgo: number | null | undefined): string {
  if (barsAgo === null || barsAgo === undefined) return '';
  if (barsAgo === 0) return ' (vela actual)';
  return ` (hace ${barsAgo} vela${barsAgo === 1 ? '' : 's'})`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
