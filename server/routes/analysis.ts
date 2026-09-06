import { Router } from 'express';
import { getPool, withTransaction } from '../db/pool.ts';
import { currentUser, requirePermission } from '../lib/auth.ts';
import { loadConfig } from '../lib/config.ts';
import { ApiError } from '../lib/errors.ts';
import {
  asArray,
  asEnum,
  asNumber,
  asObject,
  asOptionalNumber,
  asOptionalString,
  asString,
} from '../lib/validate.ts';

export const analysisRouter = Router();

const SIGNAL_ACTIONS = ['BUY', 'SELL', 'WAIT'] as const;
const POSITION_ACTIONS = ['HOLD', 'ROTATE', 'TO_USDT', 'ENTER', 'STAY_USDT'] as const;

async function symbolToIdMap(): Promise<Map<string, number>> {
  const { rows } = await getPool().query<{ id: number; symbol: string }>(
    'SELECT id, symbol FROM assets',
  );
  return new Map(rows.map((row) => [row.symbol, row.id]));
}

function requireAssetId(map: Map<string, number>, symbol: string, field: string): number {
  const id = map.get(symbol.toUpperCase());
  if (id === undefined) throw ApiError.badRequest(`"${field}" referencia un activo desconocido: ${symbol}.`);
  return id;
}

/**
 * Registra una ejecución completa del análisis: señales por activo y
 * temporalidad, recomendaciones de cartera, oportunidad corta y la foto de
 * totales con sus posiciones.
 *
 * Todo va en una transacción porque las cuatro partes son un mismo hecho: una
 * ejecución guardada a medias produciría un histórico con recomendaciones sin
 * las señales que las justifican.
 */
