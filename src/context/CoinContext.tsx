import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAllCoinSeries, useMarkets, type AsyncResource } from '../hooks/useCryptoAPI';
import { assessRisk, type RiskAssessment } from '../lib/risk';
import { analyzeTimeframe, buildRecommendation, type Recommendation } from '../lib/strategy';
import {
  buildPortfolioReport,
  parseAmount,
  STABLE_ID,
  type AssetId,
  type PortfolioReport,
} from '../lib/portfolio';
import { readJson, USER_NS, writeJson } from '../lib/storage';
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

export function symbolOf(assetId: AssetId): string {
  return assetId === STABLE_ID ? 'USDT' : COIN_META[assetId].symbol;
}

/** Se guarda el texto crudo del usuario, no el número, para no alterar lo que escribe. */
export type HoldingsInput = Partial<Record<AssetId, string>>;

const HOLDINGS_KEY = 'holdings';

/** Un recurso está resuelto cuando ya trajo datos o falló definitivamente. */
function isSettled(resource: AsyncResource<unknown>): boolean {
  return resource.state === 'success' || resource.state === 'error';
}

interface CoinAnalysis {
  recommendation: Recommendation;
  risk: RiskAssessment;
}

interface CoinContextValue {
  markets: AsyncResource<CoinMarket[]>;
  getMarket: (coinId: CoinId) => CoinMarket | null;
  holdings: HoldingsInput;
  setHolding: (assetId: AssetId, rawValue: string) => void;
  clearHoldings: () => void;
  hasHoldings: boolean;
  /** null mientras no haya tenencias o falten datos para analizar. */
  report: PortfolioReport | null;
  analysisLoading: boolean;
  analysisError: string | null;
  /** Refresca mercados y, si hay cartera, las series de las tres monedas. */
  refreshAll: (force?: boolean) => void;
}

const CoinContext = createContext<CoinContextValue | null>(null);

function loadHoldings(): HoldingsInput {
  const stored = readJson<HoldingsInput>(USER_NS, HOLDINGS_KEY);
  if (!stored || typeof stored !== 'object') return {};
  const clean: HoldingsInput = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === 'string') clean[key as AssetId] = value;
  }
  return clean;
}

/**
 * El estado de mercado vive en contexto para que dashboard y detalle compartan
 * una única suscripción de polling: duplicarla malgastaría cuota de la API.
 */
export function CoinProvider({ children }: { children: ReactNode }) {
  const markets = useMarkets();
  const [holdings, setHoldings] = useState<HoldingsInput>(loadHoldings);

  const hasHoldings = useMemo(
    () => Object.values(holdings).some((raw) => parseAmount(raw ?? '') > 0),
    [holdings],
  );

  const series = useAllCoinSeries(hasHoldings);

  const setHolding = useCallback((assetId: AssetId, rawValue: string) => {
    setHoldings((prev) => {
      const next = { ...prev, [assetId]: rawValue };
      writeJson(USER_NS, HOLDINGS_KEY, next);
      return next;
    });
  }, []);

  const clearHoldings = useCallback(() => {
    setHoldings(() => {
      writeJson(USER_NS, HOLDINGS_KEY, {});
      return {};
    });
  }, []);

  const marketData = markets.data;

  // Un análisis por moneda: mismas reglas que la página de detalle, aplicadas
  // a las tres a la vez para poder compararlas entre sí.
  const analyses = useMemo(() => {
    if (!marketData) return {};
    const result: Partial<Record<CoinId, CoinAnalysis>> = {};
    for (const market of marketData) {
      const coinSeries = series[market.id];
      const daily = coinSeries?.daily.data ?? null;
      const hourly = coinSeries?.hourly.data ?? null;
      if (!daily && !hourly) continue;
      const recommendation = buildRecommendation([
        daily ? analyzeTimeframe(daily, '1D') : null,
        hourly ? analyzeTimeframe(hourly, '1H') : null,
      ]);
      if (recommendation.timeframes.length === 0) continue;
      result[market.id] = { recommendation, risk: assessRisk(market, daily) };
    }
    return result;
  }, [marketData, series]);

  const holdingAmounts = useMemo(() => {
    const amounts: Partial<Record<AssetId, number>> = {};
    for (const [key, raw] of Object.entries(holdings)) {
      const amount = parseAmount(raw ?? '');
      if (amount > 0) amounts[key as AssetId] = amount;
    }
    return amounts;
  }, [holdings]);

  const seriesSettled = useMemo(
    () =>
      COIN_IDS.every((id) => {
        const { daily, hourly } = series[id];
        return isSettled(daily) && isSettled(hourly);
      }),
    [series],
  );

  // El informe solo se emite con todas las series resueltas. Comparar activos
  // con un subconjunto podría recomendar una rotación que se invierte en cuanto
  // termina de cargar el resto: un veredicto que cambia solo no sirve para
  // decidir sobre dinero.
  const report = useMemo(() => {
    if (!hasHoldings || !marketData || marketData.length === 0) return null;
    if (!seriesSettled || Object.keys(analyses).length === 0) return null;
    return buildPortfolioReport({
      markets: marketData,
      analyses,
      holdings: holdingAmounts,
      symbolOf: (coinId) => COIN_META[coinId].symbol,
    });
  }, [hasHoldings, seriesSettled, marketData, analyses, holdingAmounts]);

  const seriesResources = useMemo(
    () => COIN_IDS.flatMap((id) => [series[id].daily, series[id].hourly]),
    [series],
  );

  const analysisLoading = hasHoldings && !seriesSettled;

  const analysisError = useMemo(() => {
    if (!hasHoldings) return null;
    const failed = seriesResources.find((r) => r.state === 'error' && r.data === null);
    return failed?.error ?? null;
  }, [hasHoldings, seriesResources]);

  const refreshAll = useCallback(
    (force = false) => {
      markets.refresh(force);
      // Las series solo se refrescan si hay cartera; sin ella no están cargadas.
      if (hasHoldings) {
        for (const resource of seriesResources) resource.refresh(force);
      }
    },
    [markets, hasHoldings, seriesResources],
  );

  const value = useMemo<CoinContextValue>(
    () => ({
      markets,
      getMarket: (coinId) => markets.data?.find((m) => m.id === coinId) ?? null,
      holdings,
      setHolding,
      clearHoldings,
      hasHoldings,
      report,
      analysisLoading,
      analysisError,
      refreshAll,
    }),
    [
      markets,
      holdings,
      setHolding,
      clearHoldings,
      hasHoldings,
      report,
      analysisLoading,
      analysisError,
      refreshAll,
    ],
  );

  return <CoinContext.Provider value={value}>{children}</CoinContext.Provider>;
}

export function useCoins(): CoinContextValue {
  const ctx = useContext(CoinContext);
  if (!ctx) throw new Error('useCoins debe usarse dentro de <CoinProvider>.');
  return ctx;
}
