import express, { type NextFunction, type Request, type Response } from 'express';
import { authenticate, currentUser } from './lib/auth.ts';
import { loadConfig } from './lib/config.ts';
import { ApiError } from './lib/errors.ts';
import { closePool, describeConnectionError, getPool } from './db/pool.ts';
import { holdingsRouter } from './routes/holdings.ts';
import { analysisRouter } from './routes/analysis.ts';
import { portfolioRouter } from './routes/portfolio.ts';

const config = loadConfig();
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

/**
 * CORS con lista blanca explícita. No se refleja el Origin recibido: eso
 * equivaldría a permitir cualquier origen, y estos endpoints escriben datos.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// La salud no exige identidad: es lo que consulta el cliente para saber si
// puede usar la API o debe caer al modo local.
app.get('/api/health', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ ok: true, database: 'up' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'down', message: describeConnectionError(error) });
  }
});

app.use('/api', authenticate());

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({
    id: user.id,
    displayName: user.displayName,
    roles: user.roles,
    permissions: [...user.permissions].sort(),
    // Deja explícito que todavía no hay login: el cliente no debe deducirlo.
    authMode: 'local-single-user',
  });
});

app.use('/api/holdings', holdingsRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/portfolio', portfolioRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Ruta no encontrada.' } });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  // Los errores no previstos se registran completos pero se devuelven
  // genéricos: un mensaje de Postgres puede filtrar nombres de tablas.
  console.error('[api] error no controlado:', error);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Error interno del servidor.' },
  });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] escuchando en http://${config.host}:${config.port}`);
  console.log(`[api] orígenes CORS permitidos: ${config.corsOrigins.join(', ')}`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    console.warn(
      `[api] AVISO: escuchando en ${config.host}, accesible desde otras máquinas. Sin login, cualquiera que alcance este puerto puede leer y modificar las tenencias.`,
    );
  }
  // Se comprueba la base al arrancar: descubrir que no conecta en la primera
  // petición del navegador convierte un problema de configuración en un fallo
  // difuso de la interfaz.
  getPool()
    .query('SELECT 1')
    .then(() => console.log('[api] conexión con PostgreSQL correcta.'))
    .catch((error) => {
      console.error('[api] no se pudo conectar con PostgreSQL:');
      console.error(describeConnectionError(error));
    });
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} recibido, cerrando…`);
  server.close(() => {
    void closePool().then(() => process.exit(0));
  });
  // Si alguna conexión no cierra, no se deja el proceso colgado para siempre.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
