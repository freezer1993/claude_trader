import { useCallback, useEffect, useState } from 'react';
import { useCoins } from '../context/CoinContext';
import { api, type AnalysisRunSummary, type HoldingTransaction } from '../lib/api';
import { formatNumber, formatPrice } from '../lib/format';
import { ErrorState } from './ErrorState';
import { Spinner } from './Spinner';

type Tab = 'movements' | 'runs';

const KIND_LABELS: Record<string, string> = {
  set: 'Ajuste',
  deposit: 'Depósito',
  withdraw: 'Retirada',
  buy: 'Compra',
  sell: 'Venta',
  rotate_in: 'Rotación (entrada)',
  rotate_out: 'Rotación (salida)',
};

export function HistoryPanel() {
  const { persistenceMode, lastRunId } = useCoins();
  const [tab, setTab] = useState<Tab>('movements');
  const [movements, setMovements] = useState<HoldingTransaction[] | null>(null);
  const [runs, setRuns] = useState<AnalysisRunSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (persistenceMode !== 'api') return;
    setLoading(true);
    setError(null);
    try {
      const [history, runList] = await Promise.all([api.allHistory(30), api.analysisRuns(20)]);
      setMovements(history.transactions);
      setRuns(runList.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el histórico.');
    } finally {
      setLoading(false);
    }
  }, [persistenceMode]);

  // Se recarga cuando se archiva un análisis nuevo, para que la lista no quede
  // desfasada respecto a lo que el usuario acaba de provocar.
  useEffect(() => {
    void load();
  }, [load, lastRunId]);

  if (persistenceMode === 'local') {
    return (
      <section
        aria-labelledby="history-heading"
        className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-5"
      >
        <h2 id="history-heading" className="text-sm font-semibold text-white">
          Histórico
        </h2>
        <p className="mt-2 text-sm text-mist-400">
          El histórico de movimientos y de análisis vive en la base de datos. Arranca el API
          (<code className="rounded bg-ink-850 px-1">npm run dev:api</code>) para verlo aquí.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="history-heading"
      className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="history-heading" className="text-sm font-semibold text-white">
            Histórico
          </h2>
          <p className="mt-1 text-xs text-mist-400">
            Cada cambio de saldo y cada análisis archivado, con su variación.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Sección del histórico" className="flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
            <TabButton active={tab === 'movements'} onClick={() => setTab('movements')}>
              Movimientos
            </TabButton>
            <TabButton active={tab === 'runs'} onClick={() => setTab('runs')}>
              Análisis
            </TabButton>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-ink-600 px-2.5 py-1 text-xs font-medium text-mist-200 transition hover:border-accent-400 disabled:opacity-50"
          >
            Recargar
          </button>
        </div>
      </header>

      {error ? (
        <div className="mt-4">
          <ErrorState title="Histórico no disponible" message={error} onRetry={() => void load()} />
        </div>
      ) : loading && !movements && !runs ? (
        <div className="mt-4">
          <Spinner label="Cargando histórico…" />
        </div>
      ) : tab === 'movements' ? (
        <MovementsTable movements={movements ?? []} />
      ) : (
        <RunsTable runs={runs ?? []} />
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? 'bg-ink-700 text-white' : 'text-mist-400 hover:text-mist-200'
      }`}
    >
      {children}
    </button>
  );
}

function MovementsTable({ movements }: { movements: HoldingTransaction[] }) {
  if (movements.length === 0) {
    return (
      <p className="mt-4 text-sm text-mist-400">
        Todavía no hay movimientos. Cambia el saldo de un activo y pulsa Guardar.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wide text-mist-400">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
            <th scope="col" className="py-2 pr-3 font-medium">Activo</th>
            <th scope="col" className="py-2 pr-3 font-medium">Tipo</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Antes</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Después</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Variación</th>
            <th scope="col" className="py-2 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/60">
          {movements.map((movement) => {
            const delta = Number(movement.delta);
            return (
              <tr key={movement.id}>
                <td className="py-2 pr-3 whitespace-nowrap text-mist-400">
                  {new Date(movement.created_at).toLocaleString('es-ES')}
                </td>
                <td className="py-2 pr-3 font-semibold text-white">{movement.symbol}</td>
                <td className="py-2 pr-3 text-mist-400">
                  {KIND_LABELS[movement.kind] ?? movement.kind}
                </td>
                <td className="py-2 pr-3 text-right text-mist-400">
                  {formatNumber(Number(movement.amount_before), 6)}
                </td>
                <td className="py-2 pr-3 text-right text-mist-200">
                  {formatNumber(Number(movement.amount_after), 6)}
                </td>
                <td
                  className={`py-2 pr-3 text-right font-semibold ${
                    delta > 0 ? 'text-bull-400' : delta < 0 ? 'text-bear-400' : 'text-mist-400'
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {formatNumber(delta, 6)}
                </td>
                <td className="py-2 text-right text-mist-400">
                  {movement.value_usd ? formatPrice(Number(movement.value_usd)) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ runs }: { runs: AnalysisRunSummary[] }) {
  if (runs.length === 0) {
    return (
      <p className="mt-4 text-sm text-mist-400">
        Todavía no se ha archivado ningún análisis. Se registra uno cada vez que el veredicto
        cambia o pulsas Actualizar.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wide text-mist-400">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
            <th scope="col" className="py-2 pr-3 font-medium">Origen</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Valor total</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Exposición</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Veredictos</th>
            <th scope="col" className="py-2 font-medium">Oportunidad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/60">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="py-2 pr-3 whitespace-nowrap text-mist-400">
                {new Date(run.generated_at).toLocaleString('es-ES')}
              </td>
              <td className="py-2 pr-3 text-mist-400">
                {run.trigger_source === 'manual' ? 'Manual' : 'Automático'}
              </td>
              <td className="py-2 pr-3 text-right font-semibold text-white">
                {run.total_value_usd ? formatPrice(Number(run.total_value_usd)) : '—'}
              </td>
              <td className="py-2 pr-3 text-right text-mist-200">
                {run.exposure_pct ? `${formatNumber(Number(run.exposure_pct), 1)} %` : '—'}
              </td>
              <td className="py-2 pr-3 text-right text-mist-200">{run.recommendation_count}</td>
              <td className="py-2 text-mist-400">
                {run.short_term_symbol
                  ? `${run.short_term_symbol} (${run.short_term_score}/100)`
                  : 'Ninguna'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
