-- ---------------------------------------------------------------------------
-- Activos, tenencias e histórico de transacciones.
--
-- Los importes usan numeric, nunca float: 0,1 + 0,2 en coma flotante binaria
-- no es 0,3, y aquí se está contando dinero. numeric(38,18) cubre los 18
-- decimales de un token ERC-20 y magnitudes muy por encima de cualquier saldo
-- real.
-- ---------------------------------------------------------------------------

CREATE TYPE asset_kind AS ENUM ('crypto', 'stablecoin', 'fiat');

CREATE TABLE assets (
  id            smallserial PRIMARY KEY,
  symbol        text NOT NULL UNIQUE,
  -- Identificador en CoinGecko; nulo para activos sin cotización propia.
  coingecko_id  text UNIQUE,
  name          text NOT NULL,
  kind          asset_kind NOT NULL DEFAULT 'crypto',
  decimals      smallint NOT NULL DEFAULT 8,
  is_tracked    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Saldo vigente. Es un agregado derivable de holding_transactions, pero se
-- materializa porque la lectura del dashboard es constante y recorrer el
-- histórico en cada carga sería innecesariamente caro.
CREATE TABLE holdings (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id   smallint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  amount     numeric(38,18) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE TYPE holding_change_kind AS ENUM (
  'set',        -- ajuste manual del saldo
  'deposit',
  'withdraw',
  'buy',
  'sell',
  'rotate_in',
  'rotate_out'
);

-- Histórico inmutable: una fila por cada cambio de saldo, con el valor
-- anterior y el posterior. No se actualiza ni se borra nunca.
CREATE TABLE holding_transactions (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id       smallint NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  kind           holding_change_kind NOT NULL DEFAULT 'set',
  amount_before  numeric(38,18) NOT NULL,
  amount_after   numeric(38,18) NOT NULL,
  delta          numeric(38,18) NOT NULL,
  -- Precio del activo en el momento del cambio, para poder reconstruir el
  -- valor de la cartera en el pasado sin depender de la API.
  unit_price_usd numeric(24,8),
  value_usd      numeric(24,8),
  note           text,
  source         text NOT NULL DEFAULT 'web',
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holding_tx_delta_consistent CHECK (delta = amount_after - amount_before)
);
CREATE INDEX holding_tx_user_asset_time_idx
  ON holding_transactions (user_id, asset_id, created_at DESC);
CREATE INDEX holding_tx_user_time_idx
  ON holding_transactions (user_id, created_at DESC);

-- Cotizaciones observadas, para reconstruir la valoración histórica.
CREATE TABLE price_snapshots (
  id               bigserial PRIMARY KEY,
  asset_id         smallint NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  price_usd        numeric(24,8) NOT NULL,
  change_24h_pct   numeric(12,4),
  volume_24h_usd   numeric(24,2),
  market_cap_usd   numeric(24,2),
  captured_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_snapshots_asset_time_idx ON price_snapshots (asset_id, captured_at DESC);

INSERT INTO assets (symbol, coingecko_id, name, kind, decimals) VALUES
  ('BTC',  'bitcoin',     'Bitcoin',  'crypto',     8),
  ('ETH',  'ethereum',    'Ethereum', 'crypto',    18),
  ('BNB',  'binancecoin', 'BNB',      'crypto',    18),
  ('USDT', 'tether',      'Tether',   'stablecoin', 6);
