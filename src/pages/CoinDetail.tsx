import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { CoinChart } from '../components/CoinChart';
import { ErrorState } from '../components/ErrorState';
import { RiskPanel } from '../components/RiskPanel';
import { SkeletonBlock, Spinner } from '../components/Spinner';
import { StaleDataBanner } from '../components/StaleDataBanner';
import { COIN_META, isCoinId, useCoins } from '../context/CoinContext';
import { useCandles, useDailySeries, useHourlySeries } from '../hooks/useCryptoAPI';
import { formatCompactUsd, formatPercent, formatPrice, formatRelative } from '../lib/format';
import { assessRisk } from '../lib/risk';
import { analyzeTimeframe, buildRecommendation } from '../lib/strategy';

type ChartRange = '10D' | '1Y';
type ChartType = 'line' | 'candles';

const TEN_DAYS_SECONDS = 10 * 24 * 60 * 60;

export function CoinDetail() {
  const { coinId } = useParams();
  const { getMarket, markets } = useCoins();
  const [range, setRange] = useState<ChartRange>('10D');
  const [chartType, setChartType] = useState<ChartType>('line');

  const valid = isCoinId(coinId);
  const daily = useDailySeries(valid ? coinId : null);
  const hourly = useHourlySeries(valid ? coinId : null);
  // Las velas solo se descargan si el usuario las pide, para no gastar cuota.
  const candles = useCandles(valid ? coinId : null, valid && chartType === 'candles' && range === '10D');

  const dailySignal = useMemo(
    () => (daily.data ? analyzeTimeframe(daily.data, '1D') : null),
    [daily.data],
  );
  const hourlySignal = useMemo(
    () => (hourly.data ? analyzeTimeframe(hourly.data, '1H') : null),
    [hourly.data],
  );
  const recommendation = useMemo(
    () => buildRecommendation([dailySignal, hourlySignal]),
    [dailySignal, hourlySignal],
  );

  const market = valid ? getMarket(coinId) : null;
  const risk = useMemo(
    () => (market ? assessRisk(market, daily.data) : null),
    [market, daily.data],
  );

  if (!valid) return <Navigate to="/" replace />;

  const meta = COIN_META[coinId];
  const activeSeries = range === '10D' ? hourly : daily;
  const activeSignal = range === '10D' ? hourlySignal : dailySignal;
  const points = activeSeries.data ?? [];
  const lastTime = points.length > 0 ? points[points.length - 1]?.time : undefined;
  const visibleFromTime =
    range === '10D' && lastTime !== undefined ? lastTime - TEN_DAYS_SECONDS : undefined;

  const anyStale = daily.stale || hourly.stale || markets.stale;
  const staleReason = daily.staleReason ?? hourly.staleReason ?? markets.staleReason;
  const seriesFailed = activeSeries.state === 'error' && !activeSeries.data;

  return (
    <div className="space-y-6">
      <nav aria-label="Ruta de navegación" className="text-xs text-mist-400">
        <Link to="/" className="hover:text-mist-200">
          Mercado
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <span className="text-mist-200">{meta.name}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="size-3 rounded-full"
            style={{ backgroundColor: meta.accent }}
          />
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">
              {meta.name} <span className="text-mist-400">({meta.symbol})</span>
            </h1>
            {market ? (
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="text-lg font-bold text-white">{formatPrice(market.price)}</span>
                <span
                  className={`font-semibold ${market.change24hPct >= 0 ? 'text-bull-400' : 'text-bear-400'}`}
                >
                  {formatPercent(market.change24hPct)} 24 h
                </span>
                <span className="text-mist-400">Vol. {formatCompactUsd(market.volume24h)}</span>
              </p>
            ) : (
              <SkeletonBlock className="mt-1.5 h-5 w-56" />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            label="Rango del gráfico"
            value={range}
            onChange={(next) => {
              setRange(next);
              // Las velas solo existen para el rango corto; volver a línea evita un panel vacío.
              if (next === '1Y') setChartType('line');
            }}
            options={[
              { value: '10D', label: '10 días · 1H' },
              { value: '1Y', label: '1 año · 1D' },
            ]}
          />
          {range === '10D' && (
            <ToggleGroup
              label="Tipo de gráfico"
              value={chartType}
              onChange={setChartType}
              options={[
                { value: 'line', label: 'Línea' },
                { value: 'candles', label: 'Velas' },
              ]}
            />
          )}
        </div>
      </header>

      {anyStale && <StaleDataBanner fetchedAt={activeSeries.fetchedAt} reason={staleReason} />}

      <section
        aria-label={`Gráfico de ${meta.name} con indicadores MACD y RSI`}
        className="rounded-xl border border-ink-700/70 bg-ink-900/60 p-3 sm:p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-mist-400">
          <span>
            Precio · MACD (12, 26, 9) · RSI (14) —{' '}
            {range === '10D' ? 'velas horarias, últimos 10 días' : 'velas diarias, último año'}
          </span>
          {activeSeries.fetchedAt && <span>Serie {formatRelative(activeSeries.fetchedAt)}</span>}
        </div>

        {seriesFailed ? (
          <ErrorState
            message={activeSeries.error ?? 'No se pudo cargar la serie de precios.'}
            onRetry={() => activeSeries.refresh(true)}
          />
        ) : points.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center sm:h-[520px] lg:h-[620px]">
            <Spinner label="Cargando serie de precios…" />
          </div>
        ) : (
          <>
            <CoinChart
              points={points}
              candles={candles.data}
              chartType={chartType}
              macd={activeSignal?.series.macd ?? null}
              rsi={activeSignal?.series.rsi ?? null}
              accent={meta.accent}
              visibleFromTime={visibleFromTime}
              ariaLabel={`Evolución del precio de ${meta.name} con los indicadores MACD y RSI en temporalidad ${
                range === '10D' ? 'de 1 hora' : 'diaria'
              }`}
            />
            {chartType === 'candles' && candles.state === 'loading' && !candles.data && (
              <div className="pt-3">
                <Spinner label="Cargando velas OHLC…" />
              </div>
            )}
            {chartType === 'candles' && candles.state === 'error' && (
              <p className="pt-3 text-xs text-warn-400">
                No se pudieron cargar las velas OHLC; se muestra la línea de precios.
              </p>
            )}
            <ChartLegend accent={meta.accent} />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {daily.state === 'loading' && !daily.data && hourly.state === 'loading' && !hourly.data ? (
          <SkeletonBlock className="h-72 w-full" />
        ) : (
          <AnalysisPanel recommendation={recommendation} />
        )}

        {risk ? (
          <RiskPanel risk={risk} />
        ) : markets.state === 'error' ? (
          <ErrorState
            title="Riesgo no disponible"
            message="Faltan los datos de mercado necesarios para calcular la volatilidad de 24 horas."
            onRetry={() => markets.refresh(true)}
          />
        ) : (
          <SkeletonBlock className="h-72 w-full" />
        )}
      </div>
    </div>
  );
}

function ChartLegend({ accent }: { accent: string }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[11px] text-mist-400">
      <LegendItem color={accent} label="Precio" />
      <LegendItem color="#60a5fa" label="Línea MACD" />
      <LegendItem color="#fbbf24" label="Línea de señal" />
      <LegendItem color="#22c55e" label="Histograma positivo" />
      <LegendItem color="#ef4444" label="Histograma negativo" />
      <LegendItem color="#c7cfe6" label="RSI (14) con bandas 30 / 50 / 70" />
    </ul>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-0.5 w-4 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </li>
  );
}

interface ToggleGroupProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

function ToggleGroup<T extends string>({ label, value, onChange, options }: ToggleGroupProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-lg border border-ink-700 bg-ink-900 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === option.value
              ? 'bg-ink-700 text-white'
              : 'text-mist-400 hover:text-mist-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
