import type { NextFunction, Request, Response } from 'express';
import { getPool } from '../db/pool.ts';
import { loadConfig } from './config.ts';
import { ApiError } from './errors.ts';

/**
 * Punto único de resolución de identidad.
 *
 * Hoy devuelve siempre el usuario local configurado, pero carga sus permisos
 * reales desde la base. Cuando se añada login solo cambia el cuerpo de
 * `resolveUser`: leer el Bearer token, validarlo contra api_tokens o
 * auth_sessions y devolver el usuario correspondiente. Las rutas, que ya
 * declaran el permiso que exigen, no se tocan.
 */

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface UserRow {
  id: string;
  display_name: string;
  status: string;
  roles: string[] | null;
  permissions: string[] | null;
}

async function loadUser(userId: string): Promise<AuthenticatedUser | null> {
  const { rows } = await getPool().query<UserRow>(
    `
    SELECT u.id,
           u.display_name,
           u.status::text,
           array_remove(array_agg(DISTINCT r.code), NULL) AS roles,
           array_remove(array_agg(DISTINCT p.code), NULL) AS permissions
      FROM users u
      LEFT JOIN user_roles ur      ON ur.user_id = u.id
      LEFT JOIN roles r            ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p       ON p.id = rp.permission_id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id
    `,
    [userId],
  );

  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'active') return null;

  return {
    id: row.id,
    displayName: row.display_name,
    roles: row.roles ?? [],
    permissions: new Set(row.permissions ?? []),
  };
}

export function authenticate() {
  const config = loadConfig();
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // Sustituir por la validación del token cuando exista login. El resto de
      // la cadena (permisos, propiedad de los datos) ya funciona sin cambios.
      const user = await loadUser(config.localUserId);
      if (!user) {
        throw ApiError.unauthorized(
          `El usuario local ${config.localUserId} no existe o está inactivo. Ejecuta las migraciones.`,
        );
      }
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Exige un permiso concreto; devuelve 403 si el usuario no lo tiene. */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!req.user.permissions.has(permission)) {
      return next(ApiError.forbidden(`Falta el permiso "${permission}".`));
    }
    next();
  };
}

/** El usuario autenticado, o error si el middleware no se ejecutó. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}
