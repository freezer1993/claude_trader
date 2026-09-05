import { Link } from 'react-router-dom';
import { COIN_META } from '../context/CoinContext';
import { formatCompactUsd, formatPercent, formatPrice } from '../lib/format';
import { SkeletonBlock } from './Spinner';
import type { CoinMarket } from '../types/crypto';

interface CoinTableProps {
  markets: CoinMarket[] | null;
  loading: boolean;
}

export function CoinTable({ markets, loading }: CoinTableProps) {
  if (!markets && loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!markets || markets.length === 0) {
    return <p className="text-sm text-mist-400">No hay datos de mercado disponibles.</p>;
  }

  return (
    <>
      {/* Tabla en escritorio: la densidad de columnas es la lectura natural del dato. */}
      <div className="hidden overflow-x-auto rounded-xl border border-ink-700/70 md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">
            Precio, volumen de 24 horas y variación de 24 horas de Bitcoin, Ethereum y BNB
          </caption>
          <thead className="bg-ink-850 text-xs uppercase tracking-wide text-mist-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Activo</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Precio</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Cambio 24 h</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Volumen 24 h</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Rango 24 h</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/60">
            {markets.map((coin) => {
              const meta = COIN_META[coin.id];
              const up = coin.change24hPct >= 0;
              return (
                <tr key={coin.id} className="bg-ink-900/60 transition hover:bg-ink-850">
                  <th scope="row" className="px-4 py-3 font-normal">
                    <Link
                      to={`/coin/${coin.id}`}
                      className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-400"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: meta.accent }}
                      />
                      <span>
                        <span className="block font-semibold text-white">{meta.symbol}</span>
                        <span className="block text-xs text-mist-400">{coin.name}</span>
                      </span>
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-right font-semibold text-white">
                    {formatPrice(coin.price)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${up ? 'text-bull-400' : 'text-bear-400'}`}
                  >
                    {formatPercent(coin.change24hPct)}
                  </td>
                  <td className="px-4 py-3 text-right text-mist-200">
                    {formatCompactUsd(coin.volume24h)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-mist-400">
                    {formatPrice(coin.low24h)} — {formatPrice(coin.high24h)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/coin/${coin.id}`}
                      className="rounded-lg border border-ink-600 px-2.5 py-1 text-xs font-medium text-mist-200 transition hover:border-accent-400 hover:text-white"
                    >
                      Analizar
                      <span className="sr-only"> {coin.name}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tarjetas en móvil: una tabla de 6 columnas es ilegible por debajo de 768 px. */}
      <ul className="space-y-3 md:hidden">
        {markets.map((coin) => {
          const meta = COIN_META[coin.id];
          const up = coin.change24hPct >= 0;
          return (
            <li key={coin.id}>
              <Link
                to={`/coin/${coin.id}`}
                className="block rounded-xl border border-ink-700/70 bg-ink-900/60 p-4 transition hover:border-accent-400/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: meta.accent }}
                    />
                    <span>
                      <span className="block font-semibold text-white">{meta.symbol}</span>
                      <span className="block text-xs text-mist-400">{coin.name}</span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold text-white">{formatPrice(coin.price)}</span>
                    <span
                      className={`block text-sm font-semibold ${up ? 'text-bull-400' : 'text-bear-400'}`}
                    >
                      {formatPercent(coin.change24hPct)}
                    </span>
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-700/60 pt-3 text-xs">
                  <div>
                    <dt className="text-mist-400">Volumen 24 h</dt>
                    <dd className="text-mist-200">{formatCompactUsd(coin.volume24h)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-mist-400">Rango 24 h</dt>
                    <dd className="text-mist-200">
                      {formatPrice(coin.low24h)} — {formatPrice(coin.high24h)}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
