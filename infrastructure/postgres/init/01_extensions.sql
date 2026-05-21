-- Extensiones requeridas para Aibenchef
-- Se ejecuta automaticamente al inicializar el container postgres

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- UUIDs
CREATE EXTENSION IF NOT EXISTS pg_trgm;            -- busqueda fuzzy / autocomplete entidades
CREATE EXTENSION IF NOT EXISTS btree_gin;          -- indices compuestos
CREATE EXTENSION IF NOT EXISTS pgcrypto;           -- gen_random_uuid()
-- pg_partman se agrega via paquete en imagen custom mas adelante
-- pgvector se agrega cuando se incorpore feature "preguntale a la data"
