-- ---------------------------------------------------------------------------
-- Identidad, roles y credenciales.
--
-- El login todavía no existe, pero las tablas se crean desde el principio: el
-- resto del esquema referencia user_id con clave ajena, y añadir esa columna
-- después obligaría a migrar datos ya escritos. Un usuario "local" semilla
-- ocupa el hueco hasta que haya autenticación real.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- correo insensible a mayúsculas

CREATE TYPE user_status AS ENUM ('active', 'invited', 'suspended', 'deleted');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE,
  display_name   text NOT NULL,
  -- Nulo mientras no haya login. Guardará un hash (argon2/bcrypt), nunca la
  -- contraseña: el nombre de la columna lo hace explícito.
  password_hash  text,
  status         user_status NOT NULL DEFAULT 'active',
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE roles (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text
);

CREATE TABLE permissions (
  id          smallserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  description text
);

CREATE TABLE role_permissions (
  role_id       smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id),
  PRIMARY KEY (user_id, role_id)
);

-- Sesiones de refresco para un futuro flujo con JWT de acceso corto.
CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  user_agent         text,
  ip_address         inet,
  issued_at          timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id) WHERE revoked_at IS NULL;

-- Tokens de API para integraciones o bots de trading.
CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  -- Prefijo visible para identificar el token en una lista sin exponerlo.
  token_prefix text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id) WHERE revoked_at IS NULL;

-- Rastro de auditoría: quién cambió qué y cuál era el valor anterior.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_time_idx ON audit_log (user_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);

INSERT INTO roles (code, name, description) VALUES
  ('owner',  'Propietario', 'Control total sobre su propia cartera.'),
  ('viewer', 'Lector',      'Consulta sin capacidad de modificar tenencias.'),
  ('admin',  'Administrador', 'Gestión de usuarios y permisos.');

INSERT INTO permissions (code, description) VALUES
  ('holdings:read',    'Consultar tenencias e histórico.'),
  ('holdings:write',   'Modificar el saldo de un activo.'),
  ('analysis:read',    'Consultar análisis y recomendaciones.'),
  ('analysis:write',   'Registrar nuevas ejecuciones de análisis.'),
  ('portfolio:read',   'Consultar totales e histórico de cartera.'),
  ('users:manage',     'Alta, baja y modificación de usuarios.'),
  ('tokens:manage',    'Emitir y revocar tokens de API.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'owner'
  AND p.code IN ('holdings:read','holdings:write','analysis:read','analysis:write','portfolio:read','tokens:manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'viewer'
  AND p.code IN ('holdings:read','analysis:read','portfolio:read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'admin';
