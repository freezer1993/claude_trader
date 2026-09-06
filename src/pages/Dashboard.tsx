import { CoinTable } from '../components/CoinTable';
import { PortfolioPanel } from '../components/PortfolioPanel';
import { ShortTermPanel } from '../components/ShortTermPanel';
import { HistoryPanel } from '../components/HistoryPanel';
import { ErrorState } from '../components/ErrorState';
import { StaleDataBanner } from '../components/StaleDataBanner';
import { useCoins } from '../context/CoinContext';
import { formatCompactUsd, formatPercent } from '../lib/format';

export function Dashboard() {
  const { markets } = useCoins();

  const totalVolume = markets.data?.reduce((acc, coin) => acc + coin.volume24h, 0) ?? 0;
  const advancing = markets.data?.filter((c) => c.change24hPct >= 0).length ?? 0;
  const avgChange =
    markets.data && markets.data.length > 0
      ? markets.data.reduce((acc, c) => acc + c.change24hPct, 0) / markets.data.length
      : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white sm:text-2xl">Vista de mercado</h1>
        <p className="mt-1 text-sm text-mist-400">
          Precio, volumen y variación de 24 horas de BTC, ETH y BNB. Introduce tus tenencias para
          recibir un veredicto por posición, y selecciona un activo para ver su gráfico de 10 días
          y el análisis MACD + RSI.
        </p>
      </header>

      {markets.stale && (
        <StaleDataBanner fetchedAt={markets.fetchedAt} reason={markets.staleReason} />
      )}

      {markets.state === 'error' && !markets.data ? (
        <ErrorState message={markets.error ?? 'Error desconocido.'} onRetry={() => markets.refresh(true)} />
      ) : (
        <>
          {markets.data && markets.data.length > 0 && (
            <dl className="grid gap-3 sm:grid-cols-3">
              <SummaryCard
                label="Volumen agregado 24 h"
                value={formatCompactUsd(totalVolume)}
                note="Suma de los tres activos cubiertos"
              />
              <SummaryCard
                label="Variación media 24 h"
                value={formatPercent(avgChange)}
                note="Media simple de los tres activos"
                tone={avgChange >= 0 ? 'bull' : 'bear'}
              />
              <SummaryCard
                label="Activos en positivo"
                value={`${advancing} de ${markets.data.length}`}
                note="Amplitud del movimiento de la sesión"
              />
            </dl>
          )}

          <CoinTable markets={markets.data} loading={markets.state === 'loading'} />

          <PortfolioPanel />

          <ShortTermPanel />

          <HistoryPanel />
        </>
      )}
    </div>
  );
}

function SummaryCard({
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
    <div className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-4">
      <dt className="text-xs text-mist-400">{label}</dt>
      <dd className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</dd>
      <p className="mt-0.5 text-[11px] text-mist-400">{note}</p>
    </div>
  );
}
