import { formatNumber } from './format';
import { lastDefined, returnStdDev } from './indicators';
import type { RiskAssessment } from './risk';
import type { Recommendation } from './strategy';
import type { CoinId, CoinMarket, PricePoint } from '../types/crypto';

export interface MomentumBreakdown {
  change24hPct: number | null;
  change6hPct: number | null;
  /** Desviación del precio frente a la SMA20 horaria, en porcentaje. */
  sma20hDeviationPct: number | null;
  macd1h: number | null;
  histogram1h: number | null;
  histogramExpanding: boolean | null;
  rsi1h: number | null;
  macd1dAboveZero: boolean | null;
}

export interface ShortTermCandidate {
  coinId: CoinId;
  /** 0-100. Solo mide idoneidad para un impulso corto, no valor a largo plazo. */
  score: number;
  /** true si además supera el filtro de tendencia alcista. */
  rising: boolean;
  reasons: string[];
  blockers: string[];
  momentum: MomentumBreakdown;
  /** Desviación típica de los retornos logarítmicos horarios. */
  hourlySigma: number | null;
  riskLevel: number;
}

export interface TradeTarget {
  price: number;
  rMultiple: number;
  gainPct: number;
}

export interface TradePlan {
  coinId: CoinId;
  entry: number;
  stopLoss: number;
  /** Distancia al stop en porcentaje del precio de entrada. */
  stopDistancePct: number;
  targets: TradeTarget[];
  horizonHours: number;
  capitalUsdt: number;
  riskPerTradePct: number;
  riskAmountUsd: number;
  /** Pérdida real en el stop como porcentaje del saldo; difiere del objetivo si topó la exposición. */
  effectiveRiskPct: number;
  positionUsd: number;
  units: number;
  positionPctOfCapital: number;
  /** true si el tope de exposición recortó el tamaño calculado por riesgo. */
  cappedByExposure: boolean;
  maxLossUsd: number;
  /** Ganancia al alcanzar el objetivo más lejano. */
  maxGainUsd: number;
  riskRewardRatio: number;
}

export interface ShortTermReport {
  candidates: ShortTermCandidate[];
  best: ShortTermCandidate | null;
  plan: TradePlan | null;
  warnings: string[];
  generatedAt: number;
}

export interface ShortTermSettings {
  /** Porcentaje del capital que se acepta perder si salta el stop. */
  riskPerTradePct: number;
  /** Horizonte previsto de la operación, en horas. */
  horizonHours: number;
}

export const DEFAULT_SETTINGS: ShortTermSettings = { riskPerTradePct: 2, horizonHours: 24 };
export const HORIZON_OPTIONS = [12, 24, 72] as const;

/** Ningún plan compromete más de esta fracción del saldo, cueste lo que cueste. */
const MAX_EXPOSURE = 0.35;
/** El stop se sitúa a este múltiplo de la desviación esperada del horizonte. */
const STOP_SIGMA_MULTIPLE = 1.5;
const TARGET_R_MULTIPLES = [1.5, 2.5] as const;
/** Por debajo de esta puntuación no se propone operación alguna. */
const MIN_SCORE = 45;

/**
 * Mínimos del filtro de tendencia alcista. Sin ellos, una moneda que se mueve
 * una centésima de punto por ruido pasaría como "al alza": la comparación
 * estricta contra cero no distingue tendencia de vibración.
 */
const MIN_CHANGE_24H_PCT = 0.5;
const MIN_SMA_DEVIATION_PCT = 0.2;


interface CandidateInput {
  market: CoinMarket;
  recommendation: Recommendation;
  risk: RiskAssessment;
  hourly: PricePoint[] | null;
}

/**
 * Puntúa la idoneidad de una moneda para un impulso corto. Es un criterio
 * distinto al del panel de cartera: allí pesa la señal confirmada y el riesgo
 * estructural, y aquí pesa el momentum reciente. Una moneda puede ser buena
 * para mantener y mala para entrar hoy, y al revés.
 */
