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

/**
 * Traduce los fallos de conexión más habituales a una instrucción concreta.
 * El error crudo de node-postgres ("role does not exist") no dice qué hacer, y
 * en macOS con Homebrew el superusuario es el propio usuario del sistema, no
 * "postgres", así que la cadena de ejemplo falla en la mayoría de instalaciones.
 */
export function describeConnectionError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);
  const url = process.env.DATABASE_URL ?? '(sin DATABASE_URL)';
  const user = safeUser(url);

  switch (code) {
    case 'ECONNREFUSED':
      return [
        'PostgreSQL no acepta conexiones en el host y puerto indicados.',
        '  · ¿Está arrancado?  macOS: brew services start postgresql@16',
        '  · Linux: sudo systemctl start postgresql',
        `  · Cadena en uso: ${redact(url)}`,
      ].join('\n');
    case 'ENOTFOUND':
      return `No se resuelve el host de DATABASE_URL. Revisa la cadena: ${redact(url)}`;
    case '28P01':
      return `Contraseña incorrecta para el usuario "${user}".`;
    case '28000':
      return [
        `El rol "${user}" no existe en este servidor.`,
        '  · En macOS con Homebrew el superusuario es tu usuario del sistema, no "postgres".',
        `  · Prueba: DATABASE_URL=postgres://${process.env.USER ?? 'tu-usuario'}@localhost:5432/claude_trader`,
        `  · O créalo: createuser -s ${user}`,
      ].join('\n');
    case '3D000':
      return [
        'La base de datos indicada no existe.',
        '  · Créala con:  createdb claude_trader',
      ].join('\n');
    default:
      return message;
  }
}

function safeUser(url: string): string {
  try {
    return decodeURIComponent(new URL(url).username) || '(sin usuario)';
  } catch {
    return '(desconocido)';
  }
}

/** Nunca se registra la contraseña, ni siquiera en un mensaje de error local. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(DATABASE_URL con formato inválido)';
  }
}
