-- ---------------------------------------------------------------------------
-- Usuario local de arranque.
--
-- Ocupa el hueco de user_id hasta que exista login. Se identifica por un UUID
-- fijo para que reiniciar la base no huérfane los datos ya escritos, y no
-- tiene password_hash: no es una cuenta con la que se pueda autenticar nadie,
-- es el propietario por defecto de los datos de una instalación de escritorio.
-- ---------------------------------------------------------------------------

INSERT INTO users (id, email, display_name, status)
VALUES ('00000000-0000-4000-8000-000000000001', NULL, 'Usuario local', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-8000-000000000001', id FROM roles WHERE code = 'owner'
ON CONFLICT DO NOTHING;
