import { COIN_META, useCoins } from '../context/CoinContext';
import { formatNumber, formatPrice, formatRelative } from '../lib/format';
import { HORIZON_OPTIONS, type ShortTermCandidate, type TradePlan } from '../lib/shortTerm';
import { Spinner } from './Spinner';

export function ShortTermPanel() {
  const { shortTerm, shortTermSettings, setShortTermSettings, hasHoldings, analysisLoading } =
    useCoins();

  return (
    <section
      aria-labelledby="shortterm-heading"
      className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="shortterm-heading" className="text-sm font-semibold text-white">
            Oportunidad a corto plazo
          </h2>
          <p className="mt-1 text-xs text-mist-400">
            Busca la cripto con mejor impulso alcista ahora mismo y calcula cuánto invertir de tu
            saldo en USDT.
          </p>
        </div>
        <Controls
          riskPerTradePct={shortTermSettings.riskPerTradePct}
          horizonHours={shortTermSettings.horizonHours}
          onChange={setShortTermSettings}
        />
      </header>

      {!hasHoldings ? (
        <p className="mt-4 rounded-lg border border-ink-700/60 bg-ink-850/40 p-4 text-sm text-mist-400">
          Introduce alguna tenencia o tu saldo en USDT para que se descarguen las series y se
          evalúe la oportunidad.
        </p>
      ) : analysisLoading || !shortTerm ? (
        <div className="mt-4">
          <Spinner label="Evaluando el impulso de las tres monedas…" />
        </div>
      ) : (
        <>
          {shortTerm.best ? (
            <Recommendation candidate={shortTerm.best} plan={shortTerm.plan} />
          ) : (
            <div className="mt-4 rounded-lg border border-warn-400/30 bg-warn-400/5 p-4">
              <p className="text-sm font-semibold text-warn-400">Sin oportunidad clara</p>
              <p className="mt-1 text-sm text-mist-200">
                No se propone ninguna entrada. Forzar una operación cuando el filtro no se cumple
                es la forma más rápida de perder dinero con este sistema.
              </p>
            </div>
          )}

          <div className="mt-5">
            <h3 className="text-xs font-semibold tracking-wide text-mist-200 uppercase">
              Impulso por activo
            </h3>
            <ul className="mt-2 space-y-2">
              {shortTerm.candidates.map((candidate) => (
                <CandidateRow key={candidate.coinId} candidate={candidate} />
              ))}
            </ul>
          </div>

          {shortTerm.warnings.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-lg border border-warn-400/25 bg-warn-400/5 p-3 text-xs">
              {shortTerm.warnings.map((warning, index) => (
                <li key={index} className="flex gap-2">
                  <span aria-hidden="true" className="text-warn-400">⚠</span>
                  <span className="text-mist-200">{warning}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 border-t border-ink-700/60 pt-3 text-[11px] leading-relaxed text-mist-400">
            Evaluado {formatRelative(shortTerm.generatedAt)}. El corto plazo es el régimen donde
            los indicadores técnicos fallan más: el plan es un marco de gestión de riesgo, no una
            previsión de beneficio. No es asesoramiento financiero.
          </p>
        </>
      )}
    </section>
  );
}

function Recommendation({
  candidate,
  plan,
}: {
  candidate: ShortTermCandidate;
  plan: TradePlan | null;
}) {
  const meta = COIN_META[candidate.coinId];

  return (
    <div className="mt-4 rounded-lg border border-bull-500/40 bg-bull-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-full"
            style={{ backgroundColor: meta.accent }}
          />
          <div>
            <p className="text-base font-bold text-white">
              {meta.name} <span className="text-mist-400">({meta.symbol})</span>
            </p>
            <p className="text-xs text-mist-400">
              Impulso {candidate.score}/100 · riesgo {candidate.riskLevel}/5
            </p>
          </div>
        </div>
        <span className="rounded-lg border border-bull-500/40 bg-bull-500/10 px-3 py-1.5 text-xs font-bold text-bull-400">
          CANDIDATO AL ALZA
        </span>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-mist-200">
        {candidate.reasons.map((reason, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden="true" className="text-bull-400">✓</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      {candidate.blockers.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-warn-400">
          {candidate.blockers.map((blocker, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden="true">!</span>
              <span>{blocker}</span>
            </li>
          ))}
        </ul>
      )}

      {plan ? <Plan plan={plan} symbol={meta.symbol} /> : null}
    </div>
  );
}

function Plan({ plan, symbol }: { plan: TradePlan; symbol: string }) {
  return (
    <div className="mt-4 border-t border-bull-500/20 pt-4">
      <p className="text-xs font-semibold tracking-wide text-mist-200 uppercase">
        Cuánto invertir
      </p>

      <div className="mt-2 rounded-lg border border-ink-600 bg-ink-950/60 p-4">
        <p className="text-2xl font-black text-white">{formatPrice(plan.positionUsd)}</p>
        <p className="mt-0.5 text-sm text-mist-200">
          ≈ {formatNumber(plan.units, plan.units < 1 ? 6 : 4)} {symbol} ·{' '}
          {formatNumber(plan.positionPctOfCapital, 1)} % de tus {formatPrice(plan.capitalUsdt)} en
          USDT
        </p>
        <p className="mt-1 text-[11px] text-mist-400">
          Tamaño calculado para que, si salta el stop, pierdas el{' '}
          {formatNumber(plan.effectiveRiskPct, 2)} % de tu saldo
          {Math.abs(plan.effectiveRiskPct - plan.riskPerTradePct) > 0.05 &&
            ` (pediste ${formatNumber(plan.riskPerTradePct, 2)} %, pero el tope de exposición recortó la posición)`}
          .
        </p>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Level label="Entrada" value={formatPrice(plan.entry)} note="Precio actual de mercado" />
        <Level
          label="Stop-loss"
          value={formatPrice(plan.stopLoss)}
          note={`−${formatNumber(plan.stopDistancePct, 2)} % · pérdida ${formatPrice(plan.maxLossUsd)}`}
          tone="bear"
        />
        {plan.targets.map((target) => (
          <Level
            key={target.rMultiple}
            label={`Objetivo ${target.rMultiple}R`}
            value={formatPrice(target.price)}
            note={`+${formatNumber(target.gainPct, 2)} % · ganancia ${formatPrice(
              plan.positionUsd * (target.gainPct / 100),
            )}`}
            tone="bull"
          />
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-mist-400">
        El stop se sitúa a 1,5 veces la desviación típica esperada en {plan.horizonHours} h
        (volatilidad horaria escalada por la raíz del horizonte), de modo que el ruido normal del
        mercado no lo active. Relación riesgo/beneficio hasta el objetivo lejano:{' '}
        {formatNumber(plan.riskRewardRatio, 1)} a 1.
      </p>
    </div>
  );
}

function Level({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'bull' | 'bear';
}) {
  const toneClass = tone === 'bull' ? 'text-bull-400' : tone === 'bear' ? 'text-bear-400' : 'text-white';
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850/60 p-3">
      <dt className="text-[11px] text-mist-400">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold ${toneClass}`}>{value}</dd>
      <p className="mt-0.5 text-[11px] text-mist-400">{note}</p>
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: ShortTermCandidate }) {
  const meta = COIN_META[candidate.coinId];
  const { momentum } = candidate;

  return (
    <li className="rounded-lg border border-ink-700/60 bg-ink-850/60 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: meta.accent }}
        />
        <span className="w-10 font-semibold text-white">{meta.symbol}</span>
        <span className="w-14 text-right font-bold tabular-nums text-mist-200">
          {candidate.score}/100
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
            candidate.rising
              ? 'border-bull-500/40 bg-bull-500/10 text-bull-400'
              : 'border-ink-600 bg-ink-800 text-mist-400'
          }`}
        >
          {candidate.rising ? 'AL ALZA' : 'NO CUMPLE'}
        </span>
        <span className="text-mist-400">
          24 h {formatSigned(momentum.change24hPct)} · 6 h {formatSigned(momentum.change6hPct)} ·
          RSI 1 h {momentum.rsi1h !== null ? formatNumber(momentum.rsi1h, 0) : 'n/d'}
        </span>
      </div>
      {!candidate.rising && candidate.blockers.length > 0 && (
        <p className="mt-1 text-mist-400 sm:pl-[5.75rem]">{candidate.blockers[0]}</p>
      )}
    </li>
  );
}

function Controls({
  riskPerTradePct,
  horizonHours,
  onChange,
}: {
  riskPerTradePct: number;
  horizonHours: number;
  onChange: (patch: { riskPerTradePct?: number; horizonHours?: number }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-[11px] text-mist-400">
        <span className="block">Riesgo por operación</span>
        <span className="mt-1 flex items-center gap-1.5">
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={riskPerTradePct}
            onChange={(event) => onChange({ riskPerTradePct: Number(event.target.value) })}
            className="w-28 accent-accent-400"
          />
          <span className="w-10 text-right font-semibold text-mist-200">{riskPerTradePct} %</span>
        </span>
      </label>
      <div role="group" aria-label="Horizonte de la operación">
        <span className="block text-[11px] text-mist-400">Horizonte</span>
        <span className="mt-1 flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
          {HORIZON_OPTIONS.map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={horizonHours === hours}
              onClick={() => onChange({ horizonHours: hours })}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                horizonHours === hours
                  ? 'bg-ink-700 text-white'
                  : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              {hours} h
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

function formatSigned(value: number | null): string {
  if (value === null) return 'n/d';
  return `${value >= 0 ? '+' : ''}${formatNumber(value, 2)} %`;
}
