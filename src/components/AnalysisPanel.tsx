import { formatNumber } from '../lib/format';
import type { Recommendation, SignalAction, TimeframeSignal } from '../lib/strategy';

const ACTION_STYLES: Record<SignalAction, { chip: string; bar: string; text: string; label: string }> = {
  BUY: {
    chip: 'border-bull-500/40 bg-bull-500/10 text-bull-400',
    bar: 'bg-bull-500',
    text: 'text-bull-400',
    label: 'COMPRA',
  },
  SELL: {
    chip: 'border-bear-500/40 bg-bear-500/10 text-bear-400',
    bar: 'bg-bear-500',
    text: 'text-bear-400',
    label: 'VENTA',
  },
  WAIT: {
    chip: 'border-warn-400/40 bg-warn-400/10 text-warn-400',
    bar: 'bg-warn-400',
    text: 'text-warn-400',
    label: 'ESPERAR',
  },
};

export function AnalysisPanel({ recommendation }: { recommendation: Recommendation }) {
  const style = ACTION_STYLES[recommendation.action];

  return (
    <section
      aria-labelledby="analysis-heading"
      className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analysis-heading" className="text-sm font-semibold text-white">
            Recomendación diaria · Estrategia MACD + RSI
          </h2>
          <p className={`mt-1 text-lg font-bold ${style.text}`}>{recommendation.headline}</p>
        </div>
        <span
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wide ${style.chip}`}
        >
          {style.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-mist-200">{recommendation.detail}</p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-mist-400">
          <span id="confidence-label">Confianza de la señal</span>
          <span className="font-semibold text-mist-200">{recommendation.confidence} / 100</span>
        </div>
        <div
          role="meter"
          aria-labelledby="confidence-label"
          aria-valuenow={recommendation.confidence}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink-800"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${style.bar}`}
            style={{ width: `${recommendation.confidence}%` }}
          />
        </div>
      </div>

      {recommendation.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-lg border border-warn-400/25 bg-warn-400/5 p-3 text-xs text-warn-400">
          {recommendation.warnings.map((warning, index) => (
            <li key={`${index}-${warning.slice(0, 24)}`} className="flex gap-2">
              <span aria-hidden="true">⚠</span>
              <span className="text-mist-200">{warning}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {recommendation.timeframes.map((signal) => (
          <TimeframeCard key={signal.timeframe} signal={signal} />
        ))}
      </div>

      <p className="mt-5 border-t border-ink-700/60 pt-3 text-[11px] leading-relaxed text-mist-400">
        Análisis técnico automatizado con fines informativos. No constituye asesoramiento financiero
        ni una recomendación de inversión; los cruces de indicadores generan señales falsas con
        frecuencia, especialmente en mercados laterales.
      </p>
    </section>
  );
}

function TimeframeCard({ signal }: { signal: TimeframeSignal }) {
  const style = ACTION_STYLES[signal.action];
  const label = signal.timeframe === '1D' ? 'Temporalidad diaria (1D)' : 'Temporalidad 1 hora (1H)';

  return (
    <article className="rounded-lg border border-ink-700/70 bg-ink-850/60 p-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-mist-200 uppercase">{label}</h3>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${style.chip}`}>
          {style.label}
        </span>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <Metric label="RSI (14)" value={signal.snapshot.rsi !== null ? formatNumber(signal.snapshot.rsi, 1) : 'n/d'} />
        <Metric
          label="MACD"
          value={signal.snapshot.macd !== null ? formatNumber(signal.snapshot.macd, 2) : 'n/d'}
        />
        <Metric
          label="Señal"
          value={signal.snapshot.signal !== null ? formatNumber(signal.snapshot.signal, 2) : 'n/d'}
        />
        <Metric
          label="Histograma"
          value={
            signal.snapshot.histogram !== null ? formatNumber(signal.snapshot.histogram, 2) : 'n/d'
          }
          tone={
            signal.snapshot.histogram === null
              ? undefined
              : signal.snapshot.histogram >= 0
                ? 'bull'
                : 'bear'
          }
        />
        <Metric
          label="Nivel cero"
          value={
            signal.snapshot.aboveZeroLine === null
              ? 'n/d'
              : signal.snapshot.aboveZeroLine
                ? 'MACD por encima'
                : 'MACD por debajo'
          }
        />
        <Metric
          label="Precio vs. SMA20"
          value={
            signal.snapshot.sma20DeviationPct !== null
              ? `${signal.snapshot.sma20DeviationPct >= 0 ? '+' : ''}${formatNumber(signal.snapshot.sma20DeviationPct, 1)} %`
              : 'n/d'
          }
        />
      </dl>

      <ul className="mt-3 space-y-1.5 text-xs text-mist-400">
        {signal.reasons.map((reason, index) => (
          <li key={`${signal.timeframe}-${index}`} className="flex gap-2">
            <span aria-hidden="true" className="text-mist-400">
              ·
            </span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-mist-400">
        {signal.bars} velas analizadas · fuerza {signal.strength}/100
        {signal.ranging ? ' · mercado lateral' : ''}
      </p>
    </article>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'bull' | 'bear';
}) {
  const toneClass = tone === 'bull' ? 'text-bull-400' : tone === 'bear' ? 'text-bear-400' : 'text-mist-200';
  return (
    <div>
      <dt className="text-mist-400">{label}</dt>
      <dd className={`font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}
