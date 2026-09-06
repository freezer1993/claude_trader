import { Router } from 'express';
import { getPool } from '../db/pool.ts';
import { currentUser, requirePermission } from '../lib/auth.ts';
import { asNumber } from '../lib/validate.ts';

export const portfolioRouter = Router();

/** Serie de valoraciones de la cartera, para graficar su evolución. */
portfolioRouter.get('/history', requirePermission('portfolio:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const limit = req.query.limit === undefined ? 200 : asNumber(req.query.limit, 'limit', 1, 1000);

    const { rows } = await getPool().query(
      `
      SELECT id,
             run_id,
             total_value_usd::text,
             crypto_value_usd::text,
             stable_value_usd::text,
             exposure_pct::text,
             source,
             captured_at
        FROM portfolio_snapshots
       WHERE user_id = $1
       ORDER BY captured_at DESC
       LIMIT $2
      `,
      [user.id, limit],
    );

    res.json({ snapshots: rows });
  } catch (error) {
    next(error);
  }
});

/**
 * Resumen para la cabecera: valoración actual, la anterior y la variación
 * entre ambas. Se calcula en SQL con LAG en vez de traer la serie al cliente,
 * porque el dato que se pinta es una sola cifra.
 */
portfolioRouter.get('/summary', requirePermission('portfolio:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);

    const { rows } = await getPool().query(
      `
      WITH ordered AS (
        SELECT total_value_usd,
               captured_at,
               LAG(total_value_usd) OVER (ORDER BY captured_at) AS previous_value
          FROM portfolio_snapshots
         WHERE user_id = $1
      )
      SELECT total_value_usd::text AS current_value,
             previous_value::text,
             CASE
               WHEN previous_value IS NULL OR previous_value = 0 THEN NULL
               ELSE ((total_value_usd - previous_value) / previous_value * 100)::numeric(9,4)::text
             END AS change_pct,
             captured_at
        FROM ordered
       ORDER BY captured_at DESC
       LIMIT 1
      `,
      [user.id],
    );

    const counts = await getPool().query<{ runs: number; transactions: number }>(
      `
      SELECT (SELECT count(*) FROM analysis_runs WHERE user_id = $1)        AS runs,
             (SELECT count(*) FROM holding_transactions WHERE user_id = $1) AS transactions
      `,
      [user.id],
    );

    res.json({
      latest: rows[0] ?? null,
      totals: counts.rows[0] ?? { runs: 0, transactions: 0 },
    });
  } catch (error) {
    next(error);
  }
});
