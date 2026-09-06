-- ---------------------------------------------------------------------------
-- Histórico de análisis: una ejecución por cada recálculo, con las señales,
-- las recomendaciones de cartera, la oportunidad corta y la foto de totales.
--
-- Se guardan las magnitudes en columnas propias (consultables y agregables) y
-- además el detalle completo en jsonb, para no perder información cuando el
-- motor evolucione y añada campos que hoy no existen.
-- ---------------------------------------------------------------------------

CREATE TABLE analysis_runs (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Versión del motor: sin ella, comparar recomendaciones de fechas distintas
  -- mezcla criterios que pueden haber cambiado.
  engine_version text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'manual',
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analysis_runs_user_time_idx ON analysis_runs (user_id, generated_at DESC);

CREATE TYPE signal_action AS ENUM ('BUY', 'SELL', 'WAIT');

CREATE TABLE analysis_signals (
  id           bigserial PRIMARY KEY,
  run_id       bigint NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  asset_id     smallint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timeframe    text NOT NULL,
  action       signal_action NOT NULL,
  confidence   smallint NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  rsi          numeric(8,4),
  macd         numeric(24,8),
  macd_signal  numeric(24,8),
  histogram    numeric(24,8),
  risk_level   smallint CHECK (risk_level BETWEEN 1 AND 5),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, asset_id, timeframe)
);
CREATE INDEX analysis_signals_run_idx ON analysis_signals (run_id);

CREATE TYPE position_action AS ENUM ('HOLD', 'ROTATE', 'TO_USDT', 'ENTER', 'STAY_USDT');

CREATE TABLE portfolio_recommendations (
  id              bigserial PRIMARY KEY,
  run_id          bigint NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  asset_id        smallint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action          position_action NOT NULL,
  target_asset_id smallint REFERENCES assets(id) ON DELETE SET NULL,
  score           smallint,
  amount          numeric(38,18) NOT NULL,
  value_usd       numeric(24,8) NOT NULL,
  weight_pct      numeric(9,4) NOT NULL,
  headline        text NOT NULL,
  detail          text,
  UNIQUE (run_id, asset_id)
);

CREATE TABLE short_term_opportunities (
  id                bigserial PRIMARY KEY,
  run_id            bigint NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  -- Nulo cuando el filtro no propone ninguna entrada; esa ausencia también es
  -- un resultado que interesa conservar para medir el sistema.
  asset_id          smallint REFERENCES assets(id) ON DELETE SET NULL,
  score             smallint,
  rising            boolean NOT NULL DEFAULT false,
  entry_price       numeric(24,8),
  stop_loss         numeric(24,8),
  stop_distance_pct numeric(9,4),
  position_usd      numeric(24,8),
  units             numeric(38,18),
  risk_per_trade_pct numeric(6,3),
  effective_risk_pct numeric(6,3),
  horizon_hours     smallint,
  targets           jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id)
);

CREATE TABLE portfolio_snapshots (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id            bigint REFERENCES analysis_runs(id) ON DELETE SET NULL,
  total_value_usd   numeric(24,8) NOT NULL,
  crypto_value_usd  numeric(24,8) NOT NULL,
  stable_value_usd  numeric(24,8) NOT NULL,
  exposure_pct      numeric(9,4) NOT NULL,
  source            text NOT NULL DEFAULT 'analysis',
  captured_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_snapshots_user_time_idx
  ON portfolio_snapshots (user_id, captured_at DESC);

CREATE TABLE portfolio_snapshot_positions (
  snapshot_id bigint NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
  asset_id    smallint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  amount      numeric(38,18) NOT NULL,
  price_usd   numeric(24,8) NOT NULL,
  value_usd   numeric(24,8) NOT NULL,
  weight_pct  numeric(9,4) NOT NULL,
  PRIMARY KEY (snapshot_id, asset_id)
);
