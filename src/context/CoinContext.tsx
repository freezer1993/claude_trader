import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useMarkets, type AsyncResource } from '../hooks/useCryptoAPI';
import type { CoinId, CoinMarket, CoinMeta } from '../types/crypto';

/** Metadatos estáticos: evitan depender de la API para pintar la UI base. */
export const COIN_META: Record<CoinId, CoinMeta> = {
  bitcoin: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', accent: '#f7931a' },
  ethereum: { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', accent: '#8ea2ff' },
  binancecoin: { id: 'binancecoin', symbol: 'BNB', name: 'BNB', accent: '#f0b90b' },
};

export const COIN_IDS = Object.keys(COIN_META) as CoinId[];

export function isCoinId(value: string | undefined): value is CoinId {
  return value !== undefined && value in COIN_META;
}

interface CoinContextValue {
  markets: AsyncResource<CoinMarket[]>;
  getMarket: (coinId: CoinId) => CoinMarket | null;
}

const CoinContext = createContext<CoinContextValue | null>(null);

/**
 * El estado de mercado vive en contexto para que dashboard y detalle compartan
 * una única suscripción de polling: duplicarla malgastaría cuota de la API.
 */
export function CoinProvider({ children }: { children: ReactNode }) {
  const markets = useMarkets();

  const value = useMemo<CoinContextValue>(
    () => ({
      markets,
      getMarket: (coinId) => markets.data?.find((m) => m.id === coinId) ?? null,
    }),
    [markets],
  );

  return <CoinContext.Provider value={value}>{children}</CoinContext.Provider>;
}

export function useCoins(): CoinContextValue {
  const ctx = useContext(CoinContext);
  if (!ctx) throw new Error('useCoins debe usarse dentro de <CoinProvider>.');
  return ctx;
}