export function evaluateShortTerm({
  market,
  recommendation,
  risk,
  hourly,
}: CandidateInput): ShortTermCandidate {
  const hourlySignal = recommendation.timeframes.find((t) => t.timeframe === '1H');
  const dailySignal = recommendation.timeframes.find((t) => t.timeframe === '1D');

  const closes = hourly?.map((p) => p.value) ?? [];
  const change24hPct = pctChangeOverBars(closes, 24);
  const change6hPct = pctChangeOverBars(closes, 6);
  const hourlySigma = closes.length > 169 ? returnStdDev(closes, 168) : returnStdDev(closes, 48);

  const histSeries = hourlySignal?.series.macd.histogram ?? [];
  const histogram1h = lastDefined(histSeries);
  const histogramExpanding = isExpanding(histSeries);

  const momentum: MomentumBreakdown = {
    change24hPct,
    change6hPct,
    sma20hDeviationPct: hourlySignal?.snapshot.sma20DeviationPct ?? null,
    macd1h: hourlySignal?.snapshot.macd ?? null,
    histogram1h,
    histogramExpanding,
    rsi1h: hourlySignal?.snapshot.rsi ?? null,
    macd1dAboveZero: dailySignal?.snapshot.aboveZeroLine ?? null,
  };

  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 0;

  // Momentum reciente: es el ingrediente principal de una operación corta.
  if (change24hPct !== null) {
    const contribution = normalize(change24hPct, 0, 8) * 25;
    score += contribution;
    if (change24hPct > 0.5) reasons.push(`Sube ${formatNumber(change24hPct, 2)} % en 24 h.`);
    else if (change24hPct <= 0) blockers.push(`Cae ${formatNumber(Math.abs(change24hPct), 2)} % en 24 h.`);
  }
  if (change6hPct !== null) {
    score += normalize(change6hPct, 0, 3) * 15;
    if (change6hPct > 0.3) reasons.push(`Impulso reciente: ${formatNumber(change6hPct, 2)} % en 6 h.`);
  }

  // Estructura: precio por encima de su media horaria.
  const dev = momentum.sma20hDeviationPct;
  if (dev !== null && dev > 0) {
    score += 15;
    reasons.push(`Precio un ${formatNumber(dev, 1)} % por encima de su SMA20 horaria.`);
    if (dev > 6) {
      score -= 8;
      blockers.push(`Entrada extendida: ${formatNumber(dev, 1)} % sobre la SMA20 horaria.`);
    }
  } else if (dev !== null) {
    blockers.push(`Precio un ${formatNumber(Math.abs(dev), 1)} % por debajo de su SMA20 horaria.`);
  }

  // MACD horario: signo y, sobre todo, si el histograma se está abriendo.
  if (histogram1h !== null && histogram1h > 0) {
    score += 15;
    reasons.push('Histograma MACD horario en positivo.');
    if (histogramExpanding) {
      score += 5;
      reasons.push('El histograma se expande: el impulso gana fuerza.');
    }
  } else if (histogram1h !== null) {
    blockers.push('Histograma MACD horario en negativo.');
  }

  // RSI horario: se busca fuerza sin sobrecompra. Comprar por encima de 70 es
  // perseguir el movimiento, que es donde más caro sale equivocarse.
  const rsi = momentum.rsi1h;
  if (rsi !== null) {
    if (rsi >= 50 && rsi <= 65) {
      score += 15;
      reasons.push(`RSI horario en ${rsi.toFixed(0)}: zona de fuerza sin sobrecompra.`);
    } else if (rsi > 65 && rsi <= 70) {
      score += 8;
      reasons.push(`RSI horario en ${rsi.toFixed(0)}: fuerte, acercándose a sobrecompra.`);
    } else if (rsi > 70) {
      score -= 15;
      blockers.push(`RSI horario en ${rsi.toFixed(0)}: sobrecompra, riesgo de comprar el techo.`);
    } else if (rsi >= 45) {
      score += 5;
    } else {
      blockers.push(`RSI horario en ${rsi.toFixed(0)}: sin fuerza compradora.`);
    }
  }

  // Alineación con la tendencia diaria: operar a favor del marco mayor.
  if (momentum.macd1dAboveZero === true) {
    score += 10;
    reasons.push('MACD diario sobre el nivel cero: el marco mayor acompaña.');
  } else if (momentum.macd1dAboveZero === false) {
    blockers.push('MACD diario bajo el nivel cero: se operaría contra el marco mayor.');
  }

  if (recommendation.action === 'BUY') {
    score += 10;
    reasons.push('La estrategia MACD + RSI ya emite señal de compra.');
  } else if (recommendation.action === 'SELL') {
    score -= 20;
    blockers.push('La estrategia MACD + RSI emite señal de venta.');
  }

  if (risk.rawScore > 3) {
    const penalty = (risk.rawScore - 3) * 8;
    score -= penalty;
    // Una penalización que redondea a cero no es un bloqueo: listarla sugiere
    // un descuento que no se ha aplicado.
    if (Math.round(penalty) >= 1) {
      blockers.push(`Riesgo ${risk.level}/5 (−${Math.round(penalty)} puntos).`);
    }
  }

  if (hourlySignal?.ranging) {
    score -= 10;
    blockers.push('Mercado lateral en 1 h: alta probabilidad de señal falsa.');
  }

  // El filtro de "al alza" es independiente de la puntuación: exige que la
  // moneda esté subiendo de verdad, no solo que puntúe mejor que las demás.
  /*
   * Filtro de tendencia alcista.
   *
   * Usa el signo de la línea MACD (EMA12 sobre EMA26), no el del histograma:
   * en una tendencia sostenida y regular el histograma converge a cero porque
   * mide la *aceleración* del impulso, no el impulso. Exigirlo positivo
   * rechazaría justo las tendencias más limpias. La expansión del histograma
   * sí suma puntuación, como bonificación.
   *
   * Tampoco exige que las últimas horas sean positivas: un retroceso dentro de
   * una tendencia alcista es mejor entrada que comprar el último tramo de
   * subida, que es la conducta que ya penaliza el tramo de RSI en sobrecompra.
   */
  const checks: { ok: boolean; failure: string }[] = [
    {
      ok: (change24hPct ?? -1) >= MIN_CHANGE_24H_PCT,
      failure: `Sube menos del ${MIN_CHANGE_24H_PCT} % exigido en 24 h${
        change24hPct !== null ? ` (${formatNumber(change24hPct, 2)} %)` : ''
      }.`,
    },
    {
      ok: (dev ?? -1) >= MIN_SMA_DEVIATION_PCT,
      failure: `No se sostiene por encima de su SMA20 horaria con holgura${
        dev !== null ? ` (${formatNumber(dev, 2)} %)` : ''
      }.`,
    },
    {
      ok: (momentum.macd1h ?? -1) > 0,
      failure: 'La línea MACD horaria está por debajo de cero: no hay tendencia alcista de fondo.',
    },
    {
      ok: rsi !== null && rsi >= 45 && rsi <= 72,
      failure: `RSI horario fuera de la banda operable 45-72${
        rsi !== null ? ` (${rsi.toFixed(0)})` : ''
      }.`,
    },
  ];

  const rising = checks.every((check) => check.ok);
  for (const check of checks) {
    if (!check.ok && !blockers.some((b) => b === check.failure)) blockers.push(check.failure);
  }

  return {
    coinId: market.id,
    score: clamp(Math.round(score), 0, 100),
    rising,
    reasons,
    blockers,
    momentum,
    hourlySigma,
    riskLevel: risk.level,
  };
}

