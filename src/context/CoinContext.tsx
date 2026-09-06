import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAllCoinSeries, useMarkets, type AsyncResource } from '../hooks/useCryptoAPI';
import { api, ApiRequestError, ApiUnavailableError, type ApiUser } from '../lib/api';
import { assessRisk, type RiskAssessment } from '../lib/risk';
import { analyzeTimeframe, buildRecommendation, type Recommendation } from '../lib/strategy';
import {
  buildPortfolioReport,
  parseAmount,
  STABLE_ID,
  toDecimalString,
  type AssetId,
  type PortfolioReport,
} from '../lib/portfolio';
import {
  buildShortTermReport,
  DEFAULT_SETTINGS,
  type ShortTermReport,
  type ShortTermSettings,
} from '../lib/shortTerm';
import { readJson, USER_NS, writeJson } from '../lib/storage';
import type { CoinId, CoinMarket, CoinMeta, PricePoint } from '../types/crypto';

/** Metadatos estáticos: evitan depender de la API para pintar la UI base. */
export const COIN_META: Record<CoinId, CoinMeta> = {
  bitcoin: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', accent: '#f7931a' },
  ethereum: { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', accent: '#8ea2ff' },
  binancecoin: { id: 'binancecoin', symbol: 'BNB', name: 'BNB', accent: '#f0b90b' },
};

export const COIN_IDS = Object.keys(COIN_META) as CoinId[];
export const ASSET_IDS: AssetId[] = [...COIN_IDS, STABLE_ID];

export function isCoinId(value: string | undefined): value is CoinId {
  return value !== undefined && value in COIN_META;
}

export function symbolOf(assetId: AssetId): string {
  return assetId === STABLE_ID ? 'USDT' : COIN_META[assetId].symbol;
}

const ASSET_BY_SYMBOL: Record<string, AssetId> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  USDT: STABLE_ID,
};

export type HoldingsInput = Partial<Record<AssetId, string>>;

const HOLDINGS_KEY = 'holdings';
const SETTINGS_KEY = 'shortTermSettings';

/** De dónde salen y adónde van las tenencias. */
export type PersistenceMode = 'loading' | 'api' | 'local';

interface CoinAnalysis {
  recommendation: Recommendation;
  risk: RiskAssessment;
}

export interface SaveOutcome {
  ok: boolean;
  message: string;
  detail?: string;
}

interface CoinContextValue {
  markets: AsyncResource<CoinMarket[]>;
  getMarket: (coinId: CoinId) => CoinMarket | null;
  /** Saldos confirmados; son los que alimentan el análisis. */
  holdings: HoldingsInput;
  /** Lo que hay escrito en cada campo, aún sin guardar. */
  drafts: HoldingsInput;
  setDraft: (assetId: AssetId, rawValue: string) => void;
  resetDraft: (assetId: AssetId) => void;
  isDirty: (assetId: AssetId) => boolean;
  saveHolding: (assetId: AssetId, note?: string) => Promise<SaveOutcome>;
  savingAsset: AssetId | null;
  clearHoldings: () => Promise<void>;
  hasHoldings: boolean;
  persistenceMode: PersistenceMode;
  persistenceError: string | null;
  apiUser: ApiUser | null;
  report: PortfolioReport | null;
  shortTerm: ShortTermReport | null;
  shortTermSettings: ShortTermSettings;
  setShortTermSettings: (settings: Partial<ShortTermSettings>) => void;
  analysisLoading: boolean;
  analysisError: string | null;
  /** Id de la última ejecución de análisis registrada en la base. */
  lastRunId: number | null;
  refreshAll: (force?: boolean) => void;
}

const CoinContext = createContext<CoinContextValue | null>(null);

function isSettled(resource: AsyncResource<unknown>): boolean {
  return resource.state === 'success' || resource.state === 'error';
}

function loadSettings(): ShortTermSettings {
  const stored = readJson<Partial<ShortTermSettings>>(USER_NS, SETTINGS_KEY);
  const risk = Number(stored?.riskPerTradePct);
  const horizon = Number(stored?.horizonHours);
  return {
    riskPerTradePct:
      Number.isFinite(risk) && risk > 0 && risk <= 100 ? risk : DEFAULT_SETTINGS.riskPerTradePct,
    horizonHours: Number.isFinite(horizon) && horizon > 0 ? horizon : DEFAULT_SETTINGS.horizonHours,
  };
}

