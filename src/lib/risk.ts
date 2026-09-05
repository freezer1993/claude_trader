import { lastDefined, returnStdDev, sma } from './indicators';
import type { CoinMarket, PricePoint } from '../types/crypto';

export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export interface RiskFactor {
  label: string;
  /** Valor legible ya formateado. */
  display: string;
  /** Contribución normalizada 0-1 al score final. */
  score: number;
  weight: number;
  note: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  label: string;
  description: string;
  /** Score continuo 1-5 antes de redondear, útil para el medidor. */
  rawScore: number;
  factors: RiskFactor[];
}

const LEVEL_LABELS: Record<RiskLevel, { label: string; description: string }> = {
  1: {
    label: 'Muy bajo',
    description:
      'Mercado tranquilo y precio próximo a sus medias. Entorno favorable para operar el sistema con tamaño normal.',
  },
  2: {
    label: 'Bajo',
    description: 'Volatilidad contenida y desviaciones moderadas. Riesgo asumible con gestión estándar.',
  },
  3: {
    label: 'Moderado',
    description:
      'Volatilidad por encima de la media o precio despegado de sus medias. Reduce el tamaño de posición y ajusta stops.',
  },
  4: {
    label: 'Alto',
    description:
      'Rango diario amplio y fuerte desviación frente a las medias móviles. Alta probabilidad de barridos de stop.',
  },
  5: {
    label: 'Extremo',
    description:
      'Condiciones de mercado extremas: volatilidad y extensión simultáneas. Prioriza la preservación de capital sobre la señal técnica.',
  },
};

/**
 * Score de riesgo 1-5 como media ponderada de cuatro factores normalizados.
 * Se separan volatilidad *realizada* (rango 24h y σ de 30 sesiones) de
 * *extensión* (desviación frente a SMA20/SMA50), porque un mercado puede ser
 * peligroso por moverse mucho o por estar demasiado lejos de su media.
 */
export function assessRisk(market: CoinMarket, dailySeries: PricePoint[] | null): RiskAssessment {
  const factors: RiskFactor[] = [];

  // 1. Rango intradía 24h: (high - low) / precio. 0 % → 0, ≥12 % → 1.
  const range24hPct =
    market.price > 0 && market.high24h > 0 && market.low24h > 0
      ? ((market.high24h - market.low24h) / market.price) * 100
      : 0;
  factors.push({
    label: 'Rango de 24 h',
    display: `${range24hPct.toFixed(2)} %`,
    score: normalize(range24hPct, 1.5, 12),
    weight: 0.3,
    note: 'Amplitud entre máximo y mínimo de las últimas 24 horas respecto al precio actual.',
  });

  // 2. Magnitud del movimiento de 24h, independientemente del signo.
  const absChange = Math.abs(market.change24hPct);
  factors.push({
    label: 'Variación de 24 h',
    display: `${market.change24hPct >= 0 ? '+' : ''}${market.change24hPct.toFixed(2)} %`,
    score: normalize(absChange, 1, 10),
    weight: 0.2,
    note: 'Desplazamiento neto del precio en la última sesión de 24 horas.',
  });

  const closes = dailySeries?.map((p) => p.value) ?? [];

  // 3. Volatilidad anualizada de 30 sesiones (σ diaria × √365).
  const sigma = closes.length > 31 ? returnStdDev(closes, 30) : null;
  const annualizedPct = sigma !== null ? sigma * Math.sqrt(365) * 100 : null;
  factors.push({
    label: 'Volatilidad anualizada (30 d)',
    display: annualizedPct !== null ? `${annualizedPct.toFixed(1)} %` : 'sin datos',
    score: annualizedPct !== null ? normalize(annualizedPct, 30, 110) : 0.5,
    weight: 0.25,
    note:
      annualizedPct !== null
        ? 'Desviación típica de los retornos logarítmicos diarios, escalada a un año.'
        : 'Serie diaria no disponible: se asume riesgo medio para este factor.',
  });

  // 4. Extensión frente a medias móviles: se toma la mayor de las dos desviaciones.
  const sma20 = lastDefined(sma(closes, 20));
  const sma50 = lastDefined(sma(closes, 50));
  const dev20 = sma20 && sma20 > 0 ? ((market.price - sma20) / sma20) * 100 : null;
  const dev50 = sma50 && sma50 > 0 ? ((market.price - sma50) / sma50) * 100 : null;
  const maxDeviation = Math.max(Math.abs(dev20 ?? 0), Math.abs(dev50 ?? 0));
  const hasMa = dev20 !== null || dev50 !== null;
  factors.push({
    label: 'Desviación vs. medias móviles',
    display: hasMa
      ? `SMA20 ${formatSigned(dev20)} · SMA50 ${formatSigned(dev50)}`
      : 'sin datos',
    score: hasMa ? normalize(maxDeviation, 2, 25) : 0.5,
    weight: 0.25,
    note: hasMa
      ? 'Cuanto más lejos cotiza el precio de sus medias, mayor es la tensión y el riesgo de reversión.'
      : 'Serie diaria no disponible: se asume riesgo medio para este factor.',
  });

  const weighted = factors.reduce((acc, f) => acc + f.score * f.weight, 0);
  const totalWeight = factors.reduce((acc, f) => acc + f.weight, 0);
  const rawScore = 1 + (weighted / totalWeight) * 4;
  const level = clampLevel(Math.round(rawScore));

  return {
    level,
    label: LEVEL_LABELS[level].label,
    description: LEVEL_LABELS[level].description,
    rawScore,
    factors,
  };
}

/** Mapea un valor a 0-1 con saturación en los extremos indicados. */
function normalize(value: number, low: number, high: number): number {
  if (high <= low) return 0;
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

function formatSigned(value: number | null): string {
  if (value === null) return 'n/d';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} %`;
}

function clampLevel(value: number): RiskLevel {
  return Math.min(5, Math.max(1, value)) as RiskLevel;
}
