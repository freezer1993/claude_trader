const LOCALE = 'es-ES';

/** Las altcoins de bajo precio necesitan más decimales que BTC para ser legibles. */
export function formatPrice(value: number): string {
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : 6;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * La notación compacta con `style: 'currency'` produce en es-ES cadenas
 * ilegibles ("42 mil MUS$"), así que se compacta el número y el símbolo se
 * añade aparte.
 */
export function formatCompactUsd(value: number): string {
  const compact = new Intl.NumberFormat(LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
  return `${compact} US$`;
}

export function formatPercent(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value, digits)} %`;
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatTime(epochMs: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(epochMs));
}

export function formatRelative(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}
