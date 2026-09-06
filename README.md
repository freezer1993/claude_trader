# Claude Trader — Dashboard de análisis cripto (BTC · ETH · BNB)

SPA de análisis técnico para Bitcoin, Ethereum y BNB. Consume la API pública de
CoinGecko, calcula MACD y RSI **en el cliente** y traduce esos indicadores en una
recomendación de movimiento diario junto con una calificación de riesgo de 1 a 5.

> Contenido informativo. No es asesoramiento financiero.

## Requisitos

**PostgreSQL 14+** para el histórico, y **Node.js 20.19+ o 22.12+** (recomendado: 22 LTS). Lo imponen Vite 8, su motor
Rolldown y `@vitejs/plugin-react`; `react-router-dom` 7 exige Node 20 como
mínimo. El repositorio incluye `.nvmrc` y `engine-strict=true`, de modo que
`npm install` falla con un mensaje explícito en versiones no soportadas.

Con [nvm](https://github.com/nvm-sh/nvm) o
[nvm-windows](https://github.com/coreybutler/nvm-windows):

```bash
nvm install 22
nvm use 22
node -v          # debe imprimir v22.x
```

## Puesta en marcha

```bash
npm install
cp .env.example .env          # ajusta DATABASE_URL
createdb claude_trader        # o CREATE DATABASE desde psql
npm run db:migrate            # aplica el esquema
npm run dev:all               # API (:3001) + frontend (:5173)
```

Por separado: `npm run dev` (frontend), `npm run dev:api` (API),
`npm run build` (compilación de producción), `npm run db:reset` (recrea el
esquema desde cero, solo desarrollo).

Los precios siguen viniendo del navegador contra la API pública de CoinGecko,
sin clave. El backend solo guarda tenencias, movimientos y análisis.

**Sin base de datos la aplicación sigue funcionando**: si el API no responde,
las tenencias vuelven a LocalStorage y la interfaz lo indica con la etiqueta
*Solo este navegador*. Se pierde el histórico, no el análisis.

### Resolución de problemas

**`SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`**

Estás ejecutando Node 18 o anterior. `styleText` se añadió en Node 20.12 y
Rolldown (el empaquetador de Vite 8) lo importa al arrancar. Actualiza a Node 22
LTS y reinstala:

```bash
nvm install 22 && nvm use 22
rm -rf node_modules package-lock.json   # en PowerShell: Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

## Stack

React 19 · TypeScript 5.9 (modo estricto) · Vite 8 · Tailwind CSS 4 ·
react-router-dom 7 · Lightweight Charts 5 (TradingView). Sin más dependencias.

## Persistencia

### Esquema

Cuatro migraciones en `server/db/migrations/`, aplicadas en orden por
`npm run db:migrate` y registradas en `schema_migrations`.

| Bloque | Tablas |
| ------ | ------ |
| Identidad | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `auth_sessions`, `api_tokens`, `audit_log` |
| Cartera | `assets`, `holdings`, `holding_transactions`, `price_snapshots` |
| Análisis | `analysis_runs`, `analysis_signals`, `portfolio_recommendations`, `short_term_opportunities`, `portfolio_snapshots`, `portfolio_snapshot_positions` |

Decisiones que conviene conocer antes de tocar el esquema:

- **Las tablas de identidad existen desde la primera migración**, aunque el
  login todavía no. El resto del esquema referencia `user_id` con clave ajena,
  y añadir esa columna más tarde obligaría a migrar datos ya escritos. Un
  usuario local semilla (UUID fijo `00000000-…-0001`) ocupa el hueco.
- **Los importes son `numeric(38,18)`, nunca `float`.** En coma flotante
  binaria 0,1 + 0,2 no es 0,3, y aquí se cuenta dinero. El cliente envía la
  cantidad como **cadena canónica**, no como número: convertir "0,1" a double y
  volver a texto produce `0.100000000000000006`, que es exactamente el error
  que `numeric` evita.
- **`holding_transactions` es inmutable.** Cada cambio guarda el saldo anterior,
  el posterior y el delta, con una restricción que obliga a que cuadren. El
  saldo vigente en `holdings` es un agregado materializado por rendimiento.
- **Cada análisis se archiva entero o no se archiva.** Señales,
  recomendaciones, oportunidad y foto de totales van en una transacción: un
  registro a medias daría recomendaciones sin las señales que las justifican.

### Concurrencia

Guardar un saldo toma un **bloqueo consultivo** por `(usuario, activo)` antes
de leer el valor anterior:

```sql
SELECT pg_advisory_xact_lock(hashtext($user_id), $asset_id);
```

No sirve `SELECT ... FOR UPDATE`: la primera vez que se guarda un activo la
fila de `holdings` aún no existe, y bloquear cero filas no bloquea nada. Con 25
escrituras simultáneas sobre un activo nuevo, esa versión rompía la cadena de
saldos; con el bloqueo consultivo, 0 rupturas.

### API

Todas las rutas bajo `/api` pasan por `authenticate()` y declaran el permiso
que exigen con `requirePermission()`.

| Método | Ruta | Permiso |
| ------ | ---- | ------- |
| GET | `/api/health` | — |
| GET | `/api/me` | — |
| GET | `/api/holdings` | `holdings:read` |
| PUT | `/api/holdings/:symbol` | `holdings:write` |
| GET | `/api/holdings/:symbol/history` | `holdings:read` |
| GET | `/api/holdings/history/all` | `holdings:read` |
| POST | `/api/analysis/runs` | `analysis:write` |
| GET | `/api/analysis/runs` | `analysis:read` |
| GET | `/api/analysis/runs/:id` | `analysis:read` |
| GET | `/api/portfolio/history` | `portfolio:read` |
| GET | `/api/portfolio/summary` | `portfolio:read` |

### Preparado para el login

`server/lib/auth.ts` es el **único** punto que da por hecho un usuario fijo.
Hoy `resolveUser` devuelve el usuario local configurado, pero ya carga sus
roles y permisos reales desde la base. Para añadir autenticación:

1. Leer el `Authorization: Bearer` en `authenticate()` y validarlo contra
   `api_tokens.token_hash` o `auth_sessions.refresh_token_hash`.
2. Devolver el usuario de ese token en lugar del local.
3. Rellenar `users.password_hash` (argon2 o bcrypt) en el alta.

Las rutas no se tocan: ya exigen permisos, ya filtran por `user_id` y el
`audit_log` ya registra quién hizo cada cambio.

## Guardado de tenencias

El campo de cantidad es un **borrador**: escribir no guarda. El análisis usa el
saldo confirmado hasta que se pulsa *Guardar* y se acepta el diálogo, que
muestra saldo anterior, nuevo, diferencia y su valor en dólares. Sin esa
separación, cada pulsación de tecla generaría un movimiento en el histórico.

El botón se habilita solo cuando el borrador difiere del saldo guardado (se
comparan en forma canónica, así que "1,50" y "1.5" no cuentan como cambio).
Tras guardar aparece un aviso de éxito con el número de movimiento, o de error
con el motivo; los de error no se descartan solos.

## Arquitectura

```
src/
├── components/   Navbar · CoinTable · CoinChart · AnalysisPanel · RiskPanel
│                 PortfolioPanel · ShortTermPanel · HistoryPanel · HoldingField
│                 ConfirmDialog · ToastViewport · PersistenceBadge
│                 StaleDataBanner · Spinner · ErrorState
├── context/      CoinContext (mercado, tenencias, análisis) · ToastContext
├── hooks/        useCryptoAPI — useMarkets / useDailySeries / useHourlySeries
│                 useCandles / useAllCoinSeries
├── lib/          coingecko (cliente + cola) · storage + cache (LocalStorage) · indicators
│                 strategy (reglas MACD+RSI) · risk (score 1-5) · portfolio
│                 shortTerm (impulso + dimensionamiento) · format
├── pages/        Dashboard · CoinDetail
└── types/        Modelos de dominio compartidos

server/
├── db/           pool · migrate (ejecutor) · migrations/*.sql
├── lib/          config · auth (punto único de identidad) · errors · validate
├── routes/       holdings · analysis · portfolio
└── index.ts      Express: CORS, autenticación, manejo de errores
```

Flujo de datos: `coingecko.ts` → `cache.ts` → `useCryptoAPI` → `CoinContext` →
componentes. Los indicadores se calculan con `useMemo` sobre la serie recibida,
de modo que un re-render por polling no recalcula MACD ni RSI si la serie no ha
cambiado.

### Rutas

| Ruta             | Contenido                                                        |
| ---------------- | ---------------------------------------------------------------- |
| `/`              | Mercado + tenencias + veredicto de cartera + oportunidad corta     |
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

## Cartera y veredicto por posición (`src/lib/portfolio.ts`)

Cada activo recibe una **puntuación de atractivo** en `[-100, 100]`:

- Señal `BUY` → `+confianza`; `SELL` → `−confianza`.
- Sin señal confirmada solo puntúa la inercia de la tendencia diaria, y con
  menos peso: MACD sobre/bajo cero (±12) y RSI por encima de 55 o por debajo de
  45 (±8). Una tendencia no es una señal.
- Penalización por riesgo a partir del punto medio de la escala:
  `−(riesgo − 3) × 12`.

Con esa puntuación se decide cada posición:

| Veredicto           | Condición                                                                        |
| ------------------- | -------------------------------------------------------------------------------- |
| **Mantener**        | Puntuación ≥ −20 y ninguna alternativa la supera por 25 puntos                     |
| **Rotar → X**       | X puntúa ≥ 25 **y** aventaja a la posición actual en ≥ 25 puntos                   |
| **Pasar a USDT**    | Puntuación < −20 y ninguna alternativa alcanza el umbral de entrada                |
| **Entrar desde USDT** | Hay saldo en USDT y el mejor activo puntúa ≥ 25                                  |
| **Seguir en USDT**  | Hay saldo en USDT pero ningún activo alcanza el umbral de entrada                  |

Los umbrales son deliberadamente conservadores: rotar tiene un coste real
(comisiones, spread, deslizamiento, posible evento fiscal) que el modelo **no**
cuantifica, así que solo se propone un cambio cuando la ventaja es amplia, no
marginal. El informe lo advierte de forma explícita.

Detalles de implementación relevantes:

- Las series de las tres monedas **solo se descargan cuando hay al menos una
  tenencia introducida** (6 peticiones); sin cartera el dashboard sigue
  costando una sola llamada.
- El veredicto no se emite hasta que **todas** las series están resueltas.
  Comparar activos con un subconjunto podría recomendar una rotación que se
  invierte al terminar de cargar el resto.
- Las tenencias se guardan en LocalStorage bajo un espacio de nombres distinto
  al de la caché de red, de modo que purgar la caché nunca borra datos del
  usuario.
- El campo de cantidad acepta coma o punto decimal pero **rechaza el separador
  de millares**: en español `1.500` es ambiguo, y un error de escala en una
  cantidad de cripto es un error de dinero. Validador y parser comparten un
  único patrón, así que lo que se marca en rojo y lo que se calcula nunca
  discrepan. El valor en dólares junto al campo da realimentación inmediata.
- USDT se asume anclado a 1 US$; no se consulta su precio.

## Oportunidad a corto plazo (`src/lib/shortTerm.ts`)

Criterio **distinto** al de la cartera: allí pesa la señal confirmada y el
riesgo estructural, y aquí pesa el momentum reciente. Una moneda puede ser
buena para mantener y mala para entrar hoy, y al revés.

### Filtro de tendencia alcista

Cuatro condiciones, todas obligatorias:

| Condición                        | Umbral      |
| -------------------------------- | ----------- |
| Variación en 24 h                | ≥ 0,5 %     |
| Precio sobre su SMA20 horaria    | ≥ 0,2 %     |
| Línea MACD horaria               | > 0         |
| RSI horario                      | entre 45 y 72 |

Dos decisiones de diseño que no son obvias:

- Se usa el **signo de la línea MACD**, no el del histograma. En una tendencia
  sostenida y regular el histograma converge a cero, porque mide la
  *aceleración* del impulso y no el impulso: exigirlo positivo rechazaría justo
  las tendencias más limpias. Que el histograma se expanda sí suma puntuación,
  como bonificación.
- **No** se exige que las últimas horas sean positivas. Un retroceso dentro de
  una tendencia alcista es mejor entrada que comprar el último tramo de subida,
  que es la conducta que ya penaliza el tramo de RSI en sobrecompra.

Si nada supera el filtro, no se propone operación. "La menos mala de tres que
caen" no es una moneda al alza.

### Dimensionamiento de la posición

Riesgo fijo, no porcentaje fijo del saldo: se decide primero cuánto se acepta
perder y el tamaño sale de la distancia al stop. Un porcentaje fijo ignoraría
que una moneda volátil necesita más margen y expone mucho más capital real al
mismo movimiento adverso.

```
σ_horizonte  = σ_horaria × √horas          (escalado temporal de la volatilidad)
stop         = precio × (1 − 1,5 × σ_horizonte)
posición     = (saldo × riesgo%) / distancia_al_stop%
posición     = min(posición, 35 % del saldo)   ← tope duro
```

Objetivos a 1,5R y 2,5R sobre esa misma distancia. El riesgo por operación
(0,5-5 %) y el horizonte (12/24/72 h) son configurables y se guardan.

Cuando el tope de exposición recorta la posición, el panel muestra el **riesgo
efectivo** junto al solicitado, para no atribuir al plan un riesgo que no está
tomando.

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