analysisRouter.post('/runs', requirePermission('analysis:write'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const config = loadConfig();
    const body = asObject(req.body, 'body');

    const triggerSource = asOptionalString(body.triggerSource, 'triggerSource', 40) ?? 'manual';
    const params = body.params === undefined ? {} : asObject(body.params, 'params');
    const signals = asArray(body.signals ?? [], 'signals', 50);
    const recommendations = asArray(body.recommendations ?? [], 'recommendations', 50);
    const snapshot = body.snapshot === undefined ? null : asObject(body.snapshot, 'snapshot');
    const shortTerm = body.shortTerm === undefined || body.shortTerm === null
      ? null
      : asObject(body.shortTerm, 'shortTerm');

    const assetMap = await symbolToIdMap();

    const runId = await withTransaction(async (client) => {
      const run = await client.query<{ id: number }>(
        `
        INSERT INTO analysis_runs (user_id, engine_version, trigger_source, params)
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING id
        `,
        [user.id, config.engineVersion, triggerSource, JSON.stringify(params)],
      );
      const id = run.rows[0]?.id;
      if (id === undefined) throw new Error('No se pudo crear la ejecución de análisis.');

      for (const entry of signals) {
        const signal = asObject(entry, 'signals[]');
        await client.query(
          `
          INSERT INTO analysis_signals
            (run_id, asset_id, timeframe, action, confidence, rsi, macd, macd_signal, histogram, risk_level, payload)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
          ON CONFLICT (run_id, asset_id, timeframe) DO NOTHING
          `,
          [
            id,
            requireAssetId(assetMap, asString(signal.symbol, 'signals[].symbol', 20), 'signals[].symbol'),
            asString(signal.timeframe, 'signals[].timeframe', 10),
            asEnum(signal.action, 'signals[].action', SIGNAL_ACTIONS),
            asNumber(signal.confidence, 'signals[].confidence', 0, 100),
            asOptionalNumber(signal.rsi, 'signals[].rsi'),
            asOptionalNumber(signal.macd, 'signals[].macd'),
            asOptionalNumber(signal.macdSignal, 'signals[].macdSignal'),
            asOptionalNumber(signal.histogram, 'signals[].histogram'),
            asOptionalNumber(signal.riskLevel, 'signals[].riskLevel', 1, 5),
            JSON.stringify(signal.payload ?? {}),
          ],
        );
      }

      for (const entry of recommendations) {
        const rec = asObject(entry, 'recommendations[]');
        const targetSymbol = asOptionalString(rec.targetSymbol, 'recommendations[].targetSymbol', 20);
        await client.query(
          `
          INSERT INTO portfolio_recommendations
            (run_id, asset_id, action, target_asset_id, score, amount, value_usd, weight_pct, headline, detail)
          VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9, $10)
          ON CONFLICT (run_id, asset_id) DO NOTHING
          `,
          [
            id,
            requireAssetId(assetMap, asString(rec.symbol, 'recommendations[].symbol', 20), 'recommendations[].symbol'),
            asEnum(rec.action, 'recommendations[].action', POSITION_ACTIONS),
            targetSymbol ? requireAssetId(assetMap, targetSymbol, 'recommendations[].targetSymbol') : null,
            asOptionalNumber(rec.score, 'recommendations[].score', -100, 100),
            asNumber(rec.amount, 'recommendations[].amount', 0),
            asNumber(rec.valueUsd, 'recommendations[].valueUsd', 0),
            asNumber(rec.weightPct, 'recommendations[].weightPct', 0, 100),
            asString(rec.headline, 'recommendations[].headline', 200),
            asOptionalString(rec.detail, 'recommendations[].detail', 2000),
          ],
        );
      }

      if (shortTerm) {
        const symbol = asOptionalString(shortTerm.symbol, 'shortTerm.symbol', 20);
        await client.query(
          `
          INSERT INTO short_term_opportunities
            (run_id, asset_id, score, rising, entry_price, stop_loss, stop_distance_pct,
             position_usd, units, risk_per_trade_pct, effective_risk_pct, horizon_hours, targets, payload)
          VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric,
                  $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12, $13::jsonb, $14::jsonb)
          `,
          [
            id,
            symbol ? requireAssetId(assetMap, symbol, 'shortTerm.symbol') : null,
            asOptionalNumber(shortTerm.score, 'shortTerm.score', 0, 100),
            shortTerm.rising === true,
            asOptionalNumber(shortTerm.entryPrice, 'shortTerm.entryPrice', 0),
            asOptionalNumber(shortTerm.stopLoss, 'shortTerm.stopLoss', 0),
            asOptionalNumber(shortTerm.stopDistancePct, 'shortTerm.stopDistancePct', 0),
            asOptionalNumber(shortTerm.positionUsd, 'shortTerm.positionUsd', 0),
            asOptionalNumber(shortTerm.units, 'shortTerm.units', 0),
            asOptionalNumber(shortTerm.riskPerTradePct, 'shortTerm.riskPerTradePct', 0, 100),
            asOptionalNumber(shortTerm.effectiveRiskPct, 'shortTerm.effectiveRiskPct', 0, 100),
            asOptionalNumber(shortTerm.horizonHours, 'shortTerm.horizonHours', 1, 8760),
            JSON.stringify(shortTerm.targets ?? []),
            JSON.stringify(shortTerm.payload ?? {}),
          ],
        );
      }

      if (snapshot) {
        const snap = await client.query<{ id: number }>(
          `
          INSERT INTO portfolio_snapshots
            (user_id, run_id, total_value_usd, crypto_value_usd, stable_value_usd, exposure_pct, source)
          VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, 'analysis')
          RETURNING id
          `,
          [
            user.id,
            id,
            asNumber(snapshot.totalValueUsd, 'snapshot.totalValueUsd', 0),
            asNumber(snapshot.cryptoValueUsd, 'snapshot.cryptoValueUsd', 0),
            asNumber(snapshot.stableValueUsd, 'snapshot.stableValueUsd', 0),
            asNumber(snapshot.exposurePct, 'snapshot.exposurePct', 0, 100),
          ],
        );
        const snapshotId = snap.rows[0]?.id;

        for (const entry of asArray(snapshot.positions ?? [], 'snapshot.positions', 50)) {
          const position = asObject(entry, 'snapshot.positions[]');
          await client.query(
            `
            INSERT INTO portfolio_snapshot_positions
              (snapshot_id, asset_id, amount, price_usd, value_usd, weight_pct)
            VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric)
            ON CONFLICT (snapshot_id, asset_id) DO NOTHING
            `,
            [
              snapshotId,
              requireAssetId(assetMap, asString(position.symbol, 'snapshot.positions[].symbol', 20), 'snapshot.positions[].symbol'),
              asNumber(position.amount, 'snapshot.positions[].amount', 0),
              asNumber(position.priceUsd, 'snapshot.positions[].priceUsd', 0),
              asNumber(position.valueUsd, 'snapshot.positions[].valueUsd', 0),
              asNumber(position.weightPct, 'snapshot.positions[].weightPct', 0, 100),
            ],
          );
        }
      }

      // Cotizaciones observadas: permiten reconstruir valoraciones pasadas sin
      // volver a pedirlas a CoinGecko, que no ofrece histórico gratuito fino.
      for (const entry of asArray(body.prices ?? [], 'prices', 50)) {
        const price = asObject(entry, 'prices[]');
        await client.query(
          `
          INSERT INTO price_snapshots (asset_id, price_usd, change_24h_pct, volume_24h_usd, market_cap_usd)
          VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5::numeric)
          `,
          [
            requireAssetId(assetMap, asString(price.symbol, 'prices[].symbol', 20), 'prices[].symbol'),
            asNumber(price.priceUsd, 'prices[].priceUsd', 0),
            asOptionalNumber(price.change24hPct, 'prices[].change24hPct'),
            asOptionalNumber(price.volume24hUsd, 'prices[].volume24hUsd', 0),
            asOptionalNumber(price.marketCapUsd, 'prices[].marketCapUsd', 0),
          ],
        );
      }

      return id;
    });

    res.status(201).json({ ok: true, runId });
  } catch (error) {
    next(error);
  }
});

