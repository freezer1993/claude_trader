# Claude Trader — Dashboard de análisis cripto (BTC · ETH · BNB)

SPA de análisis técnico para Bitcoin, Ethereum y BNB. Consume la API pública de
CoinGecko, calcula MACD y RSI **en el cliente** y traduce esos indicadores en una
recomendación de movimiento diario junto con una calificación de riesgo de 1 a 5.

> Contenido informativo. No es asesoramiento financiero.

## Puesta en marcha

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # tsc -b && vite build (compilación de producción)
npm run preview  # sirve la build de dist/
```

No requiere clave de API ni backend: todas las peticiones salen del navegador
contra `https://api.coingecko.com/api/v3`.

## Stack

React 19 · TypeScript 5.9 (modo estricto) · Vite 8 · Tailwind CSS 4 ·
react-router-dom 7 · Lightweight Charts 5 (TradingView). Sin más dependencias.

## Arquitectura

```
src/
├── components/   Navbar · CoinTable · CoinChart · AnalysisPanel · RiskPanel
│                 StaleDataBanner · Spinner · ErrorState
├── context/      CoinContext — estado de mercado compartido (una sola suscripción de polling)
├── hooks/        useCryptoAPI — useMarkets / useDailySeries / useHourlySeries / useCandles
├── lib/          coingecko (cliente + cola) · cache (LocalStorage) · indicators
│                 strategy (reglas MACD+RSI) · risk (score 1-5) · format
├── pages/        Dashboard · CoinDetail
└── types/        Modelos de dominio compartidos
```

Flujo de datos: `coingecko.ts` → `cache.ts` → `useCryptoAPI` → `CoinContext` →
componentes. Los indicadores se calculan con `useMemo` sobre la serie recibida,
de modo que un re-render por polling no recalcula MACD ni RSI si la serie no ha
cambiado.

### Rutas

| Ruta             | Contenido                                                        |
| ---------------- | ---------------------------------------------------------------- |
| `/`              | Tabla de mercado: precio, volumen 24 h, cambio 24 h, rango 24 h   |
| `/coin/:coinId`  | Gráfico de 10 días + paneles MACD/RSI + análisis + riesgo         |
| `*`              | Redirección a `/`                                                 |

## Motor de indicadores (`src/lib/indicators.ts`)

Implementación propia, sin librerías de terceros:

- **EMA** sembrada con la SMA del primer bloque (criterio de TradingView/MetaTrader).
- **MACD (12, 26, 9)**: línea, señal e histograma.
- **RSI (14)** con suavizado de Wilder. Validado contra la serie de referencia
  del propio Wilder (RSI[14] = 70,4641 frente al 70,4644 publicado).
- **SMA**, desviación típica de retornos logarítmicos y detectores de cruce
  (`detectCross`, `detectLevelCross`).

Todas las funciones devuelven arrays de la longitud de la entrada con `null` en
el periodo de calentamiento, de forma que los índices de distintos indicadores
son directamente comparables.

## Estrategia MACD + RSI (`src/lib/strategy.ts`)

Se evalúan dos temporalidades en paralelo: **diaria (1D)** sobre 365 velas y
**1 hora (1H)** sobre 720 velas. La confirmación admite un desfase de hasta 3
velas entre el cruce del MACD y el del RSI.

| Señal                   | Condición                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Compra (Bullish)**    | Cruce alcista MACD (MACD sobre la señal) + RSI cruzando al alza el nivel 30 **o** el 50        |
| **Venta (Bearish)**     | Cruce bajista MACD (MACD bajo la señal) + RSI cruzando a la baja el nivel 70 **o** el 50       |
| **Esperar al Margen**   | Sin confirmación cruzada, mercado lateral, o contradicción entre 1D y 1H                       |

Modificadores aplicados sobre la fuerza de la señal:

- **Nivel cero del MACD**: un cruce alcista por debajo de cero se marca como
  rebote en tendencia bajista (y viceversa), restando confianza.
- **Mercado lateral**: histograma MACD por debajo del 0,12 % del precio y RSI
  dentro de 50 ± 8. Se avisa explícitamente del riesgo de señales falsas.
- **Extensión**: precio a más de un 8 % de su SMA20 → aviso de reversión a la media.
- **Acuerdo entre temporalidades**: si 1D y 1H coinciden sube la confianza; si se
  contradicen, la recomendación degrada a *Esperar al Margen*.

## Riesgo sistemático 1-5 (`src/lib/risk.ts`)

Media ponderada de cuatro factores normalizados con saturación en los extremos:

| Factor                             | Peso | Rango de normalización |
| ---------------------------------- | ---- | ---------------------- |
| Rango intradía 24 h                | 30 % | 1,5 % → 12 %           |
| Variación absoluta 24 h            | 20 % | 1 % → 10 %             |
| Volatilidad anualizada (30 d)      | 25 % | 30 % → 110 %           |
| Desviación frente a SMA20 / SMA50  | 25 % | 2 % → 25 %             |

Se separa la volatilidad *realizada* de la *extensión* frente a las medias porque
un mercado puede ser peligroso por moverse mucho o por cotizar demasiado lejos de
su media.

## Resiliencia frente a la API

La versión gratuita de CoinGecko limita las peticiones por minuto, así que:

- **Cola serializada** con 1,2 s de separación mínima entre peticiones y un único
  reintento con backoff ante 429.
- **Caché en LocalStorage** con TTL por endpoint: mercados 60 s, serie horaria
  10 min, serie diaria 6 h, velas OHLC 30 min. Dentro del TTL no se toca la red.
- **Degradación a caché vencida**: si la red falla o llega un 429, se sirve la
  última copia válida y se muestra el aviso *Datos en caché* con su antigüedad.
- **Estado de error explícito** con botón de reintento cuando no hay ni red ni caché.
- El **polling se pausa** con la pestaña oculta, y las velas OHLC solo se
  descargan si el usuario activa esa vista.

## Accesibilidad y responsive

Enlace de salto al contenido, roles `meter` con `aria-valuenow` en los medidores
de confianza y riesgo, `role="status"` con `aria-live` en el aviso de caché,
`role="alert"` en los errores, foco visible y respeto por
`prefers-reduced-motion`. En escritorio el mercado se muestra como tabla; por
debajo de 768 px pasa a tarjetas, y el gráfico ajusta su altura por breakpoint
mediante `ResizeObserver`.
