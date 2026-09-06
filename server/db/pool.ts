import pg from 'pg';
import { loadConfig } from '../lib/config.ts';

/**
 * node-postgres devuelve numeric como string para no perder precisión al
 * convertirlo a un double de JavaScript. Ese comportamiento se conserva a
 * propósito: los importes se convierten a número solo en el borde de la API,
 * donde ya se sabe que la magnitud cabe sin error apreciable.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const config = loadConfig();
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (error) => {
    // Un cliente inactivo que muere no debe tumbar el proceso.
    console.error('[db] error en cliente inactivo del pool:', error.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

/** Ejecuta una función dentro de una transacción, con rollback ante cualquier error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
