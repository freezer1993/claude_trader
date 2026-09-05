import { NavLink } from 'react-router-dom';
import { COIN_IDS, COIN_META, useCoins } from '../context/CoinContext';
import { formatRelative } from '../lib/format';

export function Navbar() {
  const { markets, refreshAll, hasHoldings, analysisLoading } = useCoins();
  const refreshing = (markets.state === 'loading' && markets.data !== null) || analysisLoading;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-950/85 backdrop-blur">
      <nav
        aria-label="Navegación principal"
        className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex items-center justify-between gap-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-lg bg-bull-400/10 text-bull-400"
            >
              <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor">
                <path
                  d="M5 22 L11 14 L16 18 L27 6"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-white">Claude Trader</span>
              <span className="block text-[11px] text-mist-400">MACD + RSI · BTC / ETH / BNB</span>
            </span>
          </NavLink>

          <button
            type="button"
            onClick={() => refreshAll(true)}
            disabled={refreshing}
            title={
              hasHoldings
                ? 'Actualiza precios y reanaliza tu cartera'
                : 'Actualiza los precios de mercado'
            }
            className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-xs font-medium text-mist-200 transition hover:border-accent-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:hidden"
          >
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>

        <ul className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                  isActive
                    ? 'bg-ink-800 text-white'
                    : 'text-mist-400 hover:bg-ink-850 hover:text-mist-200'
                }`
              }
            >
              Mercado
            </NavLink>
          </li>
          {COIN_IDS.map((id) => (
            <li key={id}>
              <NavLink
                to={`/coin/${id}`}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                    isActive
                      ? 'bg-ink-800 text-white'
                      : 'text-mist-400 hover:bg-ink-850 hover:text-mist-200'
                  }`
                }
              >
                {COIN_META[id].symbol}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 md:flex">
          <span className="text-[11px] text-mist-400">
            {markets.fetchedAt ? `Actualizado ${formatRelative(markets.fetchedAt)}` : 'Sin datos aún'}
          </span>
          <button
            type="button"
            onClick={() => refreshAll(true)}
            disabled={refreshing}
            title={
              hasHoldings
                ? 'Actualiza precios y reanaliza tu cartera'
                : 'Actualiza los precios de mercado'
            }
            className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-xs font-medium text-mist-200 transition hover:border-accent-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? 'Actualizando…' : hasHoldings ? 'Actualizar y analizar' : 'Actualizar'}
          </button>
        </div>
      </nav>
    </header>
  );
}
