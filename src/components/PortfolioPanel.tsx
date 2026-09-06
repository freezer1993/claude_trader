import { useState } from 'react';
import { COIN_META, symbolOf, useCoins } from '../context/CoinContext';
import { useToast } from '../context/ToastContext';
import { ConfirmDialog } from './ConfirmDialog';
import { PersistenceBadge } from './PersistenceBadge';
import { HoldingField } from './HoldingField';
import { Spinner } from './Spinner';
import { formatNumber, formatPrice, formatRelative } from '../lib/format';
import { STABLE_ID, type PositionAction, type PositionAdvice } from '../lib/portfolio';

const ACTION_STYLES: Record<PositionAction, { chip: string; label: string }> = {
  HOLD: { chip: 'border-bull-500/40 bg-bull-500/10 text-bull-400', label: 'MANTENER' },
  ROTATE: { chip: 'border-accent-400/40 bg-accent-400/10 text-accent-400', label: 'ROTAR' },
  TO_USDT: { chip: 'border-warn-400/40 bg-warn-400/10 text-warn-400', label: 'PASAR A USDT' },
  ENTER: { chip: 'border-bull-500/40 bg-bull-500/10 text-bull-400', label: 'ENTRAR' },
  STAY_USDT: { chip: 'border-ink-600 bg-ink-800 text-mist-400', label: 'SEGUIR EN USDT' },
};

export function PortfolioPanel() {
  const { clearHoldings, hasHoldings, report, analysisLoading, analysisError, persistenceMode } =
    useCoins();
  const { push } = useToast();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearHoldings();
      push({
        tone: 'success',
        title: 'Cartera vaciada',
        description:
          persistenceMode === 'api'
            ? 'Cada saldo se ha puesto a cero y queda registrado como movimiento en el histórico.'
            : 'Saldos borrados de este navegador.',
      });
    } catch {
      push({ tone: 'error', title: 'No se pudo vaciar la cartera' });
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  };

  return (
    <section
      aria-labelledby="portfolio-heading"
      className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="portfolio-heading" className="text-sm font-semibold text-white">
            Tu cartera
          </h2>
          <p className="mt-1 text-xs text-mist-400">
            Introduce cuánto tienes de cada activo. Al pulsar <strong>Actualizar</strong> se
            recalculan los precios, las señales y el veredicto de cada posición.
          </p>
          <p className="mt-1 text-[11px] text-mist-400">
            Usa coma o punto como separador decimal y no agrupes millares:
            <span className="text-mist-200"> 1500</span>, no
            <span className="text-mist-200"> 1.500</span>. Comprueba el valor en dólares que
            aparece junto a cada campo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PersistenceBadge />
          {hasHoldings && (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="rounded-lg border border-ink-600 px-2.5 py-1 text-xs font-medium text-mist-400 transition hover:border-bear-500/60 hover:text-bear-400"
            >
              Vaciar
            </button>
          )}
        </div>
      </header>

      {/* El USDT se introduce aquí y no en la tabla de mercado porque no es un
          activo seguido por la API: su precio se asume fijo en 1 USD. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ink-700/60 bg-ink-850/60 p-3">
        <span className="text-xs text-mist-400">Saldo en USDT (posición refugio)</span>
        <HoldingField assetId={STABLE_ID} />
        <span className="text-[11px] text-mist-400">Se asume la paridad 1 USDT = 1 US$.</span>
      </div>

      {!hasHoldings ? (
        <p className="mt-4 rounded-lg border border-ink-700/60 bg-ink-850/40 p-4 text-sm text-mist-400">
          Aún no has introducido tenencias. Escribe una cantidad en la columna{' '}
          <strong className="text-mist-200">Tenencia</strong> de la tabla de arriba (o en el saldo
          de USDT) y el análisis de cartera aparecerá aquí. Hasta entonces no se descargan las
          series históricas de las tres monedas, para no gastar la cuota de la API.
        </p>
      ) : analysisError && !report ? (
        <p className="mt-4 rounded-lg border border-bear-500/40 bg-bear-500/5 p-4 text-sm text-mist-200">
          No se pudieron cargar las series necesarias para analizar la cartera: {analysisError}
        </p>
      ) : !report ? (
        <div className="mt-4">
          <Spinner label="Calculando señales de las tres monedas…" />
        </div>
      ) : (
        <>
          {analysisLoading && (
            <div className="mt-4">
              <Spinner label="Actualizando señales…" />
            </div>
          )}

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Valor total" value={formatPrice(report.totalValueUsd)} />
            <Stat label="En cripto" value={formatPrice(report.cryptoValueUsd)} />
            <Stat
              label="Exposición a cripto"
              value={`${formatNumber(report.exposurePct, 1)} %`}
              note={`Resto en USDT: ${formatPrice(report.stableValueUsd)}`}
            />
          </dl>

          <ul className="mt-4 space-y-3">
            {report.positions.map((position) => (
              <PositionCard key={position.assetId} position={position} />
            ))}
          </ul>

          <div className="mt-5">
            <h3 className="text-xs font-semibold tracking-wide text-mist-200 uppercase">
              Ranking de atractivo
            </h3>
            <ul className="mt-2 space-y-1.5">
              {report.scores.map((score) => (
                <li
                  key={score.coinId}
                  className="rounded-lg border border-ink-700/60 bg-ink-850/60 px-3 py-2 text-xs"
                >
                  {/* Por debajo de sm el texto se apila: en una sola fila queda
                      estrangulado en una columna de pocos caracteres. */}
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: COIN_META[score.coinId].accent }}
                    />
                    <span className="w-10 font-semibold text-white">
                      {COIN_META[score.coinId].symbol}
                    </span>
                    <span
                      className={`w-12 text-right font-bold tabular-nums ${
                        score.score > 0
                          ? 'text-bull-400'
                          : score.score < 0
                            ? 'text-bear-400'
                            : 'text-mist-200'
                      }`}
                    >
                      {score.score > 0 ? '+' : ''}
                      {score.score}
                    </span>
                    <span className="text-mist-400">riesgo {score.riskLevel}/5</span>
                  </div>
                  <p className="mt-1 text-mist-400 sm:mt-0 sm:pl-[5.75rem]">{score.rationale}</p>
                </li>
              ))}
            </ul>
          </div>

          {report.warnings.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-lg border border-warn-400/25 bg-warn-400/5 p-3 text-xs">
              {report.warnings.map((warning, index) => (
                <li key={index} className="flex gap-2">
                  <span aria-hidden="true" className="text-warn-400">
                    ⚠
                  </span>
                  <span className="text-mist-200">{warning}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 border-t border-ink-700/60 pt-3 text-[11px] leading-relaxed text-mist-400">
            Veredicto generado {formatRelative(report.generatedAt)} a partir de las señales MACD +
            RSI y del riesgo de cada activo, comparando únicamente BTC, ETH, BNB y USDT. No es
            asesoramiento financiero ni tiene en cuenta tu horizonte temporal, tu tolerancia al
            riesgo ni tu precio de entrada.
          </p>
        </>
      )}

      <ConfirmDialog
        open={confirmingClear}
        busy={clearing}
        tone="danger"
        title="Vaciar toda la cartera"
        confirmLabel="Vaciar"
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => void handleClear()}
      >
        <p>
          Se pondrán a cero los saldos de todos los activos.
          {persistenceMode === 'api'
            ? ' El histórico de movimientos se conserva: cada puesta a cero se registra como un movimiento más.'
            : ' Los saldos guardados en este navegador se borrarán.'}
        </p>
      </ConfirmDialog>
    </section>
  );
}

