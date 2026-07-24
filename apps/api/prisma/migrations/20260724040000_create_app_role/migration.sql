-- Role de aplicação `crm_app` (NOSUPERUSER, NOBYPASSRLS, só DML) + GRANTs.
-- Roda como crm_user (dono). Idempotente: `migrate reset` recria o banco, mas
-- roles são objetos de cluster (persistem) — por isso o guard IF NOT EXISTS.
-- Nota: senha fixa é aceitável em dev. Em produção, a role é gerenciada fora
-- das migrations (ver .env.example) — ajustar via ALTER ROLE no provisionamento.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_password'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
