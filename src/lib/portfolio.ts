import type { RiskAssessment, RiskLevel } from './risk';
import type { Recommendation } from './strategy';
import type { CoinId, CoinMarket } from '../types/crypto';

/** USDT es el activo refugio: se asume la paridad 1 USDT = 1 USD. */
export const STABLE_ID = 'tether' as const;
export type AssetId = CoinId | typeof STABLE_ID;

export type PositionAction = 'HOLD' | 'ROTATE' | 'TO_USDT' | 'ENTER' | 'STAY_USDT';

export interface AssetScore {
  coinId: CoinId;
  /** Atractivo neto en [-100, 100]: señal técnica ajustada por riesgo. */
  score: number;
  signal: Recommendation['action'];
  confidence: number;
  riskLevel: RiskLevel;
  rationale: string;
}

export interface PositionAdvice {
  assetId: AssetId;
  amount: number;
  valueUsd: number;
  weightPct: number;
  action: PositionAction;
  /** Destino propuesto en una rotación o entrada. */
  target?: CoinId;
  headline: string;
  detail: string;
  score: number | null;
}

export interface PortfolioReport {
  totalValueUsd: number;
  cryptoValueUsd: number;
  stableValueUsd: number;
  /** Exposición a cripto sobre el total, en porcentaje. */
  exposurePct: number;
  positions: PositionAdvice[];
  scores: AssetScore[];
  best: AssetScore | null;
  warnings: string[];
  generatedAt: number;
}

export interface AnalysisInput {
  recommendation: Recommendation;
  risk: RiskAssessment;
}

/**
 * Umbrales de decisión. Se eligen conservadores a propósito: rotar tiene un
 * coste real (comisiones, spread, posible evento fiscal) que este modelo no
 * puede cuantificar, así que solo se propone un cambio cuando la ventaja del
 * destino es amplia, no marginal.
 */
const EXIT_THRESHOLD = -20; // por debajo, la posición deja de compensar
const ENTER_THRESHOLD = 25; // mínimo para justificar entrar desde USDT
const ROTATION_MARGIN = 25; // ventaja mínima del destino sobre el origen

/**
 * Puntúa el atractivo de una moneda combinando la señal de la estrategia con
 * el riesgo sistemático. Sin señal confirmada se puntúa solo la inercia de la
 * tendencia diaria, y con menos peso: una tendencia no es una señal.
 */
export function scoreAsset(coinId: CoinId, analysis: AnalysisInput): AssetScore {
  const { recommendation, risk } = analysis;
  const daily = recommendation.timeframes.find((t) => t.timeframe === '1D');
  let score: number;
  let rationale: string;

  if (recommendation.action === 'BUY') {
    score = recommendation.confidence;
    rationale = 'Señal de compra confirmada por la estrategia MACD + RSI.';
  } else if (recommendation.action === 'SELL') {
    score = -recommendation.confidence;
    rationale = 'Señal de venta confirmada por la estrategia MACD + RSI.';
  } else {
    score = 0;
    const parts: string[] = [];
    if (daily?.snapshot.aboveZeroLine === true) {
      score += 12;
      parts.push('MACD diario sobre el nivel cero');
    } else if (daily?.snapshot.aboveZeroLine === false) {
      score -= 12;
      parts.push('MACD diario bajo el nivel cero');
    }
    const rsi = daily?.snapshot.rsi;
    if (rsi != null && rsi > 55) {
      score += 8;
      parts.push(`RSI diario en ${rsi.toFixed(0)}`);
    } else if (rsi != null && rsi < 45) {
      score -= 8;
      parts.push(`RSI diario en ${rsi.toFixed(0)}`);
    }
    rationale =
      parts.length > 0
        ? `Sin señal confirmada; solo inercia de tendencia (${parts.join(', ')}).`
        : 'Sin señal confirmada ni tendencia definida.';
  }

  // El riesgo penaliza a partir del punto medio de la escala 1-5. Un activo
  // atractivo pero en condiciones extremas deja de serlo.
  const riskPenalty = Math.max(0, risk.rawScore - 3) * 12;
  if (Math.round(riskPenalty) >= 1) {
    rationale += ` Penalización por riesgo ${risk.level}/5 (−${Math.round(riskPenalty)}).`;
  }

  return {
    coinId,
    score: clamp(Math.round(score - riskPenalty), -100, 100),
    signal: recommendation.action,
    confidence: recommendation.confidence,
    riskLevel: risk.level,
    rationale,
  };
}

