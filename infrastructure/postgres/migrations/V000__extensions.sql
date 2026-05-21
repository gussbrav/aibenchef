-- =========================================================================
-- Bootstrap extensions
-- Correr UNA VEZ en la DB aibenchef antes de las V*.sql
-- (en docker-compose dev se aplica via init/01_extensions.sql; en EasyPanel
-- hay que correrlo manual desde pgAdmin)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
