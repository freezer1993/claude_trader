import type { RiskAssessment, RiskLevel } from '../lib/risk';

const LEVEL_STYLES: Record<RiskLevel, { fill: string; text: string; border: string }> = {
  1: { fill: 'bg-bull-500', text: 'text-bull-400', border: 'border-bull-500/40' },
  2: { fill: 'bg-bull-400', text: 'text-bull-400', border: 'border-bull-400/40' },
  3: { fill: 'bg-warn-400', text: 'text-warn-400', border: 'border-warn-400/40' },
  4: { fill: 'bg-bear-400', text: 'text-bear-400', border: 'border-bear-400/40' },
  5: { fill: 'bg-bear-500', text: 'text-bear-400', border: 'border-bear-500/50' },
};

export function RiskPanel({ risk, compact = false }: { risk: RiskAssessment; compact?: boolean }) {
  const style = LEVEL_STYLES[risk.level];

  return (
    <section
      aria-labelledby="risk-heading"
      className={`rounded-xl border border-ink-700/70 bg-ink-900/60 ${compact ? 'p-4' : 'p-5'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="risk-heading" className="text-sm font-semibold text-white">
            Riesgo sistemático del mercado
          </h2>
          <p className={`mt-1 text-lg font-bold ${style.text}`}>
            {risk.level} / 5 · {risk.label}
          </p>
        </div>
        <span
          className={`rounded-lg border px-3 py-1.5 text-2xl font-black tabular-nums ${style.border} ${style.text}`}
          aria-hidden="true"
        >
          {risk.level}
        </span>
      </div>

      {/* Medidor discreto de 5 segmentos: comunica el nivel de un vistazo. */}
      <div
        role="meter"
        aria-labelledby="risk-heading"
        aria-valuenow={risk.level}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuetext={`Nivel ${risk.level} de 5: ${risk.label}`}
        className="mt-4 flex gap-1.5"
      >
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={`h-2 flex-1 rounded-full transition-colors ${
              step <= risk.level ? style.fill : 'bg-ink-800'
            }`}
          />
        ))}
      </div>

      <p className="mt-3 text-sm text-mist-200">{risk.description}</p>

      {!compact && (
        <dl className="mt-4 space-y-3">
          {risk.factors.map((factor) => (
            <div key={factor.label} className="rounded-lg border border-ink-700/60 bg-ink-850/60 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs font-medium text-mist-200">{factor.label}</dt>
                <dd className="text-xs font-semibold text-white">{factor.display}</dd>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className={`h-full rounded-full ${style.fill}`}
                  style={{ width: `${Math.round(factor.score * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-mist-400">
                {factor.note} · peso {Math.round(factor.weight * 100)} %
              </p>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
