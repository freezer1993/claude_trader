/**
 * Configuración del servidor. Todo llega por variables de entorno: el fichero
 * .env se carga con `node --env-file`, sin dependencias añadidas.
 */
export interface ServerConfig {
  port: number;
  databaseUrl: string;
  /**
   * Usuario propietario de los datos mientras no exista login. Es el único
   * punto del código que da por hecho un usuario fijo; cuando se añada
   * autenticación, este valor deja de usarse y el id sale del token.
   */
  localUserId: string;
  corsOrigins: string[];
  engineVersion: string;
}

const DEFAULT_LOCAL_USER = '00000000-0000-4000-8000-000000000001';

export function loadConfig(): ServerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Falta DATABASE_URL. Copia .env.example a .env y ajusta la cadena de conexión.',
    );
  }

  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT no es un puerto válido: ${process.env.PORT}`);
  }

  return {
    port,
    databaseUrl,
    localUserId: process.env.LOCAL_USER_ID ?? DEFAULT_LOCAL_USER,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    engineVersion: process.env.ENGINE_VERSION ?? 'macd-rsi-1.0.0',
  };
}