function loadLocalHoldings(): HoldingsInput {
  const stored = readJson<HoldingsInput>(USER_NS, HOLDINGS_KEY);
  if (!stored || typeof stored !== 'object') return {};
  const clean: HoldingsInput = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === 'string') clean[key as AssetId] = value;
  }
  return clean;
}

/** Compara en forma canónica, para que "1,50" y "1.5" no cuenten como cambio. */
function sameAmount(a: string | undefined, b: string | undefined): boolean {
  return toDecimalString(a ?? '') === toDecimalString(b ?? '');
}

/** Recorta los ceros de relleno con que Postgres devuelve un numeric(38,18). */
function trimStored(value: string): string {
  return toDecimalString(value);
}

export function CoinProvider({ children }: { children: ReactNode }) {
  const markets = useMarkets();
  const [holdings, setHoldings] = useState<HoldingsInput>({});
  const [drafts, setDrafts] = useState<HoldingsInput>({});
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>('loading');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [savingAsset, setSavingAsset] = useState<AssetId | null>(null);
  const [shortTermSettings, setSettingsState] = useState<ShortTermSettings>(loadSettings);
  const [lastRunId, setLastRunId] = useState<number | null>(null);

  /*
   * Arranque: se intenta la base y solo se cae a LocalStorage si el servidor no
   * responde. Un 4xx/5xx significa que el backend está pero algo va mal, y
   * pasar a modo local ahí ocultaría el problema y dejaría al usuario editando
   * una copia divergente de sus datos reales.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [{ holdings: rows }, user] = await Promise.all([api.holdings(), api.me()]);
        if (cancelled) return;
        const loaded: HoldingsInput = {};
        for (const row of rows) {
          const assetId = ASSET_BY_SYMBOL[row.symbol];
          if (!assetId) continue;
          const amount = trimStored(row.amount);
          loaded[assetId] = amount === '0' ? '' : amount;
        }
        setHoldings(loaded);
        setDrafts(loaded);
        setApiUser(user);
        setPersistenceMode('api');
        setPersistenceError(null);
      } catch (error) {
        if (cancelled) return;
        const local = loadLocalHoldings();
        setHoldings(local);
        setDrafts(local);
        setPersistenceMode('local');
        setPersistenceError(
          error instanceof ApiUnavailableError
            ? 'Sin conexión con el servidor: los cambios se guardan solo en este navegador.'
            : error instanceof ApiRequestError
              ? `El servidor respondió ${error.status}: ${error.message}`
              : 'No se pudo contactar con el servidor.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasHoldings = useMemo(
    () => Object.values(holdings).some((raw) => parseAmount(raw ?? '') > 0),
    [holdings],
  );

  const series = useAllCoinSeries(hasHoldings);

  const setDraft = useCallback((assetId: AssetId, rawValue: string) => {
    setDrafts((prev) => ({ ...prev, [assetId]: rawValue }));
  }, []);

  const resetDraft = useCallback(
    (assetId: AssetId) => {
      setDrafts((prev) => ({ ...prev, [assetId]: holdings[assetId] ?? '' }));
    },
    [holdings],
  );

  const isDirty = useCallback(
    (assetId: AssetId) => !sameAmount(drafts[assetId], holdings[assetId]),
    [drafts, holdings],
  );

  const marketData = markets.data;

  const saveHolding = useCallback(
    async (assetId: AssetId, note?: string): Promise<SaveOutcome> => {
      const symbol = symbolOf(assetId);
      const draft = drafts[assetId] ?? '';
      // Cadena canónica, no el double: es el valor que llega a la columna numeric.
      const amount = toDecimalString(draft);
      const amountNumber = parseAmount(draft);
      setSavingAsset(assetId);

      try {
        if (persistenceMode === 'api') {
          const price =
            assetId === STABLE_ID
              ? 1
              : (marketData?.find((m) => m.id === assetId)?.price ?? null);

          const result = await api.saveHolding(symbol, {
            amount,
            ...(note ? { note } : {}),
            ...(price !== null ? { unitPriceUsd: price.toFixed(8) } : {}),
          });

          const saved = trimStored(result.amount);
          const stored = saved === '0' ? '' : saved;
          setHoldings((prev) => ({ ...prev, [assetId]: stored }));
          setDrafts((prev) => ({ ...prev, [assetId]: stored }));

          const delta = Number(result.transaction.delta);
          const deltaText = trimStored(result.transaction.delta.replace('-', ''));
          return {
            ok: true,
            message: `${symbol} actualizado`,
            detail:
              delta === 0
                ? 'El saldo no ha cambiado; se ha registrado el movimiento igualmente.'
                : `${delta > 0 ? 'Incremento' : 'Reducción'} de ${deltaText} ${symbol}. Movimiento #${result.transaction.id} guardado en el histórico.`,
          };
        }

        const next = { ...holdings, [assetId]: amountNumber > 0 ? draft : '' };
        setHoldings(next);
        setDrafts((prev) => ({ ...prev, [assetId]: amountNumber > 0 ? draft : '' }));
        writeJson(USER_NS, HOLDINGS_KEY, next);
        return {
          ok: true,
          message: `${symbol} actualizado en este navegador`,
          detail: 'Sin servidor no se registra histórico de movimientos.',
        };
      } catch (error) {
        return {
          ok: false,
          message: `No se pudo guardar ${symbol}`,
          detail:
            error instanceof ApiRequestError
              ? error.message
              : error instanceof ApiUnavailableError
                ? 'El servidor no responde. Comprueba que el API esté arrancado.'
                : 'Error desconocido al guardar.',
        };
      } finally {
        setSavingAsset(null);
      }
    },
    [drafts, holdings, marketData, persistenceMode],
  );

  const clearHoldings = useCallback(async () => {
    if (persistenceMode === 'api') {
      // Poner a cero uno a uno, no borrar: cada puesta a cero es un movimiento
      // que el histórico debe registrar como tal.
      for (const assetId of ASSET_IDS) {
        if (parseAmount(holdings[assetId] ?? '') <= 0) continue;
        try {
          await api.saveHolding(symbolOf(assetId), { amount: '0', note: 'Vaciado de cartera' });
        } catch {
          // Un fallo puntual no debe impedir vaciar el resto.
        }
      }
    } else {
      writeJson(USER_NS, HOLDINGS_KEY, {});
    }
    setHoldings({});
    setDrafts({});
  }, [holdings, persistenceMode]);

  const setShortTermSettings = useCallback((patch: Partial<ShortTermSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      writeJson(USER_NS, SETTINGS_KEY, next);
      return next;
    });
  }, []);

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
    () => COIN_IDS.every((id) => isSettled(series[id].daily) && isSettled(series[id].hourly)),
    [series],
  );

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

  const shortTerm = useMemo(() => {
    if (!hasHoldings || !marketData || marketData.length === 0) return null;
    if (!seriesSettled || Object.keys(analyses).length === 0) return null;
    const hourlySeries: Partial<Record<CoinId, PricePoint[] | null>> = {};
    for (const id of COIN_IDS) hourlySeries[id] = series[id].hourly.data;
    return buildShortTermReport({
      markets: marketData,
      analyses,
      hourlySeries,
      capitalUsdt: holdingAmounts[STABLE_ID] ?? 0,
      settings: shortTermSettings,
    });
  }, [hasHoldings, seriesSettled, marketData, analyses, series, holdingAmounts, shortTermSettings]);

  /*
   * Persistencia del análisis. Se firma el contenido y se omite el envío si la
   * firma no ha cambiado: el informe se recalcula en cada render que toque sus
   * dependencias, y sin esta comprobación el histórico se llenaría de filas
   * idénticas que no aportan nada y falsearían cualquier recuento.
   */
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (persistenceMode !== 'api' || !report || !marketData) return;

    const signature = JSON.stringify({
      positions: report.positions.map((p) => [p.assetId, p.action, p.target ?? null, p.score]),
      total: report.totalValueUsd.toFixed(2),
      short: shortTerm?.best
        ? [shortTerm.best.coinId, shortTerm.best.score, shortTerm.plan?.positionUsd.toFixed(2)]
        : null,
    });
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;

    const signals = Object.entries(analyses).flatMap(([coinId, analysis]) =>
      analysis.recommendation.timeframes.map((tf) => ({
        symbol: COIN_META[coinId as CoinId].symbol,
        timeframe: tf.timeframe,
        action: tf.action,
        confidence: tf.strength,
        rsi: tf.snapshot.rsi,
        macd: tf.snapshot.macd,
        macdSignal: tf.snapshot.signal,
        histogram: tf.snapshot.histogram,
        riskLevel: analysis.risk.level,
        payload: { ranging: tf.ranging, reasons: tf.reasons, warnings: tf.warnings },
      })),
    );

    const payload = {
      triggerSource: 'auto',
      params: shortTermSettings,
      signals,
      recommendations: report.positions.map((position) => ({
        symbol: symbolOf(position.assetId),
        action: position.action,
        targetSymbol: position.target ? COIN_META[position.target].symbol : null,
        score: position.score,
        amount: position.amount,
        valueUsd: position.valueUsd,
        weightPct: position.weightPct,
        headline: position.headline,
        detail: position.detail,
      })),
      shortTerm: shortTerm?.best
        ? {
            symbol: COIN_META[shortTerm.best.coinId].symbol,
            score: shortTerm.best.score,
            rising: shortTerm.best.rising,
            entryPrice: shortTerm.plan?.entry ?? null,
            stopLoss: shortTerm.plan?.stopLoss ?? null,
            stopDistancePct: shortTerm.plan?.stopDistancePct ?? null,
            positionUsd: shortTerm.plan?.positionUsd ?? null,
            units: shortTerm.plan?.units ?? null,
            riskPerTradePct: shortTerm.plan?.riskPerTradePct ?? null,
            effectiveRiskPct: shortTerm.plan?.effectiveRiskPct ?? null,
            horizonHours: shortTerm.plan?.horizonHours ?? null,
            targets: shortTerm.plan?.targets ?? [],
            payload: { reasons: shortTerm.best.reasons, blockers: shortTerm.best.blockers },
          }
        : { rising: false, payload: { warnings: shortTerm?.warnings ?? [] } },
      snapshot: {
        totalValueUsd: report.totalValueUsd,
        cryptoValueUsd: report.cryptoValueUsd,
        stableValueUsd: report.stableValueUsd,
        exposurePct: report.exposurePct,
        positions: report.positions.map((position) => ({
          symbol: symbolOf(position.assetId),
          amount: position.amount,
          priceUsd:
            position.assetId === STABLE_ID
              ? 1
              : (marketData.find((m) => m.id === position.assetId)?.price ?? 0),
          valueUsd: position.valueUsd,
          weightPct: position.weightPct,
        })),
      },
      prices: marketData.map((market) => ({
        symbol: COIN_META[market.id].symbol,
        priceUsd: market.price,
        change24hPct: market.change24hPct,
        volume24hUsd: market.volume24h,
        marketCapUsd: market.marketCap,
      })),
    };

    api
      .createAnalysisRun(payload)
      .then((result) => setLastRunId(result.runId))
      .catch(() => {
        // Un fallo al archivar no debe romper el dashboard: se permite
        // reintentar en el siguiente cambio real del análisis.
        lastSignature.current = null;
      });
  }, [persistenceMode, report, shortTerm, analyses, marketData, shortTermSettings]);

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
      if (hasHoldings) {
        for (const resource of seriesResources) resource.refresh(force);
      }
      // Un refresco manual debe archivar el resultado aunque el veredicto salga
      // idéntico: es el registro de que el usuario pidió reevaluar.
      if (force) lastSignature.current = null;
    },
    [markets, hasHoldings, seriesResources],
  );

  const value = useMemo<CoinContextValue>(
    () => ({
      markets,
      getMarket: (coinId) => markets.data?.find((m) => m.id === coinId) ?? null,
      holdings,
      drafts,
      setDraft,
      resetDraft,
      isDirty,
      saveHolding,
      savingAsset,
      clearHoldings,
      hasHoldings,
      persistenceMode,
      persistenceError,
      apiUser,
      report,
      shortTerm,
      shortTermSettings,
      setShortTermSettings,
      analysisLoading,
      analysisError,
      lastRunId,
      refreshAll,
    }),
    [
      markets,
      holdings,
      drafts,
      setDraft,
      resetDraft,
      isDirty,
      saveHolding,
      savingAsset,
      clearHoldings,
      hasHoldings,
      persistenceMode,
      persistenceError,
      apiUser,
      report,
      shortTerm,
      shortTermSettings,
      setShortTermSettings,
      analysisLoading,
      analysisError,
      lastRunId,
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