function PositionCard({ position }: { position: PositionAdvice }) {
  const style = ACTION_STYLES[position.action];
  const symbol = symbolOf(position.assetId);
  const accent = position.assetId === STABLE_ID ? '#26a17b' : COIN_META[position.assetId].accent;

  return (
    <li className="rounded-lg border border-ink-700/70 bg-ink-850/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <div>
            <p className="text-sm font-semibold text-white">{position.headline}</p>
            <p className="text-xs text-mist-400">
              {formatNumber(position.amount, position.amount < 1 ? 6 : 4)} {symbol} ·{' '}
              {formatPrice(position.valueUsd)} · {formatNumber(position.weightPct, 1)} % de la
              cartera
              {position.score !== null && ` · puntuación ${position.score > 0 ? '+' : ''}${position.score}`}
            </p>
          </div>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${style.chip}`}>
          {position.action === 'ROTATE' && position.target
            ? `ROTAR → ${COIN_META[position.target].symbol}`
            : position.action === 'ENTER' && position.target
              ? `ENTRAR → ${COIN_META[position.target].symbol}`
              : style.label}
        </span>
      </div>
      <p className="mt-2 text-xs text-mist-200">{position.detail}</p>
    </li>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850/60 p-3">
      <dt className="text-xs text-mist-400">{label}</dt>
      <dd className="mt-0.5 text-base font-bold text-white">{value}</dd>
      {note && <p className="mt-0.5 text-[11px] text-mist-400">{note}</p>}
    </div>
  );
}
