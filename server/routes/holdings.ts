import { Router, type Request } from 'express';
import { getPool, withTransaction } from '../db/pool.ts';
import { currentUser, requirePermission } from '../lib/auth.ts';
import { ApiError } from '../lib/errors.ts';
import {
  asDecimalString,
  asEnum,
  asNumber,
  asOptionalDecimalString,
  asOptionalString,
} from '../lib/validate.ts';

export const holdingsRouter = Router();

const CHANGE_KINDS = [
  'set',
  'deposit',
  'withdraw',
  'buy',
  'sell',
  'rotate_in',
  'rotate_out',
] as const;

interface HoldingRow {
  symbol: string;
  name: string;
  kind: string;
  amount: string;
  updated_at: string | null;
}

holdingsRouter.get('/', requirePermission('holdings:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    // LEFT JOIN sobre assets: un activo sin tenencia debe aparecer con saldo 0,
    // no desaparecer, porque el formulario del cliente necesita su fila.
    const { rows } = await getPool().query<HoldingRow>(
      `
      SELECT a.symbol,
             a.name,
             a.kind::text,
             COALESCE(h.amount, 0)::text AS amount,
             h.updated_at
        FROM assets a
        LEFT JOIN holdings h ON h.asset_id = a.id AND h.user_id = $1
       WHERE a.is_tracked
       ORDER BY a.id
      `,
      [user.id],
    );

    res.json({
      holdings: rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        kind: row.kind,
        amount: row.amount,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

async function assetIdBySymbol(symbol: string): Promise<number> {
  const { rows } = await getPool().query<{ id: number }>(
    'SELECT id FROM assets WHERE symbol = $1',
    [symbol],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw ApiError.notFound(`El activo "${symbol}" no existe.`);
  return id;
}

/** Express 5 tipa los parámetros de ruta como string | string[]; aquí siempre es uno. */
function pathParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? req.socket.remoteAddress);
  const ip = raw?.split(',')[0]?.trim();
  return ip && ip.length > 0 ? ip : null;
}

/**
 * Fija el saldo de un activo. Saldo, histórico y auditoría se escriben en la
 * misma transacción: si cualquiera fallara por separado, el saldo mostrado y
 * su histórico dejarían de cuadrar, que es justo lo que este endpoint existe
 * para evitar.
 */
holdingsRouter.put('/:symbol', requirePermission('holdings:write'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const symbol = pathParam(req.params.symbol).toUpperCase();
    const body = req.body ?? {};

    const amount = asDecimalString(body.amount, 'amount');
    const kind = body.kind === undefined ? 'set' : asEnum(body.kind, 'kind', CHANGE_KINDS);
    const note = asOptionalString(body.note, 'note', 500);
    const unitPrice = asOptionalDecimalString(body.unitPriceUsd, 'unitPriceUsd');
    const assetId = await assetIdBySymbol(symbol);
    const ip = clientIp(req);

    const result = await withTransaction(async (client) => {
      /*
       * Bloqueo consultivo por (usuario, activo) antes de leer el saldo.
       *
       * No sirve un SELECT ... FOR UPDATE: la primera vez que se guarda un
       * activo la fila de holdings todavía no existe, y FOR UPDATE sobre cero
       * filas no bloquea nada. Varias peticiones simultáneas leerían entonces
       * amount_before = 0 y el histórico registraría deltas falsos, rompiendo
       * la cadena que enlaza cada movimiento con el anterior. El bloqueo
       * consultivo existe aunque la fila no, y se libera al cerrar la
       * transacción.
       */
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', [user.id, assetId]);

      const before = await client.query<{ amount: string }>(
        'SELECT amount::text FROM holdings WHERE user_id = $1 AND asset_id = $2 FOR UPDATE',
        [user.id, assetId],
      );
      const amountBefore = before.rows[0]?.amount ?? '0';

      const updated = await client.query<{ amount: string; updated_at: string }>(
        `
        INSERT INTO holdings (user_id, asset_id, amount, updated_at)
        VALUES ($1, $2, $3::numeric, now())
        ON CONFLICT (user_id, asset_id)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
        RETURNING amount::text, updated_at
        `,
        [user.id, assetId, amount],
      );

      const transaction = await client.query<{ id: number; created_at: string; delta: string }>(
        `
        INSERT INTO holding_transactions
          (user_id, asset_id, kind, amount_before, amount_after, delta,
           unit_price_usd, value_usd, note, source, created_by)
        VALUES
          ($1, $2, $3,
           $4::numeric, $5::numeric, $5::numeric - $4::numeric,
           $6::numeric,
           CASE WHEN $6 IS NULL THEN NULL ELSE $5::numeric * $6::numeric END,
           $7, $8, $1)
        RETURNING id, created_at, delta::text
        `,
        [user.id, assetId, kind, amountBefore, amount, unitPrice, note, 'web'],
      );

      await client.query(
        `
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
        VALUES ($1, 'holding.update', 'holding', $2, $3::jsonb, $4::jsonb, $5)
        `,
        [
          user.id,
          `${user.id}:${symbol}`,
          JSON.stringify({ symbol, amount: amountBefore }),
          JSON.stringify({ symbol, amount, kind, note }),
          ip,
        ],
      );

      return {
        amount: updated.rows[0]?.amount ?? amount,
        updatedAt: updated.rows[0]?.updated_at ?? null,
        transaction: {
          id: transaction.rows[0]?.id,
          delta: transaction.rows[0]?.delta ?? '0',
          createdAt: transaction.rows[0]?.created_at ?? null,
        },
        amountBefore,
      };
    });

    res.json({
      ok: true,
      symbol,
      amount: result.amount,
      amountBefore: result.amountBefore,
      updatedAt: result.updatedAt,
      transaction: result.transaction,
    });
  } catch (error) {
    next(error);
  }
});

holdingsRouter.get('/:symbol/history', requirePermission('holdings:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const symbol = pathParam(req.params.symbol).toUpperCase();
    const limit = req.query.limit === undefined ? 50 : asNumber(req.query.limit, 'limit', 1, 500);
    const assetId = await assetIdBySymbol(symbol);

    const { rows } = await getPool().query(
      `
      SELECT id,
             kind::text,
             amount_before::text,
             amount_after::text,
             delta::text,
             unit_price_usd::text,
             value_usd::text,
             note,
             source,
             created_at
        FROM holding_transactions
       WHERE user_id = $1 AND asset_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3
      `,
      [user.id, assetId, limit],
    );

    res.json({ symbol, transactions: rows });
  } catch (error) {
    next(error);
  }
});

/** Histórico de movimientos de todos los activos, para la vista de actividad. */
holdingsRouter.get('/history/all', requirePermission('holdings:read'), async (req, res, next) => {
  try {
    const user = currentUser(req);
    const limit = req.query.limit === undefined ? 100 : asNumber(req.query.limit, 'limit', 1, 500);

    const { rows } = await getPool().query(
      `
      SELECT t.id,
             a.symbol,
             t.kind::text,
             t.amount_before::text,
             t.amount_after::text,
             t.delta::text,
             t.unit_price_usd::text,
             t.value_usd::text,
             t.note,
             t.created_at
        FROM holding_transactions t
        JOIN assets a ON a.id = t.asset_id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $2
      `,
      [user.id, limit],
    );

    res.json({ transactions: rows });
  } catch (error) {
    next(error);
  }
});