/**
 * Dimensiona la posición por riesgo fijo: se decide primero cuánto se está
 * dispuesto a perder y el tamaño sale de la distancia al stop. Un porcentaje
 * fijo del saldo ignoraría que una moneda volátil necesita más margen y expone
 * mucho más capital real al mismo movimiento adverso.
 */
export function buildTradePlan(
  candidate: ShortTermCandidate,
  price: number,
  capitalUsdt: number,
  settings: ShortTermSettings,
): TradePlan | null {
  const sigma = candidate.hourlySigma;
  if (sigma === null || sigma <= 0 || price <= 0) return null;

  // Escalado temporal de la volatilidad: σ del horizonte = σ horaria × √horas.
  const horizonSigma = sigma * Math.sqrt(settings.horizonHours);
  const stopDistancePct = clamp(STOP_SIGMA_MULTIPLE * horizonSigma * 100, 0.5, 25);
  const stopLoss = price * (1 - stopDistancePct / 100);

  const riskAmountUsd = capitalUsdt * (settings.riskPerTradePct / 100);
  const sizedByRisk = riskAmountUsd / (stopDistancePct / 100);
  const exposureCap = capitalUsdt * MAX_EXPOSURE;
  const positionUsd = Math.min(sizedByRisk, exposureCap, capitalUsdt);
  const cappedByExposure = sizedByRisk > exposureCap && capitalUsdt > 0;

  const targets: TradeTarget[] = TARGET_R_MULTIPLES.map((rMultiple) => {
    const gainPct = stopDistancePct * rMultiple;
    return { price: price * (1 + gainPct / 100), rMultiple, gainPct };
  });

  const maxLossUsd = positionUsd * (stopDistancePct / 100);
  const lastTarget = targets[targets.length - 1];
  const maxGainUsd = lastTarget ? positionUsd * (lastTarget.gainPct / 100) : 0;

  return {
    coinId: candidate.coinId,
    entry: price,
    stopLoss,
    stopDistancePct,
    targets,
    horizonHours: settings.horizonHours,
    capitalUsdt,
    riskPerTradePct: settings.riskPerTradePct,
    riskAmountUsd,
    effectiveRiskPct: capitalUsdt > 0 ? (maxLossUsd / capitalUsdt) * 100 : 0,
    positionUsd,
    units: price > 0 ? positionUsd / price : 0,
    positionPctOfCapital: capitalUsdt > 0 ? (positionUsd / capitalUsdt) * 100 : 0,
    cappedByExposure,
    maxLossUsd,
    maxGainUsd,
    riskRewardRatio: lastTarget?.rMultiple ?? 0,
  };
}

