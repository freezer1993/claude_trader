import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, describeConnectionError, getPool } from './pool.ts';

/**
 * Ejecutor de migraciones mínimo: aplica en orden los .sql de este directorio
 * que aún no consten en schema_migrations, cada uno en su propia transacción.
 * Se prefiere a una herramienta externa porque el esquema es pequeño y así el
 * proyecto no arrastra otra dependencia con su propio ciclo de vida.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureRegistry(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(rows.map((row) => row.name));
}

/** Elimina el esquema público entero. Solo para desarrollo. */
async function reset(): Promise<void> {
  console.warn('[migrate] --reset: se elimina y recrea el esquema public.');
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

async function main(): Promise<void> {
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) await reset();

  await ensureRegistry();
  const applied = await appliedMigrations();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] aplicada ${file}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[migrate] falló ${file}:`, error instanceof Error ? error.message : error);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(
    count === 0 ? '[migrate] sin migraciones pendientes.' : `[migrate] ${count} migración(es) aplicadas.`,
  );
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('[migrate] error:', describeConnectionError(error));
    await closePool();
    process.exit(1);
  });