export interface BuildReportInput {
  markets: CoinMarket[];
  analyses: Partial<Record<CoinId, AnalysisInput>>;
  /** Cantidades introducidas por el usuario, en unidades del activo. */
  holdings: Partial<Record<AssetId, number>>;
  symbolOf: (coinId: CoinId) => string;
}

export function buildPortfolioReport({
  markets,
  analyses,
  holdings,
  symbolOf,
}: BuildReportInput): PortfolioReport {
  const priceOf = new Map(markets.map((m) => [m.id, m.price] as const));

  const scores: AssetScore[] = [];
  for (const market of markets) {
    const analysis = analyses[market.id];
    if (analysis) scores.push(scoreAsset(market.id, analysis));
  }
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const best = ranked[0] ?? null;

  const stableAmount = holdings[STABLE_ID] ?? 0;
  const stableValueUsd = stableAmount; // paridad asumida 1:1 con el dólar
  let cryptoValueUsd = 0;

  const heldCoins = markets.filter((m) => (holdings[m.id] ?? 0) > 0);
  for (const market of heldCoins) {
    cryptoValueUsd += (holdings[market.id] ?? 0) * (priceOf.get(market.id) ?? 0);
  }
  const totalValueUsd = cryptoValueUsd + stableValueUsd;

  const positions: PositionAdvice[] = [];

  for (const market of heldCoins) {
    const amount = holdings[market.id] ?? 0;
    const valueUsd = amount * (priceOf.get(market.id) ?? 0);
    const own = scores.find((s) => s.coinId === market.id) ?? null;
    const symbol = symbolOf(market.id);

    if (!own) {
      positions.push({
        assetId: market.id,
        amount,
        valueUsd,
        weightPct: pct(valueUsd, totalValueUsd),
        action: 'HOLD',
        headline: `${symbol}: sin análisis disponible`,
        detail:
          'No se pudo calcular la señal técnica de este activo, así que no se emite recomendación sobre la posición.',
        score: null,
      });
      continue;
    }

    // Un destino solo es candidato si además de puntuar mejor supera por sí
    // mismo el umbral de entrada: rotar hacia "el menos malo" no es una mejora.
    const candidate =
      best && best.coinId !== market.id && best.score >= ENTER_THRESHOLD ? best : null;
    const rotationGain = candidate ? candidate.score - own.score : 0;
    const shouldRotate = candidate !== null && rotationGain >= ROTATION_MARGIN;

    if (own.score < EXIT_THRESHOLD) {
      if (shouldRotate && candidate) {
        positions.push({
          assetId: market.id,
          amount,
          valueUsd,
          weightPct: pct(valueUsd, totalValueUsd),
          action: 'ROTATE',
          target: candidate.coinId,
          headline: `Rotar ${symbol} → ${symbolOf(candidate.coinId)}`,
          detail: `${symbol} puntúa ${own.score} y ${symbolOf(candidate.coinId)} puntúa ${candidate.score} (ventaja de ${rotationGain} puntos). ${own.rationale}`,
          score: own.score,
        });
      } else {
        positions.push({
          assetId: market.id,
          amount,
          valueUsd,
          weightPct: pct(valueUsd, totalValueUsd),
          action: 'TO_USDT',
          headline: `Pasar ${symbol} a USDT`,
          detail: `${symbol} puntúa ${own.score}, por debajo del umbral de salida (${EXIT_THRESHOLD}), y ninguna alternativa cubierta supera el umbral de entrada. ${own.rationale}`,
          score: own.score,
        });
      }
      continue;
    }

    if (shouldRotate && candidate) {
      positions.push({
        assetId: market.id,
        amount,
        valueUsd,
        weightPct: pct(valueUsd, totalValueUsd),
        action: 'ROTATE',
        target: candidate.coinId,
        headline: `Considerar rotar ${symbol} → ${symbolOf(candidate.coinId)}`,
        detail: `La posición aguanta (${own.score}), pero ${symbolOf(candidate.coinId)} puntúa ${candidate.score}: ${rotationGain} puntos de ventaja. Solo compensa si el margen supera tus costes de operación.`,
        score: own.score,
      });
      continue;
    }

    positions.push({
      assetId: market.id,
      amount,
      valueUsd,
      weightPct: pct(valueUsd, totalValueUsd),
      action: 'HOLD',
      headline: `Mantener ${symbol}`,
      detail: `${own.rationale} Ninguna alternativa cubierta supera a ${symbol} por el margen mínimo de ${ROTATION_MARGIN} puntos.`,
      score: own.score,
    });
  }

  if (stableAmount > 0) {
    const worthEntering = best !== null && best.score >= ENTER_THRESHOLD;
    positions.push({
      assetId: STABLE_ID,
      amount: stableAmount,
      valueUsd: stableValueUsd,
      weightPct: pct(stableValueUsd, totalValueUsd),
      action: worthEntering ? 'ENTER' : 'STAY_USDT',
      ...(worthEntering && best ? { target: best.coinId } : {}),
      headline:
        worthEntering && best
          ? `Entrar en ${symbolOf(best.coinId)} desde USDT`
          : 'Mantener el USDT al margen',
      detail:
        worthEntering && best
          ? `${symbolOf(best.coinId)} es el activo mejor puntuado (${best.score}). ${best.rationale}`
          : `Ningún activo cubierto alcanza el umbral de entrada (${ENTER_THRESHOLD}). Sin señal clara, la liquidez es una posición legítima.`,
      score: best?.score ?? null,
    });
  }

  const warnings: string[] = [];
  if (scores.length > 0 && scores.every((s) => s.score < EXIT_THRESHOLD)) {
    warnings.push(
      'Los tres activos cubiertos puntúan por debajo del umbral de salida: el conjunto del mercado seguido está débil.',
    );
  }
  if (positions.some((p) => p.action === 'ROTATE' || p.action === 'TO_USDT' || p.action === 'ENTER')) {
    warnings.push(
      'El modelo no descuenta comisiones, spread, deslizamiento ni impacto fiscal. Una rotación cuyo margen no supere esos costes destruye valor aunque la señal acierte.',
    );
  }
  if (heldCoins.length === 1 && stableAmount === 0) {
    warnings.push(
      'Toda la cartera está en un único activo: el riesgo específico de ese activo es el riesgo de toda tu posición.',
    );
  }
  if (scores.length < markets.length) {
    warnings.push(
      'Falta el análisis de algún activo: las comparaciones se hacen solo entre los que sí tienen señal calculada.',
    );
  }

  return {
    totalValueUsd,
    cryptoValueUsd,
    stableValueUsd,
    exposurePct: pct(cryptoValueUsd, totalValueUsd),
    positions,
    scores: ranked,
    best,
    warnings,
    generatedAt: Date.now(),
  };
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Cantidad válida: cifras con un único separador decimal, coma o punto. Se
 * prohíbe el separador de millares a propósito, porque en español "1.500" es
 * ambiguo (mil quinientos o uno coma cinco) y un error de escala en una
 * cantidad de cripto es un error de dinero. El valor en dólares se muestra
 * junto al campo para que el usuario detecte de inmediato una mala lectura.
 */
const AMOUNT_PATTERN = /^\d*(?:[.,]\d*)?$/;

export function isValidAmountInput(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === '' || AMOUNT_PATTERN.test(trimmed);
}

/**
 * Forma canónica de la cantidad, como cadena.
 *
 * Es lo que se envía a la base y lo que se compara para saber si hay cambios
 * pendientes. Nunca pasa por un `number`: convertir "0,8" a double y volver a
 * texto produce "0.800000000000000044", que es exactamente el error de
 * precisión que la columna numeric existe para evitar. El double sigue
 * usándose para valorar y graficar, donde el error es irrelevante, pero no
 * para lo que se persiste.
 */
export function toDecimalString(raw: string): string {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '' || !AMOUNT_PATTERN.test(trimmed)) return '0';

  const [rawInteger = '', rawFraction = ''] = trimmed.split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.replace(/0+$/, '');
  return fraction === '' ? integer : `${integer}.${fraction}`;
}

/**
 * Devuelve 0 para cualquier entrada que el validador rechace, de modo que lo
 * que se marca en rojo y lo que se calcula nunca discrepen.
 */
export function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!AMOUNT_PATTERN.test(trimmed) || trimmed === '') return 0;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