export interface BuildShortTermInput {
  markets: CoinMarket[];
  analyses: Partial<Record<CoinId, { recommendation: Recommendation; risk: RiskAssessment }>>;
  hourlySeries: Partial<Record<CoinId, PricePoint[] | null>>;
  capitalUsdt: number;
  settings: ShortTermSettings;
}

export function buildShortTermReport({
  markets,
  analyses,
  hourlySeries,
  capitalUsdt,
  settings,
}: BuildShortTermInput): ShortTermReport {
  const candidates: ShortTermCandidate[] = [];
  for (const market of markets) {
    const analysis = analyses[market.id];
    if (!analysis) continue;
    candidates.push(
      evaluateShortTerm({
        market,
        recommendation: analysis.recommendation,
        risk: analysis.risk,
        hourly: hourlySeries[market.id] ?? null,
      }),
    );
  }
  candidates.sort((a, b) => b.score - a.score);

  // Solo es candidato el que además sube: el usuario pide una moneda al alza,
  // y "la mejor de tres que caen" no lo es.
  const eligible = candidates.filter((c) => c.rising && c.score >= MIN_SCORE);
  const best = eligible[0] ?? null;

  const warnings: string[] = [];
  if (candidates.length === 0) {
    warnings.push('Sin análisis disponible: no se puede evaluar ninguna oportunidad.');
  } else if (!best) {
    const rising = candidates.filter((c) => c.rising);
    warnings.push(
      rising.length === 0
        ? 'Ninguno de los tres activos cubiertos está al alza según el filtro de tendencia. No operar es una decisión válida.'
        : `Hay activos al alza, pero ninguno alcanza la puntuación mínima de ${MIN_SCORE}. La señal es demasiado débil para justificar una entrada.`,
    );
  }

  const price = best ? (markets.find((m) => m.id === best.coinId)?.price ?? 0) : 0;
  const plan = best && capitalUsdt > 0 ? buildTradePlan(best, price, capitalUsdt, settings) : null;

  if (best && capitalUsdt <= 0) {
    warnings.push(
      'Introduce tu saldo en USDT en el panel de cartera para calcular cuánto invertir.',
    );
  }
  if (best && capitalUsdt > 0 && !plan) {
    warnings.push(
      'No hay suficiente histórico horario para estimar la volatilidad, así que no se dimensiona la posición.',
    );
  }
  if (plan?.cappedByExposure) {
    warnings.push(
      `El tamaño lo limita el tope de exposición del ${Math.round(MAX_EXPOSURE * 100)} % del saldo, no tu riesgo por operación. Con este stop, arriesgar el ${plan.riskPerTradePct} % exigiría una posición mayor.`,
    );
  }
  if (plan) {
    warnings.push(
      'El plan no descuenta comisiones ni deslizamiento, y da por hecho que el stop se ejecuta al precio indicado. En un hueco de mercado la pérdida real puede superar la calculada.',
    );
  }

  return { candidates, best, plan, warnings, generatedAt: Date.now() };
}

/** Variación porcentual respecto al cierre de hace `bars` velas. */
function pctChangeOverBars(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  const last = closes[closes.length - 1];
  const past = closes[closes.length - 1 - bars];
  if (last === undefined || past === undefined || past <= 0) return null;
  return ((last - past) / past) * 100;
}

/** El histograma se expande si sus tres últimos valores crecen en magnitud con signo positivo. */
function isExpanding(series: (number | null)[]): boolean | null {
  const values: number[] = [];
  for (let i = series.length - 1; i >= 0 && values.length < 3; i -= 1) {
    const v = series[i];
    if (v !== null && v !== undefined) values.push(v);
  }
  if (values.length < 3) return null;
  const [latest, prev, older] = values as [number, number, number];
  return latest > prev && prev > older;
}

function normalize(value: number, low: number, high: number): number {
  if (high <= low) return 0;
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