analysisRouter.get('/runs', requirePermission('analysis:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const limit = req.query.limit === undefined ? 20 : asNumber(req.query.limit, 'limit', 1, 200);

    const { rows } = await getPool().query(
      `
      SELECT r.id,
             r.engine_version,
             r.trigger_source,
             r.generated_at,
             s.total_value_usd::text,
             s.crypto_value_usd::text,
             s.stable_value_usd::text,
             s.exposure_pct::text,
             o.score          AS short_term_score,
             oa.symbol        AS short_term_symbol,
             (SELECT count(*) FROM portfolio_recommendations pr WHERE pr.run_id = r.id) AS recommendation_count
        FROM analysis_runs r
        LEFT JOIN portfolio_snapshots s      ON s.run_id = r.id
        LEFT JOIN short_term_opportunities o ON o.run_id = r.id
        LEFT JOIN assets oa                  ON oa.id = o.asset_id
       WHERE r.user_id = $1
       ORDER BY r.generated_at DESC
       LIMIT $2
      `,
      [user.id, limit],
    );

    res.json({ runs: rows });
  } catch (error) {
    next(error);
  }
});

analysisRouter.get('/runs/:id', requirePermission('analysis:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const id = asNumber(req.params.id, 'id', 1);

    const run = await getPool().query(
      'SELECT id, engine_version, trigger_source, params, generated_at FROM analysis_runs WHERE id = $1 AND user_id = $2',
      [id, user.id],
    );
    if (run.rows.length === 0) throw ApiError.notFound('La ejecución no existe.');

    const [signals, recommendations, shortTerm, snapshot] = await Promise.all([
      getPool().query(
        `SELECT a.symbol, s.timeframe, s.action::text, s.confidence, s.rsi::text, s.macd::text,
                s.macd_signal::text, s.histogram::text, s.risk_level, s.payload
           FROM analysis_signals s JOIN assets a ON a.id = s.asset_id
          WHERE s.run_id = $1 ORDER BY a.id, s.timeframe`,
        [id],
      ),
      getPool().query(
        `SELECT a.symbol, r.action::text, t.symbol AS target_symbol, r.score,
                r.amount::text, r.value_usd::text, r.weight_pct::text, r.headline, r.detail
           FROM portfolio_recommendations r
           JOIN assets a ON a.id = r.asset_id
           LEFT JOIN assets t ON t.id = r.target_asset_id
          WHERE r.run_id = $1 ORDER BY a.id`,
        [id],
      ),
      getPool().query(
        `SELECT a.symbol, o.score, o.rising, o.entry_price::text, o.stop_loss::text,
                o.stop_distance_pct::text, o.position_usd::text, o.units::text,
                o.risk_per_trade_pct::text, o.effective_risk_pct::text, o.horizon_hours, o.targets
           FROM short_term_opportunities o LEFT JOIN assets a ON a.id = o.asset_id
          WHERE o.run_id = $1`,
        [id],
      ),
      getPool().query(
        `SELECT total_value_usd::text, crypto_value_usd::text, stable_value_usd::text,
                exposure_pct::text, captured_at
           FROM portfolio_snapshots WHERE run_id = $1`,
        [id],
      ),
    ]);

    res.json({
      run: run.rows[0],
      signals: signals.rows,
      recommendations: recommendations.rows,
      shortTerm: shortTerm.rows[0] ?? null,
      snapshot: snapshot.rows[0] ?? null,
    });
  } catch (error) {
    next(error);
  }
});
