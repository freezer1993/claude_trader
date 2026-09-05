import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { MacdResult, Series } from '../lib/indicators';
import type { Candle, PricePoint } from '../types/crypto';

export interface CoinChartProps {
  points: PricePoint[];
  candles: Candle[] | null;
  chartType: 'line' | 'candles';
  /** Indicadores alineados índice a índice con `points`. */
  macd: MacdResult | null;
  rsi: Series | null;
  accent: string;
  /** Recorta la vista inicial (los datos previos existen solo para calentar los indicadores). */
  visibleFromTime?: number;
  ariaLabel: string;
}

const GRID = '#1e2848';
const TEXT = '#8b98c4';

/**
 * Envoltorio imperativo sobre Lightweight Charts. El gráfico se crea una sola
 * vez y los datos se aplican por separado: recrear el chart en cada tick
 * destruiría el zoom del usuario y dispararía el coste de re-render.
 */
export function CoinChart({
  points,
  candles,
  chartType,
  macd,
  rsi,
  accent,
  visibleFromTime,
  ariaLabel,
}: CoinChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const signalLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: TEXT,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: GRID, separatorHoverColor: '#2b3763', enableResize: true },
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3d4a7a', labelBackgroundColor: '#1e2848' },
        horzLine: { color: '#3d4a7a', labelBackgroundColor: '#1e2848' },
      },
      localization: { locale: 'es-ES' },
      autoSize: false,
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    chartRef.current = chart;

    priceLineRef.current = chart.addSeries(
      LineSeries,
      { color: accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true },
      0,
    );
    candleRef.current = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        visible: false,
      },
      0,
    );

    // Panel 1: MACD. El histograma va primero para que las líneas queden encima.
    histRef.current = chart.addSeries(
      HistogramSeries,
      { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } },
      1,
    );
    macdLineRef.current = chart.addSeries(
      LineSeries,
      { color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    signalLineRef.current = chart.addSeries(
      LineSeries,
      { color: '#fbbf24', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      1,
    );

    // Panel 2: RSI con las bandas 30 / 50 / 70 dibujadas como price lines.
    rsiRef.current = chart.addSeries(
      LineSeries,
      {
        color: '#c7cfe6',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        // El RSI está acotado por definición: fijar la escala a 0-100 evita que
        // el autoescalado deforme las bandas de sobrecompra y sobreventa.
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
          margins: { above: 4, below: 4 },
        }),
      },
      2,
    );
    for (const [price, color] of [
      [70, '#ef4444'],
      [50, '#6b7aa8'],
      [30, '#22c55e'],
    ] as const) {
      rsiRef.current.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
      });
    }

    // Los osciladores se fijan primero y en orden inverso; el panel de precio
    // absorbe el espacio restante, que es como la librería reparte la altura.
    const applyHeights = () => {
      const panes = chart.panes();
      if (panes.length < 3) return;
      const total = panes.reduce((acc, pane) => acc + pane.getHeight(), 0);
      if (total <= 0) return;
      const oscillator = Math.max(64, Math.round(total * 0.2));
      panes[2]?.setHeight(oscillator);
      panes[1]?.setHeight(oscillator);
      panes[0]?.setHeight(Math.max(120, total - oscillator * 2));
    };

    const resize = () => {
      chart.resize(container.clientWidth, container.clientHeight);
      applyHeights();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      priceLineRef.current = null;
      candleRef.current = null;
      macdLineRef.current = null;
      signalLineRef.current = null;
      histRef.current = null;
      rsiRef.current = null;
    };
    // Solo se recrea si cambia el color de acento (cambio de moneda).
  }, [accent]);

  useEffect(() => {
    const line = priceLineRef.current;
    if (!line) return;
    line.applyOptions({ color: accent });
    line.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
  }, [points, accent]);

  useEffect(() => {
    const candleSeries = candleRef.current;
    if (!candleSeries) return;
    candleSeries.setData(
      (candles ?? []).map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
  }, [candles]);

  useEffect(() => {
    const showCandles = chartType === 'candles' && (candles?.length ?? 0) > 0;
    priceLineRef.current?.applyOptions({ visible: !showCandles });
    candleRef.current?.applyOptions({ visible: showCandles });
  }, [chartType, candles]);

  useEffect(() => {
    const times = points.map((p) => p.time as UTCTimestamp);
    const toLineData = (series: Series | undefined | null) =>
      (series ?? [])
        .map((value, i) => ({ time: times[i] as UTCTimestamp, value }))
        .filter((d): d is { time: UTCTimestamp; value: number } => d.value !== null && d.time !== undefined);

    macdLineRef.current?.setData(toLineData(macd?.macd));
    signalLineRef.current?.setData(toLineData(macd?.signal));
    histRef.current?.setData(
      toLineData(macd?.histogram).map((d) => ({
        ...d,
        color: d.value >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)',
      })),
    );
    rsiRef.current?.setData(toLineData(rsi));
  }, [points, macd, rsi]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;
    const last = points[points.length - 1]?.time;
    if (last === undefined) return;
    const from = visibleFromTime ?? points[0]?.time;
    if (from === undefined) return;
    chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: last as UTCTimestamp });
  }, [points, visibleFromTime]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className="h-[420px] w-full sm:h-[520px] lg:h-[620px]"
    />
  );
}
